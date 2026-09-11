import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { AppLogger } from '../../../platform/observability/app-logger.service';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
  type StoragePart,
} from '../../../platform/object-storage/storage-adapter';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import { KnowledgeBaseAccessService } from '../../knowledge-bases/services/knowledge-base-access.service';
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE,
  defaultMimeType,
  normalizeExtension,
} from '../documents.constants';
import { ConfirmPartDto } from '../dto/confirm-part.dto';
import { InitUploadDto } from '../dto/init-upload.dto';

const ACTIVE_SESSION_STATUSES = [
  'initiated',
  'uploading',
  'completing',
] as const;
const CONTINUABLE_SESSION_STATUSES = ['initiated', 'uploading'] as const;

type UploadSession = Prisma.b_upload_sessionsGetPayload<{
  include: { upload_parts: { orderBy: { part_number: 'asc' } } };
}>;

function normalizeEtag(value: string | null | undefined) {
  return value?.trim().replaceAll('"', '').toLowerCase() ?? '';
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KnowledgeBaseAccessService,
    private readonly config: RuntimeConfig,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  async init(userId: bigint, kbId: string, dto: InitUploadDto) {
    const kb = await this.access.subject(kbId);
    this.requireUpload(kb, userId);
    const normalized = this.normalizeInit(dto);
    const kbIdValue = parseId(kbId);

    const instant = await this.findInstantDocument(kbIdValue, normalized);
    if (instant)
      return {
        isInstantUploaded: true,
        deduplicated: true,
        uploadId: null,
        documentId: instant.id.toString(),
        document: this.documentItem(instant),
      };

    const existing = await this.prisma.b_upload_sessions.findFirst({
      where: {
        kb_id: kbIdValue,
        user_id: userId,
        client_sha256: normalized.clientSha256,
        file_size: BigInt(normalized.fileSize),
        file_name: normalized.fileName,
        mime_type: normalized.mimeType,
        file_extension: normalized.extension,
        part_size: this.config.documentStorage.partSize,
        status: { in: [...ACTIVE_SESSION_STATUSES] },
        expires_at: { gt: new Date() },
      },
      include: { upload_parts: { orderBy: { part_number: 'asc' } } },
    });
    if (existing)
      return {
        isInstantUploaded: false,
        deduplicated: false,
        ...this.sessionItem(existing),
      };

    const sessionId = randomUUID();
    const key = `knowledge-bases/${kbIdValue}/documents/${sessionId}${normalized.extension}`;
    const storage = await this.storage.createMultipart({
      bucket: this.config.documentStorage.bucket,
      key,
      contentType: normalized.mimeType,
    });
    const expiresAt = new Date(
      Date.now() + this.config.documentStorage.sessionTtlSeconds * 1000,
    );
    const session = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.b_upload_sessions.create({
          data: {
            session_id: sessionId,
            kb_id: kbIdValue,
            user_id: userId,
            storage_bucket: this.config.documentStorage.bucket,
            storage_key: key,
            multipart_upload_id: storage.uploadId,
            file_name: normalized.fileName,
            title: normalized.title,
            file_size: BigInt(normalized.fileSize),
            mime_type: normalized.mimeType,
            client_sha256: normalized.clientSha256,
            file_extension: normalized.extension,
            part_size: this.config.documentStorage.partSize,
            total_parts: normalized.totalParts,
            expires_at: expiresAt,
            last_activity_at: new Date(),
          },
        });
        await tx.b_upload_parts.createMany({
          data: Array.from({ length: normalized.totalParts }, (_, index) => ({
            upload_session_id: created.id,
            part_number: index + 1,
            expected_size: Math.min(
              this.config.documentStorage.partSize,
              normalized.fileSize -
                index * this.config.documentStorage.partSize,
            ),
          })),
        });
        return tx.b_upload_sessions.findUniqueOrThrow({
          where: { id: created.id },
          include: { upload_parts: { orderBy: { part_number: 'asc' } } },
        });
      })
      .catch(async (error) => {
        await this.storage.abortMultipart({
          bucket: this.config.documentStorage.bucket,
          key,
          uploadId: storage.uploadId,
        });
        throw error;
      });

    return {
      isInstantUploaded: false,
      deduplicated: false,
      ...this.sessionItem(session),
    };
  }

  async status(userId: bigint, kbId: string, sessionId: string) {
    const session = await this.getSession(userId, kbId, sessionId);
    await this.expireIfNeeded(session);
    const fresh = await this.getSession(userId, kbId, sessionId);
    return this.sessionItem(fresh);
  }

  async signPart(
    userId: bigint,
    kbId: string,
    sessionId: string,
    partNumber: number,
  ) {
    const session = await this.getSession(userId, kbId, sessionId);
    this.requireActive(session);
    const part = this.getPart(session, partNumber);
    const url = await this.storage.signPart({
      bucket: session.storage_bucket,
      key: session.storage_key,
      uploadId: session.multipart_upload_id,
      partNumber,
      expiresInSeconds: 900,
    });
    await this.prisma.b_upload_parts.update({
      where: { id: part.id },
      data: {
        status: 'uploading',
        attempt_count: { increment: 1 },
        last_error: null,
      },
    });
    await this.prisma.b_upload_sessions.update({
      where: { id: session.id },
      data: { status: 'uploading', last_activity_at: new Date() },
    });
    return {
      sessionId,
      partNumber,
      expectedSize: part.expected_size,
      uploadUrl: url,
      expiresInSeconds: 900,
    };
  }

  async confirmPart(
    userId: bigint,
    kbId: string,
    sessionId: string,
    partNumber: number,
    dto: ConfirmPartDto,
  ) {
    const session = await this.getSession(userId, kbId, sessionId);
    this.requireActive(session);
    const expected = this.getPart(session, partNumber);
    const parts = await this.storage.listParts({
      bucket: session.storage_bucket,
      key: session.storage_key,
      uploadId: session.multipart_upload_id,
    });
    const actual = parts.find((part) => part.partNumber === partNumber);
    const submittedEtag = normalizeEtag(dto.etag);
    const actualEtag = normalizeEtag(actual?.etag);
    const expectedSize = Number(expected.expected_size);
    if (
      !actual ||
      actualEtag !== submittedEtag ||
      actual.size !== expectedSize
    ) {
      this.logger?.warn('document upload part validation failed', {
        sessionId,
        partNumber,
        expectedSize,
        actualSize: actual?.size ?? null,
        submittedEtag,
        actualEtag: actualEtag || null,
      });
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_PART_INVALID,
        '分片校验失败',
        'validation',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.b_upload_parts.updateMany({
        where: { id: expected.id, status: { not: 'uploaded' } },
        data: {
          status: 'uploaded',
          actual_size: actual.size,
          etag: actual.etag,
          checksum_sha256: dto.checksumSha256 ?? null,
          uploaded_at: new Date(),
          last_error: null,
        },
      });
      if (updated.count === 1) {
        const uploaded = await tx.b_upload_parts.findMany({
          where: { upload_session_id: session.id, status: 'uploaded' },
          select: { actual_size: true },
        });
        await tx.b_upload_sessions.update({
          where: { id: session.id },
          data: {
            status: 'uploading',
            uploaded_parts: uploaded.length,
            uploaded_bytes: uploaded.reduce(
              (total, item) => total + BigInt(item.actual_size ?? 0),
              0n,
            ),
            last_activity_at: new Date(),
          },
        });
      }
    });
    return this.status(userId, kbId, sessionId);
  }

  async complete(userId: bigint, kbId: string, sessionId: string) {
    const session = await this.getSession(userId, kbId, sessionId);
    if (session.status === 'completed' && session.document_id)
      return this.completedResponse(session.document_id);
    this.requireActive(session);
    const claimed = await this.prisma.b_upload_sessions.updateMany({
      where: {
        id: session.id,
        status: { in: ['initiated', 'uploading'] },
        expires_at: { gt: new Date() },
      },
      data: { status: 'completing', last_activity_at: new Date() },
    });
    if (claimed.count !== 1) {
      const current = await this.getSession(userId, kbId, sessionId);
      if (current.status === 'completed' && current.document_id)
        return this.completedResponse(current.document_id);
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_SESSION_INVALID_STATE,
        '上传会话正在完成或不可继续',
        'conflict',
      );
    }

    const current = await this.getSession(userId, kbId, sessionId);
    try {
      const parts = await this.storage.listParts({
        bucket: current.storage_bucket,
        key: current.storage_key,
        uploadId: current.multipart_upload_id,
      });
      this.assertAllParts(current, parts);
      const completeResult = await this.storage.completeMultipart({
        bucket: current.storage_bucket,
        key: current.storage_key,
        uploadId: current.multipart_upload_id,
        parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
      });
      const head = await this.storage.headObject({
        bucket: current.storage_bucket,
        key: current.storage_key,
      });
      if (head.size !== Number(current.file_size))
        throw new BusinessError(
          ErrorCode.DOCUMENT_UPLOAD_INTEGRITY_FAILED,
          '文件大小校验失败',
          'conflict',
        );
      const fileSha256 = await this.verifyObject(current);
      if (current.client_sha256 && current.client_sha256 !== fileSha256)
        throw new BusinessError(
          ErrorCode.DOCUMENT_UPLOAD_INTEGRITY_FAILED,
          '文件完整性校验失败',
          'conflict',
        );
      const document = await this.prisma.$transaction(async (tx) => {
        const created = await tx.b_documents.create({
          data: {
            kb_id: current.kb_id,
            uploader_id: current.user_id,
            title: current.title ?? current.file_name,
            original_filename: current.file_name,
            file_extension: current.file_extension,
            mime_type: current.mime_type,
            storage_provider: current.storage_provider,
            storage_bucket: current.storage_bucket,
            storage_key: current.storage_key,
            storage_etag: completeResult.etag || head.etag,
            file_size: current.file_size,
            file_sha256: fileSha256,
            status: 'processing',
          },
        });
        await tx.b_upload_sessions.update({
          where: { id: current.id, status: 'completing' },
          data: {
            status: 'completed',
            document_id: created.id,
            completed_at: new Date(),
            uploaded_parts: current.total_parts,
            uploaded_bytes: current.file_size,
            last_activity_at: new Date(),
          },
        });
        return created;
      });
      return {
        isInstantUploaded: false,
        deduplicated: false,
        uploadId: sessionId,
        documentId: document.id.toString(),
        document: this.documentItem(document),
      };
    } catch (error) {
      await this.prisma.b_upload_sessions.updateMany({
        where: { id: current.id, status: 'completing' },
        data: { status: 'failed', last_activity_at: new Date() },
      });
      throw error instanceof BusinessError
        ? error
        : new BusinessError(
            ErrorCode.SERVICE_UNAVAILABLE,
            '文件上传完成失败，请稍后重试',
            'unavailable',
            { cause: error },
          );
    }
  }

  async abort(userId: bigint, kbId: string, sessionId: string) {
    const session = await this.getSession(userId, kbId, sessionId);
    if (session.status === 'completed')
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_SESSION_INVALID_STATE,
        '已完成的上传不能取消',
        'conflict',
      );
    if (session.status === 'aborted' || session.status === 'expired')
      return { sessionId, status: session.status, aborted: true };
    await this.storage.abortMultipart({
      bucket: session.storage_bucket,
      key: session.storage_key,
      uploadId: session.multipart_upload_id,
    });
    await this.prisma.b_upload_sessions.updateMany({
      where: {
        id: session.id,
        status: { in: [...ACTIVE_SESSION_STATUSES, 'failed'] },
      },
      data: {
        status: 'aborted',
        aborted_at: new Date(),
        last_activity_at: new Date(),
      },
    });
    return { sessionId, status: 'aborted', aborted: true };
  }

  async cleanupExpired(limit = 100) {
    const sessions = await this.prisma.b_upload_sessions.findMany({
      where: {
        status: { in: [...ACTIVE_SESSION_STATUSES] },
        expires_at: { lte: new Date() },
      },
      take: limit,
    });
    let cleaned = 0;
    for (const session of sessions) {
      try {
        await this.storage.abortMultipart({
          bucket: session.storage_bucket,
          key: session.storage_key,
          uploadId: session.multipart_upload_id,
        });
        await this.prisma.b_upload_sessions.updateMany({
          where: {
            id: session.id,
            status: { in: [...ACTIVE_SESSION_STATUSES] },
          },
          data: { status: 'expired', last_activity_at: new Date() },
        });
        cleaned += 1;
      } catch {
        // 外部资源失败时保留 active 状态，下一轮仍可重试，不制造假清理结果。
      }
    }
    return { cleaned };
  }

  private async findInstantDocument(
    kbId: bigint,
    input: ReturnType<UploadsService['normalizeInit']>,
  ) {
    const candidates = await this.prisma.b_documents.findMany({
      where: {
        kb_id: kbId,
        file_sha256: input.clientSha256,
        file_size: BigInt(input.fileSize),
        status: { in: ['processing', 'ready'] },
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });
    for (const candidate of candidates) {
      try {
        const head = await this.storage.headObject({
          bucket: candidate.storage_bucket,
          key: candidate.storage_key,
        });
        if (head.size === Number(candidate.file_size)) return candidate;
      } catch {
        // 源对象不存在或不可读时不能命中秒传，继续寻找其他候选。
      }
    }
    return null;
  }

  private async verifyObject(session: UploadSession) {
    const stream = await this.storage.readObject({
      bucket: session.storage_bucket,
      key: session.storage_key,
    });
    const digest = createHash('sha256');
    let size = 0;
    let prefix = Buffer.alloc(0);
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk as Uint8Array);
      if (prefix.length < 16)
        prefix = Buffer.concat([prefix, buffer]).subarray(0, 16);
      size += buffer.length;
      digest.update(buffer);
    }
    if (
      size !== Number(session.file_size) ||
      !this.contentMatches(session.file_extension ?? '', prefix)
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_INTEGRITY_FAILED,
        '文件内容校验失败',
        'conflict',
      );
    return digest.digest('hex');
  }

  private contentMatches(extension: string, prefix: Buffer) {
    if (extension === '.pdf')
      return prefix.subarray(0, 5).toString() === '%PDF-';
    if (extension === '.doc')
      return prefix
        .subarray(0, 4)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    if (extension === '.docx') return prefix.subarray(0, 2).toString() === 'PK';
    return !prefix.includes(0);
  }

  private normalizeInit(dto: InitUploadDto) {
    if (dto.fileSize < 1 || dto.fileSize > MAX_DOCUMENT_FILE_SIZE)
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '文件大小不合法',
        'validation',
      );
    const extension = normalizeExtension(dto.fileName);
    if (
      !DOCUMENT_EXTENSIONS.includes(
        extension as (typeof DOCUMENT_EXTENSIONS)[number],
      )
    )
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '不支持的文件类型',
        'validation',
      );
    const mimeType = dto.mimeType || defaultMimeType(extension);
    if (
      !DOCUMENT_MIME_TYPES[
        extension as keyof typeof DOCUMENT_MIME_TYPES
      ].includes(mimeType)
    )
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '文件 MIME 类型不匹配',
        'validation',
      );
    const partSize = this.config.documentStorage.partSize;
    return {
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      mimeType,
      clientSha256: dto.clientSha256,
      title: dto.title ?? dto.fileName,
      extension,
      totalParts: Math.ceil(dto.fileSize / partSize),
    };
  }

  private async getSession(userId: bigint, kbId: string, sessionId: string) {
    const session = await this.prisma.b_upload_sessions.findFirst({
      where: { session_id: sessionId, kb_id: parseId(kbId), user_id: userId },
      include: { upload_parts: { orderBy: { part_number: 'asc' } } },
    });
    if (!session)
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_SESSION_NOT_FOUND,
        '上传会话不存在',
        'not-found',
      );
    return session;
  }

  private requireUpload(
    subject: Awaited<ReturnType<KnowledgeBaseAccessService['subject']>>,
    userId: bigint,
  ) {
    const role = this.access.requireRead(subject, userId);
    if (
      !this.access.permissions(
        role,
        subject.visibility,
        subject.allow_public_download,
      ).canUpload
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_OPERATION_FORBIDDEN,
        '无权上传文档',
        'forbidden',
      );
  }

  private requireActive(session: UploadSession) {
    if (session.expires_at <= new Date())
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_SESSION_EXPIRED,
        '上传会话已过期',
        'conflict',
      );
    if (
      !CONTINUABLE_SESSION_STATUSES.includes(
        session.status as (typeof CONTINUABLE_SESSION_STATUSES)[number],
      )
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_SESSION_INVALID_STATE,
        '上传会话不可继续',
        'conflict',
      );
  }

  private getPart(session: UploadSession, partNumber: number) {
    const part = session.upload_parts.find(
      (item) => item.part_number === partNumber,
    );
    if (!part)
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_PART_INVALID,
        '分片编号不合法',
        'validation',
      );
    return part;
  }

  private assertAllParts(session: UploadSession, parts: StoragePart[]) {
    const actual = new Map(parts.map((part) => [part.partNumber, part]));
    if (parts.length !== session.total_parts)
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_PART_INVALID,
        '分片尚未全部上传',
        'conflict',
      );
    for (const expected of session.upload_parts) {
      const part = actual.get(expected.part_number);
      if (
        !part ||
        part.size !== expected.expected_size ||
        expected.status !== 'uploaded' ||
        expected.etag !== part.etag
      )
        throw new BusinessError(
          ErrorCode.DOCUMENT_UPLOAD_PART_INVALID,
          '分片大小或数量不正确',
          'conflict',
        );
    }
  }

  private async expireIfNeeded(session: UploadSession) {
    if (
      session.expires_at > new Date() ||
      !ACTIVE_SESSION_STATUSES.includes(
        session.status as (typeof ACTIVE_SESSION_STATUSES)[number],
      )
    )
      return;
    try {
      await this.storage.abortMultipart({
        bucket: session.storage_bucket,
        key: session.storage_key,
        uploadId: session.multipart_upload_id,
      });
      await this.prisma.b_upload_sessions.updateMany({
        where: { id: session.id, status: { in: [...ACTIVE_SESSION_STATUSES] } },
        data: { status: 'expired' },
      });
    } catch {
      // 查询不能把外部清理失败伪装成完成，下一次 cleanup 继续处理。
    }
  }

  private sessionItem(session: UploadSession) {
    const uploaded = session.upload_parts.filter(
      (part) => part.status === 'uploaded',
    );
    return {
      sessionId: session.session_id,
      status: session.status,
      uploadId: session.session_id,
      fileName: session.file_name,
      fileSize: session.file_size,
      partSize: session.part_size,
      totalParts: session.total_parts,
      uploadedParts: uploaded.map((part) => ({
        partNumber: part.part_number,
        size: part.actual_size,
        etag: part.etag,
      })),
      missingParts: session.upload_parts
        .filter((part) => part.status !== 'uploaded')
        .map((part) => part.part_number),
      uploadedBytes: session.uploaded_bytes,
      expiresAt: session.expires_at,
      documentId: session.document_id?.toString() ?? null,
    };
  }

  private documentItem(document: {
    id: bigint;
    title: string;
    original_filename: string | null;
    file_extension: string | null;
    mime_type: string | null;
    file_size: bigint;
    status: string;
    created_at: Date;
    updated_at: Date;
  }) {
    return {
      id: document.id.toString(),
      title: document.title,
      originalFilename: document.original_filename,
      fileExtension: document.file_extension,
      mimeType: document.mime_type,
      fileSize: document.file_size,
      status: document.status,
      processingDeferred: true,
      searchable: false,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }

  private async completedResponse(documentId: bigint) {
    const document = await this.prisma.b_documents.findUniqueOrThrow({
      where: { id: documentId },
    });
    return {
      isInstantUploaded: false,
      deduplicated: false,
      uploadId: null,
      documentId: document.id.toString(),
      document: this.documentItem(document),
    };
  }
}
