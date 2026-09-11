import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import { KnowledgeBaseAccessService } from '../../knowledge-bases/services/knowledge-base-access.service';
import type { ListDocumentsDto } from '../dto/list-documents.dto';
import type { UpdateDocumentDto } from '../dto/update-document.dto';

type DocumentRecord = Prisma.b_documentsGetPayload<{
  include: { b_users: { select: { id: true; email: true; full_name: true } } };
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

    await this.prisma.b_documents.updateMany({
      where: { id: document.id, status: { not: 'deleted' } },
      data: { status: 'deleting' },
    });
    try {
      await this.storage.deleteObject({
        bucket: document.storage_bucket,
        key: document.storage_key,
      });
      await this.prisma.b_documents.updateMany({
        where: { id: document.id, status: 'deleting' },
        data: { status: 'deleted', deleted_at: new Date() },
      });
      return { kbId, documentId, deleted: true };
    } catch (error) {
      throw new BusinessError(
        ErrorCode.SERVICE_UNAVAILABLE,
        '源文件清理失败，请稍后重试',
        'unavailable',
        { cause: error },
      );
    }
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
      processingDeferred: document.status === 'processing',
      searchable: false,
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
}
