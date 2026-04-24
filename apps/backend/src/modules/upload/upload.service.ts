import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-client';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { PrismaService } from '@common/prisma/prisma.service';
import { FileStorageService } from '@common/storage/file-storage.service';
import { ErrorCode } from '@common/utils/errorCodeMap';
import {
  MAX_DOCUMENT_FILE_SIZE,
  resolveDocumentMimeType,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from '../document/document.constants';
import { KbPermissionService } from '../knowledge-base/permission/kb-permission.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { UploadChunkDto } from './dto/upload-chunk.dto';

const UPLOAD_SESSION_EXPIRE_HOURS = 72;
const ACTIVE_UPLOAD_SESSION_STATUS = ['init', 'uploading', 'completed'] as const;

type UploadedChunkFile = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
};

type UploadSessionEntity = Prisma.b_upload_sessionsGetPayload<{
  include: {
    upload_chunks: {
      orderBy: {
        chunk_index: 'asc';
      };
    };
  };
}>;

/**
 * 负责分片上传会话、秒传判定、断点续传状态和最终合并编排。
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbPermissionService: KbPermissionService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * 初始化上传会话；若命中知识库级秒传，则直接创建文档记录返回。
   */
  async init(userId: number, kbId: string, dto: InitUploadDto) {
    try {
      await this.kbPermissionService.authorize(userId, kbId, 'uploadDocument');
      const normalized = this.validateInitPayload(dto);
      const instantDocument = await this.findInstantDocument(
        kbId,
        normalized.fileHash,
      );

      if (instantDocument) {
        const document = await this.createDocumentFromExistingFile(
          kbId,
          userId,
          instantDocument,
          normalized,
        );

        return {
          kbId,
          uploadId: null,
          documentId: document.id.toString(),
          isInstantUploaded: true,
          chunkSize: normalized.chunkSize,
          totalChunks: normalized.totalChunks,
          uploadedChunks: [],
          status: document.status,
        };
      }

      const uploadSession =
        (await this.findRestorableSession(kbId, userId, normalized)) ??
        (await this.prisma.b_upload_sessions.create({
          data: {
            kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
            user_id: BigInt(userId),
            file_name: normalized.fileName,
            title: normalized.title,
            file_size: BigInt(normalized.fileSize),
            mime_type: normalized.mimeType,
            file_hash: normalized.fileHash,
            file_extension: normalized.extension,
            chunk_size: normalized.chunkSize,
            total_chunks: normalized.totalChunks,
            uploaded_count: 0,
            status: 'init',
            storage_type: this.fileStorageService.getStorageType(),
            temp_dir: this.fileStorageService
              .buildUploadTempDirectory(kbId, 'pending')
              .replace(/\\/g, '/'),
            expired_at: this.buildSessionExpiredAt(),
          },
        }));

      // 新建会话后再用真实的 uploadId 回填临时目录，保证目录结构稳定可恢复。
      if (uploadSession.temp_dir.endsWith('/pending')) {
        const tempDirectory = this.fileStorageService
          .buildUploadTempDirectory(kbId, uploadSession.id.toString())
          .replace(/\\/g, '/');
        await this.prisma.b_upload_sessions.update({
          where: {
            id: uploadSession.id,
          },
          data: {
            temp_dir: tempDirectory,
          },
        });
        uploadSession.temp_dir = tempDirectory;
      }

      const uploadedChunks = await this.listUploadedChunks(uploadSession.id);
      if (uploadSession.uploaded_count !== uploadedChunks.length) {
        await this.prisma.b_upload_sessions.update({
          where: {
            id: uploadSession.id,
          },
          data: {
            uploaded_count: uploadedChunks.length,
            updated_at: new Date(),
          },
        });
      }

      return {
        kbId,
        uploadId: uploadSession.id.toString(),
        documentId: uploadSession.document_id?.toString() ?? null,
        isInstantUploaded: false,
        chunkSize: uploadSession.chunk_size,
        totalChunks: uploadSession.total_chunks,
        uploadedChunks,
        status: uploadSession.status,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.FILE_UPLOAD_FAILED, {
        context: {
          module: 'UploadService',
          action: 'init',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 上传单个分片并记录其持久化状态。
   */
  async uploadChunk(
    userId: number,
    kbId: string,
    uploadId: string,
    file: UploadedChunkFile | undefined,
    dto: UploadChunkDto,
  ) {
    if (!file) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '请上传文件分片');
    }

    try {
      await this.kbPermissionService.authorize(userId, kbId, 'uploadDocument');
      const session = await this.getUploadSessionOrThrow(kbId, userId, uploadId);
      this.assertSessionCanAcceptChunk(session);
      this.assertChunkFileValid(session, dto.chunkIndex, file);

      if (dto.chunkHash) {
        const actualChunkHash = this.computeHash(file.buffer);
        if (actualChunkHash !== dto.chunkHash.toLowerCase()) {
          throw new BusinessException(ErrorCode.FILE_HASH_MISMATCH, '分片哈希校验失败');
        }
      }

      const savedChunk = await this.fileStorageService.saveUploadChunk(file.buffer, {
        kbId,
        uploadId,
        chunkIndex: dto.chunkIndex,
      });

      await this.prisma.b_upload_chunks.upsert({
        where: {
          upload_id_chunk_index: {
            upload_id: session.id,
            chunk_index: dto.chunkIndex,
          },
        },
        create: {
          upload_id: session.id,
          chunk_index: dto.chunkIndex,
          chunk_size: file.size,
          chunk_hash: dto.chunkHash?.toLowerCase() ?? null,
          storage_path: savedChunk.relativePath.replace(/\\/g, '/'),
          status: 'uploaded',
        },
        update: {
          chunk_size: file.size,
          chunk_hash: dto.chunkHash?.toLowerCase() ?? null,
          storage_path: savedChunk.relativePath.replace(/\\/g, '/'),
          status: 'uploaded',
          updated_at: new Date(),
        },
      });

      const uploadedChunks = await this.listUploadedChunks(session.id);
      const nextStatus =
        uploadedChunks.length === session.total_chunks ? 'completed' : 'uploading';
      await this.prisma.b_upload_sessions.update({
        where: {
          id: session.id,
        },
        data: {
          uploaded_count: uploadedChunks.length,
          status: nextStatus,
          updated_at: new Date(),
        },
      });

      return {
        kbId,
        uploadId,
        chunkIndex: dto.chunkIndex,
        uploadedCount: uploadedChunks.length,
        totalChunks: session.total_chunks,
        status: nextStatus,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.FILE_UPLOAD_FAILED, {
        context: {
          module: 'UploadService',
          action: 'uploadChunk',
          userId,
          kbId,
          uploadId,
          chunkIndex: dto.chunkIndex,
        },
      });
    }
  }

  /**
   * 查询上传会话状态，用于断点续传时恢复缺失分片。
   */
  async getStatus(userId: number, kbId: string, uploadId: string) {
    try {
      await this.kbPermissionService.authorize(userId, kbId, 'uploadDocument');
      const session = await this.getUploadSessionOrThrow(kbId, userId, uploadId);
      const uploadedChunks = session.upload_chunks.map((item) => item.chunk_index);
      const uploadedChunkSet = new Set(uploadedChunks);
      const missingChunks: number[] = [];

      for (let chunkIndex = 0; chunkIndex < session.total_chunks; chunkIndex += 1) {
        if (!uploadedChunkSet.has(chunkIndex)) {
          missingChunks.push(chunkIndex);
        }
      }

      return {
        kbId,
        uploadId,
        status: session.status,
        uploadedChunks,
        missingChunks,
        uploadedCount: uploadedChunks.length,
        totalChunks: session.total_chunks,
        chunkSize: session.chunk_size,
        isExpired: this.isSessionExpired(session),
        documentId: session.document_id?.toString() ?? null,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.FILE_UPLOAD_FAILED, {
        context: {
          module: 'UploadService',
          action: 'getStatus',
          userId,
          kbId,
          uploadId,
        },
      });
    }
  }

  /**
   * 在全部分片上传完毕后执行合并、哈希校验与文档入库。
   */
  async complete(
    userId: number,
    kbId: string,
    uploadId: string,
    dto: CompleteUploadDto,
  ) {
    try {
      await this.kbPermissionService.authorize(userId, kbId, 'uploadDocument');
      const session = await this.getUploadSessionOrThrow(kbId, userId, uploadId);

      if (session.status === 'merged' && session.document_id) {
        return {
          kbId,
          uploadId,
          documentId: session.document_id.toString(),
          status: 'uploaded',
          isInstantUploaded: false,
        };
      }

      const uploadedChunks = session.upload_chunks.map((item) => item.chunk_index);
      if (uploadedChunks.length !== session.total_chunks) {
        throw new BusinessException(ErrorCode.FILE_CHUNK_INCOMPLETE);
      }
      if (dto.totalChunks && dto.totalChunks !== session.total_chunks) {
        throw new BusinessException(ErrorCode.PARAM_ERROR, '分片总数不一致');
      }

      const mergedFile = await this.fileStorageService.mergeUploadChunks({
        kbId,
        uploadId,
        totalChunks: session.total_chunks,
        extension: session.file_extension || '',
      });
      const mergedFileBuffer = await readFile(mergedFile.absolutePath);
      const mergedHash = this.computeHash(mergedFileBuffer);
      const expectedHash = (dto.fileHash || session.file_hash).toLowerCase();
      if (mergedHash !== expectedHash) {
        await this.fileStorageService.deleteFile(mergedFile.relativePath);
        throw new BusinessException(ErrorCode.FILE_HASH_MISMATCH);
      }

      const document = await this.prisma.$transaction(async (transaction) => {
        const createdDocument = await transaction.b_documents.create({
          data: {
            kb_id: session.kb_id,
            uploader_id: session.user_id,
            title: this.resolveDocumentTitle(session.title, session.file_name),
            original_filename: session.file_name,
            file_path: mergedFile.relativePath.replace(/\\/g, '/'),
            file_hash: mergedHash,
            file_size: session.file_size,
            file_type: this.resolveFileType(session.file_extension),
            mime_type:
              session.mime_type ||
              resolveDocumentMimeType(session.file_extension || ''),
            status: 'uploaded',
          },
        });

        await transaction.b_upload_sessions.update({
          where: {
            id: session.id,
          },
          data: {
            document_id: createdDocument.id,
            status: 'merged',
            completed_at: new Date(),
            uploaded_count: session.total_chunks,
            updated_at: new Date(),
          },
        });

        return createdDocument;
      });

      await this.fileStorageService.deleteDirectory(session.temp_dir);

      return {
        kbId,
        uploadId,
        documentId: document.id.toString(),
        status: document.status,
        isInstantUploaded: false,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.FILE_UPLOAD_FAILED, {
        context: {
          module: 'UploadService',
          action: 'complete',
          userId,
          kbId,
          uploadId,
        },
      });
    }
  }

  /**
   * 取消上传会话，并清理已落地的临时分片。
   */
  async cancel(userId: number, kbId: string, uploadId: string) {
    try {
      await this.kbPermissionService.authorize(userId, kbId, 'uploadDocument');
      const session = await this.getUploadSessionOrThrow(kbId, userId, uploadId);

      await this.prisma.$transaction([
        this.prisma.b_upload_chunks.deleteMany({
          where: {
            upload_id: session.id,
          },
        }),
        this.prisma.b_upload_sessions.update({
          where: {
            id: session.id,
          },
          data: {
            status: 'cancelled',
            uploaded_count: 0,
            updated_at: new Date(),
          },
        }),
      ]);
      await this.fileStorageService.deleteDirectory(session.temp_dir);

      return {
        kbId,
        uploadId,
        cancelled: true,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.FILE_UPLOAD_FAILED, {
        context: {
          module: 'UploadService',
          action: 'cancel',
          userId,
          kbId,
          uploadId,
        },
      });
    }
  }

  /**
   * 清理已经过期且仍保留临时分片的上传会话。
   * 当前先提供服务能力，后续可接入定时任务或后台治理入口。
   */
  async cleanupExpiredSessions() {
    const expiredSessions = await this.prisma.b_upload_sessions.findMany({
      where: {
        status: {
          in: ['init', 'uploading', 'completed'],
        },
        expired_at: {
          lte: new Date(),
        },
      },
      select: {
        id: true,
        temp_dir: true,
      },
    });

    for (const session of expiredSessions) {
      await this.markSessionExpired(session.id, session.temp_dir);
    }

    return {
      cleanedCount: expiredSessions.length,
    };
  }

  /**
   * 查询当前知识库下是否已存在同哈希源文件，用于知识库级秒传。
   */
  private async findInstantDocument(kbId: string, fileHash: string) {
    const existingDocument = await this.prisma.b_documents.findFirst({
      where: {
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
        file_hash: fileHash,
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (!existingDocument) {
      return null;
    }
    if (!this.fileStorageService.exists(existingDocument.file_path)) {
      return null;
    }

    return existingDocument;
  }

  /**
   * 创建基于已有物理文件复用的新文档记录，实现知识库级秒传。
   */
  private createDocumentFromExistingFile(
    kbId: string,
    userId: number,
    existingDocument: Prisma.b_documentsUncheckedCreateInput &
      Prisma.b_documentsUncheckedUpdateInput,
    payload: ReturnType<typeof this.validateInitPayload>,
  ) {
    return this.prisma.b_documents.create({
      data: {
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
        uploader_id: BigInt(userId),
        title: this.resolveDocumentTitle(payload.title, payload.fileName),
        original_filename: payload.fileName,
        file_path: String(existingDocument.file_path),
        file_hash: String(existingDocument.file_hash),
        file_size: BigInt(existingDocument.file_size?.toString() ?? payload.fileSize),
        file_type: String(existingDocument.file_type ?? payload.extension.replace('.', '')),
        mime_type: payload.mimeType || String(existingDocument.mime_type || ''),
        status: 'uploaded',
      },
    });
  }

  /**
   * 查找可恢复的上传会话，供断点续传复用。
   */
  private async findRestorableSession(
    kbId: string,
    userId: number,
    payload: ReturnType<typeof this.validateInitPayload>,
  ) {
    const session = await this.prisma.b_upload_sessions.findFirst({
      where: {
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
        user_id: BigInt(userId),
        file_hash: payload.fileHash,
        chunk_size: payload.chunkSize,
        total_chunks: payload.totalChunks,
        status: {
          in: [...ACTIVE_UPLOAD_SESSION_STATUS],
        },
      },
      include: {
        upload_chunks: {
          orderBy: {
            chunk_index: 'asc',
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (!session) {
      return null;
    }
    if (this.isSessionExpired(session)) {
      await this.markSessionExpired(session.id, session.temp_dir);
      return null;
    }

    return session;
  }

  /**
   * 读取上传会话并完成归属、状态与过期校验。
   */
  private async getUploadSessionOrThrow(
    kbId: string,
    userId: number,
    uploadId: string,
  ): Promise<UploadSessionEntity> {
    const session = await this.prisma.b_upload_sessions.findFirst({
      where: {
        id: this.parseUploadId(uploadId),
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
        user_id: BigInt(userId),
      },
      include: {
        upload_chunks: {
          orderBy: {
            chunk_index: 'asc',
          },
        },
      },
    });

    if (!session) {
      throw new BusinessException(ErrorCode.FILE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (this.isSessionExpired(session)) {
      await this.markSessionExpired(session.id, session.temp_dir);
      throw new BusinessException(ErrorCode.FILE_UPLOAD_SESSION_EXPIRED);
    }

    return session;
  }

  /**
   * 将上传会话状态标记为过期，并同步清理临时目录。
   */
  private async markSessionExpired(sessionId: bigint, tempDir: string) {
    await this.prisma.b_upload_sessions.update({
      where: {
        id: sessionId,
      },
      data: {
        status: 'expired',
        updated_at: new Date(),
      },
    });
    await this.fileStorageService.deleteDirectory(tempDir);
  }

  /**
   * 校验初始化参数与文件规则是否满足文档上传方案要求。
   */
  private validateInitPayload(dto: InitUploadDto) {
    const extension = extname(dto.fileName).toLowerCase();
    if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension as never)) {
      throw new BusinessException(ErrorCode.FILE_TYPE_UNSUPPORTED);
    }
    if (dto.fileSize > MAX_DOCUMENT_FILE_SIZE) {
      throw new BusinessException(ErrorCode.FILE_TOO_LARGE);
    }

    const expectedTotalChunks = Math.ceil(dto.fileSize / dto.chunkSize);
    if (expectedTotalChunks !== dto.totalChunks) {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '分片总数与文件大小、分片大小不匹配',
      );
    }

    return {
      fileName: dto.fileName.trim(),
      title: dto.title?.trim(),
      fileSize: dto.fileSize,
      mimeType: dto.mimeType?.trim() || resolveDocumentMimeType(extension),
      fileHash: dto.fileHash.toLowerCase(),
      chunkSize: dto.chunkSize,
      totalChunks: dto.totalChunks,
      extension,
    };
  }

  /**
   * 校验当前会话是否仍允许继续接收分片。
   */
  private assertSessionCanAcceptChunk(session: UploadSessionEntity) {
    if (!ACTIVE_UPLOAD_SESSION_STATUS.includes(session.status as never)) {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '当前上传会话状态不允许继续上传分片',
      );
    }
  }

  /**
   * 校验当前分片大小、索引和基础结构是否合法。
   */
  private assertChunkFileValid(
    session: UploadSessionEntity,
    chunkIndex: number,
    file: UploadedChunkFile,
  ) {
    if (chunkIndex < 0 || chunkIndex >= session.total_chunks) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '分片索引超出范围');
    }

    const totalFileSize = Number(session.file_size);
    const expectedChunkSize =
      chunkIndex === session.total_chunks - 1
        ? totalFileSize - session.chunk_size * (session.total_chunks - 1)
        : session.chunk_size;

    if (file.size !== expectedChunkSize) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '分片大小不正确');
    }
  }

  /**
   * 按上传会话查询当前已经成功持久化的分片序号。
   */
  private async listUploadedChunks(uploadSessionId: bigint) {
    const chunks = await this.prisma.b_upload_chunks.findMany({
      where: {
        upload_id: uploadSessionId,
      },
      orderBy: {
        chunk_index: 'asc',
      },
      select: {
        chunk_index: true,
      },
    });

    return chunks.map((item) => item.chunk_index);
  }

  /**
   * 推导上传会话过期时间。
   */
  private buildSessionExpiredAt() {
    const expiredAt = new Date();
    expiredAt.setHours(expiredAt.getHours() + UPLOAD_SESSION_EXPIRE_HOURS);
    return expiredAt;
  }

  /**
   * 统一判断上传会话是否过期。
   */
  private isSessionExpired(session: { expired_at: Date | null }) {
    return session.expired_at ? session.expired_at.getTime() <= Date.now() : false;
  }

  /**
   * 计算缓冲区内容的 SHA-256 哈希。
   */
  private computeHash(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 基于标题和文件名推导最终文档标题。
   */
  private resolveDocumentTitle(title: string | null | undefined, fileName: string) {
    const normalizedTitle = title?.trim();
    if (normalizedTitle) {
      return normalizedTitle;
    }

    return fileName.replace(/\.[^.]+$/, '');
  }

  /**
   * 将扩展名收敛为不带点的文件类型标识。
   */
  private resolveFileType(extension: string | null | undefined) {
    return (extension || '').replace('.', '') || 'txt';
  }

  /**
   * 将上传会话 ID 从字符串解析为 bigint。
   */
  private parseUploadId(uploadId: string) {
    try {
      return BigInt(uploadId);
    } catch {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '上传会话 ID 格式不正确');
    }
  }
}
