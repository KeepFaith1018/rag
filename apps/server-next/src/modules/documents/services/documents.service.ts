import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  lockKnowledgeBaseById,
  lockDocumentById,
} from '../../../platform/database/transaction-locks';
import {
  STORAGE_ADAPTER,
  StorageError,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import { KnowledgeBaseAccessService } from '../../knowledge-bases/services/knowledge-base-access.service';
import type { ListDocumentsDto } from '../dto/list-documents.dto';
import type { UpdateDocumentDto } from '../dto/update-document.dto';
import {
  CleanupPayloadSchema,
  IndexTargetsSchema,
  parseVersioned,
} from '../../ingestion/contracts/schemas';
import { runPrefix } from '../../ingestion/contracts/identifiers';

type DocumentRecord = Prisma.b_documentsGetPayload<{
  include: {
    b_users: { select: { id: true; email: true; full_name: true } };
    desired_run: {
      select: {
        current_stage: true;
        status: true;
        error_code: true;
        error_message: true;
      };
    };
  };
}>;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KnowledgeBaseAccessService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async list(userId: bigint, kbId: string, query: ListDocumentsDto) {
    const subject = await this.access.subject(kbId);
    this.access.requireRead(subject, userId);
    const where: Prisma.b_documentsWhereInput = {
      kb_id: subject.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword } },
              { original_filename: { contains: query.keyword } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.b_documents.findMany({
        where,
        include: {
          b_users: { select: { id: true, email: true, full_name: true } },
          desired_run: {
            select: {
              current_stage: true,
              status: true,
              error_code: true,
              error_message: true,
            },
          },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.b_documents.count({ where }),
    ]);
    return {
      kbId,
      list: items.map((item) => this.map(item)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async detail(userId: bigint, kbId: string, documentId: string) {
    const subject = await this.access.subject(kbId);
    this.access.requireRead(subject, userId);
    const document = await this.getDocument(subject.id, documentId);
    return this.map(document);
  }

  async update(
    userId: bigint,
    kbId: string,
    documentId: string,
    dto: UpdateDocumentDto,
  ) {
    const subject = await this.access.subject(kbId);
    const role = this.access.requireRead(subject, userId);
    const document = await this.getDocument(subject.id, documentId);
    const permissions = this.access.permissions(
      role,
      subject.visibility,
      subject.allow_public_download,
    );
    const isUploader = document.uploader_id === userId;
    if (
      !(
        permissions.canDeleteAnyDocument ||
        (permissions.canDeleteOwnDocument && isUploader)
      )
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_OPERATION_FORBIDDEN,
        '无权修改文档',
        'forbidden',
      );
    const updated = await this.prisma.b_documents.update({
      where: { id: document.id },
      data: { title: dto.title },
      include: {
        b_users: { select: { id: true, email: true, full_name: true } },
        desired_run: {
          select: {
            current_stage: true,
            status: true,
            error_code: true,
            error_message: true,
          },
        },
      },
    });
    return this.map(updated);
  }

  async download(userId: bigint, kbId: string, documentId: string) {
    return this.filePayload(userId, kbId, documentId, false);
  }

  async preview(userId: bigint, kbId: string, documentId: string) {
    return this.filePayload(userId, kbId, documentId, true);
  }

  async remove(userId: bigint, kbId: string, documentId: string) {
    const subject = await this.access.subject(kbId);
    const role = this.access.requireRead(subject, userId);
    const document = await this.getDocument(subject.id, documentId, true);
    if (document.status === 'deleted')
      return { kbId, documentId, deleted: true };
    if (document.status === 'deleting')
      return { kbId, documentId, deleting: true, deleted: false };
    const permissions = this.access.permissions(
      role,
      subject.visibility,
      subject.allow_public_download,
    );
    const isUploader = document.uploader_id === userId;
    if (
      !(
        permissions.canDeleteAnyDocument ||
        (permissions.canDeleteOwnDocument && isUploader)
      )
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_OPERATION_FORBIDDEN,
        '无权删除文档',
        'forbidden',
      );

    const runs = await this.prisma.b_document_processing_runs.findMany({
      where: { document_id: document.id },
      select: { id: true, index_targets_json: true },
    });
    const payload = CleanupPayloadSchema.parse({
      schemaVersion: 1,
      documentId: document.id.toString(),
      source: { bucket: document.storage_bucket, key: document.storage_key },
      deleteSource: true,
      runs: runs.map((run) => ({
        runId: run.id.toString(),
        prefix: runPrefix(document.id, run.id),
        indexTargets: parseVersioned(
          IndexTargetsSchema,
          run.index_targets_json,
        ),
      })),
      reason: 'user_delete',
      createdAt: new Date().toISOString(),
    });
    await this.prisma.$transaction(async (tx) => {
      await lockKnowledgeBaseById(tx, subject.id);
      await lockDocumentById(tx, document.id);
      await tx.b_documents.updateMany({
        where: { id: document.id, status: { notIn: ['deleting', 'deleted'] } },
        data: {
          status: 'deleting',
          desired_run_id: null,
          deleted_at: new Date(),
        },
      });
      await tx.b_document_processing_tasks.updateMany({
        where: {
          processing_run: { document_id: document.id },
          status: { in: ['queued', 'running', 'retrying'] },
        },
        data: {
          status: 'cancelled',
          execution_version: { increment: 1 },
          finished_at: new Date(),
        },
      });
      await tx.b_outbox_events.upsert({
        where: { event_key: `cleanup-document-${document.id}` },
        create: {
          event_key: `cleanup-document-${document.id}`,
          event_type: 'cleanup_document',
          aggregate_type: 'document',
          aggregate_id: document.id.toString(),
          payload_json: payload,
        },
        update: {},
      });
    });
    return { kbId, documentId, deleting: true, deleted: false };
  }

  private async filePayload(
    userId: bigint,
    kbId: string,
    documentId: string,
    preview: boolean,
  ) {
    const subject = await this.access.subject(kbId);
    const role = this.access.requireRead(subject, userId);
    if (role === 'publicVisitor' && !subject.allow_public_download)
      throw new BusinessError(
        ErrorCode.DOCUMENT_OPERATION_FORBIDDEN,
        '该知识库不允许公开下载文档',
        'forbidden',
      );
    const document = await this.getDocument(subject.id, documentId);
    try {
      const head = await this.storage.headObject({
        bucket: document.storage_bucket,
        key: document.storage_key,
      });
      if (head.size !== Number(document.file_size))
        throw new Error('source size mismatch');
      const extension = document.file_extension ?? '';
      const inline = preview && ['.pdf', '.txt', '.md'].includes(extension);
      return {
        fileName: document.original_filename ?? document.title,
        mimeType: inline
          ? (document.mime_type ?? 'application/octet-stream')
          : 'application/octet-stream',
        disposition: inline
          ? 'inline'
          : `attachment; filename="${encodeURIComponent(document.original_filename ?? document.title)}"`,
        stream: await this.storage.readObject({
          bucket: document.storage_bucket,
          key: document.storage_key,
        }),
      };
    } catch (error) {
      if (error instanceof StorageError && error.storageKind !== 'not-found')
        throw error;
      throw new BusinessError(
        ErrorCode.DOCUMENT_SOURCE_MISSING,
        '文档源文件不存在',
        'not-found',
        { cause: error },
      );
    }
  }

  private async getDocument(
    kbId: bigint,
    documentId: string,
    includeDeleted = false,
  ): Promise<DocumentRecord> {
    const document = await this.prisma.b_documents.findFirst({
      where: {
        id: parseId(documentId),
        kb_id: kbId,
        ...(includeDeleted
          ? {}
          : { deleted_at: null, status: { not: 'deleted' } }),
      },
      include: {
        b_users: { select: { id: true, email: true, full_name: true } },
        desired_run: {
          select: {
            current_stage: true,
            status: true,
            error_code: true,
            error_message: true,
          },
        },
      },
    });
    if (!document)
      throw new BusinessError(
        ErrorCode.DOCUMENT_NOT_FOUND,
        '文档不存在',
        'not-found',
      );
    return document;
  }

  private map(document: DocumentRecord) {
    return {
      id: document.id.toString(),
      title: document.title,
      originalFilename: document.original_filename,
      fileExtension: document.file_extension,
      mimeType: document.mime_type,
      fileSize: document.file_size,
      status: document.status,
      processingStage: this.processingStage(document),
      processingDeferred: false,
      searchable: document.status === 'ready' && !!document.active_run_id,
      servingPreviousVersion:
        document.status === 'ready' &&
        !!document.active_run_id &&
        !!document.desired_run_id &&
        document.active_run_id !== document.desired_run_id &&
        document.desired_run?.status === 'failed',
      processingErrorCode: document.desired_run?.error_code ?? null,
      processingErrorMessage: document.desired_run?.error_message ?? null,
      uploader: document.b_users
        ? {
            id: document.b_users.id.toString(),
            email: document.b_users.email,
            fullName: document.b_users.full_name,
          }
        : null,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }

  private processingStage(document: DocumentRecord) {
    if (document.status === 'ready') return 'ready';
    if (['failed', 'deleting', 'deleted'].includes(document.status))
      return 'failed';
    if (document.desired_run?.current_stage === 'chunk') return 'chunking';
    if (document.desired_run?.current_stage === 'embed') return 'embedding';
    if (
      ['index', 'completed'].includes(document.desired_run?.current_stage ?? '')
    )
      return 'indexing';
    return 'parsing';
  }
}
