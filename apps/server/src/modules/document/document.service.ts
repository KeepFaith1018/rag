import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, b_document_processing_tasks } from '@prisma-client';
import { createHash } from 'crypto';
import { extname } from 'path';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { PrismaService } from '@common/prisma/prisma.service';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { FileStorageService } from '@common/storage/file-storage.service';
import { QdrantService } from '@common/vector/qdrant.service';
import { ElasticsearchService } from '@common/vector/elasticsearch.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { ListDocumentProcessingTasksDto } from './dto/list-document-processing-tasks.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { KbPermissionService } from '../knowledge-base/permission/kb-permission.service';
import { KbPermissionContext } from '../knowledge-base/interfaces/kb-permission.interface';
import {
  MAX_DOCUMENT_FILE_SIZE,
  resolveDocumentMimeType,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from './document.constants';
import { DocumentQueueService } from './queue/document-queue.service';
import { DocumentProcessingStateService } from './services/document-processing-state.service';
import { DocumentProcessingTaskService } from './services/document-processing-task.service';
import {
  DOCUMENT_QUEUE_ENQUEUE_ERROR_CODE,
  DOCUMENT_PROCESSING_STAGE,
} from './document-processing.constants';

type DocumentWithUploader = Prisma.b_documentsGetPayload<{
  include: {
    b_users: {
      select: {
        id: true;
        email: true;
        full_name: true;
        avatar_url: true;
      };
    };
    _count: {
      select: {
        document_chunks: true;
      };
    };
  };
}>;

type UploadedDocumentFile = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
};

type DocumentProcessingTaskRecord = b_document_processing_tasks;

/**
 * 负责知识库文档元数据管理、文件存储编排与资源级权限判断。
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbPermissionService: KbPermissionService,
    private readonly fileStorageService: FileStorageService,
    private readonly qdrantService: QdrantService,
    private readonly elasticsearchService: ElasticsearchService,
    private readonly documentQueueService: DocumentQueueService,
    private readonly documentProcessingStateService: DocumentProcessingStateService,
    private readonly documentProcessingTaskService: DocumentProcessingTaskService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 上传文档并落库，后续可在此基础上继续接入异步解析队列。
   */
  async upload(
    userId: number,
    kbId: string,
    file: UploadedDocumentFile | undefined,
    dto: UploadDocumentDto,
  ) {
    if (!file) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '请上传文档文件');
    }

    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'uploadDocument',
      );
      const normalizedFile = this.validateAndNormalizeFile(file);
      const savedFile = await this.fileStorageService.saveKnowledgeBaseDocument(
        normalizedFile.buffer,
        {
          kbId,
          extension: normalizedFile.extension,
        },
      );

      const document = await this.prisma.b_documents.create({
        data: {
          kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
          uploader_id: BigInt(userId),
          title: this.resolveDocumentTitle(
            dto.title,
            normalizedFile.originalName,
          ),
          original_filename: normalizedFile.originalName,
          file_path: savedFile.relativePath.replace(/\\/g, '/'),
          file_hash: this.computeHash(normalizedFile.buffer),
          file_size: BigInt(normalizedFile.size),
          file_type: normalizedFile.fileType,
          mime_type: normalizedFile.mimeType,
          status: DOCUMENT_PROCESSING_STAGE.UPLOADED,
          processing_version: 1,
          current_stage: DOCUMENT_PROCESSING_STAGE.UPLOADED,
          retry_count: 0,
        },
        include: {
          b_users: {
            select: {
              id: true,
              email: true,
              full_name: true,
              avatar_url: true,
            },
          },
          _count: {
            select: {
              document_chunks: true,
            },
          },
        },
      });

      try {
        await this.documentQueueService.enqueueDocumentProcessing(
          this.buildDocumentProcessingJobPayload({
            documentId: document.id,
            kbId,
            processingVersion: document.processing_version,
            triggerType: 'upload',
            requestedBy: userId,
          }),
        );
        await this.documentProcessingStateService.markQueued(
          document.id,
          document.processing_version,
        );
        this.eventEmitter.emit('document.state.changed', {
          kbId,
          documentId: document.id.toString(),
          status: DOCUMENT_PROCESSING_STAGE.QUEUED,
          currentStage: DOCUMENT_PROCESSING_STAGE.QUEUED,
          processingVersion: document.processing_version,
        });
      } catch (error) {
        await this.rollbackUploadedDocument(document.id, document.file_path);
        throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
          message: '文档已上传，但解析任务入队失败，请稍后重试',
          cause: error,
          context: {
            module: 'DocumentService',
            action: 'upload.enqueue',
            userId,
            kbId,
            documentId: document.id.toString(),
          },
        });
      }

      const queuedDocument = await this.getDocumentOrThrow(
        kbId,
        document.id.toString(),
      );

      return {
        ...this.buildDocumentItem(queuedDocument),
        kbPermission: permission,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'upload',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 获取指定知识库下的文档列表。
   */
  async list(userId: number, kbId: string, query: ListDocumentsDto) {
    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'read',
      );
      const normalized = this.normalizeListQuery(query);
      const pagination = this.buildPagination(
        normalized.page,
        normalized.pageSize,
      );
      const where = this.buildDocumentWhere(kbId, normalized);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.b_documents.findMany({
          where,
          include: {
            b_users: {
              select: {
                id: true,
                email: true,
                full_name: true,
                avatar_url: true,
              },
            },
            _count: {
              select: {
                document_chunks: true,
              },
            },
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.b_documents.count({ where }),
      ]);

      return {
        kbId,
        kbPermission: permission,
        list: items.map((item) => this.buildDocumentItem(item)),
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          total,
        },
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'list',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 获取单个文档详情。
   */
  async detail(userId: number, kbId: string, documentId: string) {
    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'read',
      );
      const document = await this.getDocumentOrThrow(kbId, documentId);
      const recentTasks =
        await this.documentProcessingTaskService.getRecentDocumentTasks(
          document.id,
          10,
        );

      return {
        ...this.buildDocumentItem(document),
        processingOverview: this.buildDocumentProcessingOverview(
          document,
          recentTasks,
        ),
        recentProcessingTasks: recentTasks.map((item) =>
          this.buildDocumentProcessingTaskItem(item),
        ),
        kbPermission: permission,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'detail',
          userId,
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 获取指定文档的处理任务记录列表。
   */
  async listProcessingTasks(
    userId: number,
    kbId: string,
    documentId: string,
    query: ListDocumentProcessingTasksDto,
  ) {
    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'read',
      );
      const document = await this.getDocumentOrThrow(kbId, documentId);
      const normalized = this.normalizeProcessingTaskQuery(query);
      const pagination = this.buildPagination(
        normalized.page,
        normalized.pageSize,
      );
      const result = await this.documentProcessingTaskService.listDocumentTasks(
        {
          documentId: document.id,
          processingVersion: normalized.processingVersion,
          stage: normalized.stage,
          status: normalized.status,
          skip: pagination.skip,
          take: pagination.take,
        },
      );

      return {
        kbId,
        documentId,
        kbPermission: permission,
        currentStage: document.current_stage,
        currentProcessingVersion: document.processing_version,
        filters: {
          status: normalized.status ?? null,
          stage: normalized.stage ?? null,
          processingVersion: normalized.processingVersion ?? null,
        },
        list: result.items.map((item) =>
          this.buildDocumentProcessingTaskItem(item),
        ),
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          total: result.total,
        },
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'listProcessingTasks',
          userId,
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 构建文档下载所需的文件流信息。
   */
  async getDownloadPayload(userId: number, kbId: string, documentId: string) {
    try {
      await this.kbPermissionService.authorize(
        userId,
        kbId,
        'downloadDocument',
      );
      const document = await this.getDocumentOrThrow(kbId, documentId);
      if (!this.fileStorageService.exists(document.file_path)) {
        throw new BusinessException(
          ErrorCode.FILE_NOT_FOUND,
          '文档源文件不存在',
        );
      }

      return {
        fileName: document.original_filename ?? document.title,
        mimeType: document.mime_type ?? 'application/octet-stream',
        stream: this.fileStorageService.createFileReadStream(
          document.file_path,
        ),
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'getDownloadPayload',
          userId,
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 文档预览载荷 — 获取可读流用于浏览器内预览。
   *
   * PDF/TXT/MD 返回 inline 模式（浏览器直接渲染），
   * DOCX 等二进制格式降级为 attachment 触发下载。
   */
  async getPreviewPayload(kbId: string, documentId: string) {
    try {
      const document = await this.getDocumentOrThrow(kbId, documentId);
      if (!this.fileStorageService.exists(document.file_path)) {
        throw new BusinessException(
          ErrorCode.FILE_NOT_FOUND,
          '文档源文件不存在',
        );
      }

      const isInline = ['pdf', 'txt', 'md'].includes(document.file_type ?? '');

      return {
        fileName: document.original_filename ?? document.title,
        mimeType: isInline ? (document.mime_type ?? 'application/octet-stream') : 'application/octet-stream',
        disposition: isInline ? 'inline' : `attachment; filename="${encodeURIComponent(document.original_filename ?? document.title)}"`,
        stream: this.fileStorageService.createFileReadStream(document.file_path),
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'getPreviewPayload',
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 删除文档，并同步清理本地源文件。
   */
  async remove(userId: number, kbId: string, documentId: string) {
    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'read',
      );
      const document = await this.getDocumentOrThrow(kbId, documentId);
      this.assertCanManageDocument(permission, document.uploader_id, 'delete');

      await this.qdrantService.deleteByDocument(document.id.toString());
      await this.elasticsearchService.deleteByDocument(document.id.toString());
      await this.prisma.b_documents.delete({
        where: {
          id: document.id,
        },
      });
      await this.fileStorageService.deleteFile(document.file_path);

      return {
        kbId,
        documentId,
        removed: true,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'remove',
          userId,
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 重置文档状态，作为后续异步重解析编排的入口。
   */
  async reparse(userId: number, kbId: string, documentId: string) {
    try {
      const permission = await this.kbPermissionService.authorize(
        userId,
        kbId,
        'read',
      );
      const document = await this.getDocumentOrThrow(kbId, documentId);
      this.assertCanManageDocument(permission, document.uploader_id, 'reparse');
      await this.qdrantService.deleteByDocumentVersion(
        document.id.toString(),
        document.processing_version,
      );
      await this.elasticsearchService.deleteByDocumentVersion(
        document.id.toString(),
        document.processing_version,
      );
      const nextProcessingVersion = document.processing_version + 1;

      await this.prisma.$transaction([
        this.prisma.b_document_chunks.deleteMany({
          where: {
            doc_id: document.id,
          },
        }),
      ]);
      await this.documentProcessingStateService.resetForReparse(
        document.id,
        nextProcessingVersion,
      );

      try {
        await this.documentQueueService.enqueueDocumentProcessing(
          this.buildDocumentProcessingJobPayload({
            documentId: document.id,
            kbId,
            processingVersion: nextProcessingVersion,
            triggerType: 'reparse',
            requestedBy: userId,
          }),
        );
        await this.documentProcessingStateService.markQueued(
          document.id,
          nextProcessingVersion,
        );
        this.eventEmitter.emit('document.state.changed', {
          kbId,
          documentId: document.id.toString(),
          status: DOCUMENT_PROCESSING_STAGE.QUEUED,
          currentStage: DOCUMENT_PROCESSING_STAGE.QUEUED,
          processingVersion: nextProcessingVersion,
        });
      } catch (error) {
        await this.documentProcessingStateService.markQueueEnqueueFailed(
          document.id,
          nextProcessingVersion,
          DOCUMENT_QUEUE_ENQUEUE_ERROR_CODE,
          '文档重解析任务入队失败，请稍后重试',
        );
        throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
          message: '文档重解析任务入队失败，请稍后重试',
          cause: error,
          context: {
            module: 'DocumentService',
            action: 'reparse.enqueue',
            userId,
            kbId,
            documentId,
            processingVersion: nextProcessingVersion,
          },
        });
      }

      return {
        kbId,
        documentId,
        reparsed: true,
        status: DOCUMENT_PROCESSING_STAGE.QUEUED,
        processingVersion: nextProcessingVersion,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'DocumentService',
          action: 'reparse',
          userId,
          kbId,
          documentId,
        },
      });
    }
  }

  /**
   * 查询指定知识库中的文档详情。
   */
  private async getDocumentOrThrow(kbId: string, documentId: string) {
    const document = await this.prisma.b_documents.findFirst({
      where: {
        id: this.parseDocumentId(documentId),
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
      },
      include: {
        b_users: {
          select: {
            id: true,
            email: true,
            full_name: true,
            avatar_url: true,
          },
        },
        _count: {
          select: {
            document_chunks: true,
          },
        },
      },
    });

    if (!document) {
      throw new BusinessException(ErrorCode.FILE_NOT_FOUND, '文档不存在');
    }

    return document;
  }

  /**
   * 校验并归一化上传文件基础信息。
   */
  private validateAndNormalizeFile(file: UploadedDocumentFile) {
    const extension = extname(file.originalname).toLowerCase();
    if (
      !SUPPORTED_DOCUMENT_EXTENSIONS.includes(
        extension as (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number],
      )
    ) {
      throw new BusinessException(ErrorCode.FILE_TYPE_UNSUPPORTED);
    }
    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      throw new BusinessException(ErrorCode.FILE_TOO_LARGE);
    }

    return {
      buffer: file.buffer,
      size: file.size,
      originalName: file.originalname,
      extension,
      fileType: extension.replace('.', ''),
      mimeType: file.mimetype || resolveDocumentMimeType(extension),
    };
  }

  /**
   * 根据上传表单和源文件名推导文档标题。
   */
  private resolveDocumentTitle(
    title: string | undefined,
    originalName: string,
  ) {
    const normalizedTitle = title?.trim();
    if (normalizedTitle) {
      return normalizedTitle;
    }

    return originalName.replace(/\.[^.]+$/, '');
  }

  /**
   * 计算文件内容的 SHA-256 哈希值。
   */
  private computeHash(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 归一化列表查询参数。
   */
  private normalizeListQuery(query: ListDocumentsDto) {
    return {
      keyword: query.keyword?.trim(),
      status: query.status,
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 10, 100),
    };
  }

  /**
   * 归一化文档处理任务查询参数。
   */
  private normalizeProcessingTaskQuery(query: ListDocumentProcessingTasksDto) {
    return {
      status: query.status,
      stage: query.stage,
      processingVersion: query.processingVersion
        ? this.parseProcessingVersion(query.processingVersion)
        : undefined,
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 10, 100),
    };
  }

  /**
   * 构造文档列表查询条件。
   */
  private buildDocumentWhere(
    kbId: string,
    query: ReturnType<typeof this.normalizeListQuery>,
  ): Prisma.b_documentsWhereInput {
    const conditions: Prisma.b_documentsWhereInput[] = [
      {
        kb_id: this.kbPermissionService.parseKnowledgeBaseId(kbId),
      },
    ];

    if (query.status) {
      conditions.push({
        status: query.status,
      });
    }

    // 关键字同时匹配标题与原始文件名，便于前端检索。
    if (query.keyword) {
      conditions.push({
        OR: [
          {
            title: {
              contains: query.keyword,
            },
          },
          {
            original_filename: {
              contains: query.keyword,
            },
          },
        ],
      });
    }

    return {
      AND: conditions,
    };
  }

  /**
   * 计算分页偏移量。
   */
  private buildPagination(page: number, pageSize: number) {
    return {
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  /**
   * 统一输出文档列表和详情结构。
   */
  private buildDocumentItem(document: DocumentWithUploader) {
    return {
      id: document.id.toString(),
      kbId: document.kb_id.toString(),
      title: document.title,
      originalFilename: document.original_filename,
      filePath: document.file_path,
      fileHash: document.file_hash,
      fileSize: document.file_size?.toString() ?? '0',
      fileType: document.file_type,
      mimeType: document.mime_type,
      status: document.status,
      processingVersion: document.processing_version,
      currentStage: document.current_stage,
      lastErrorStage: document.last_error_stage,
      retryCount: document.retry_count,
      lastErrorCode: document.last_error_code,
      errorMessage: document.error_msg,
      tokenCount: document.token_count ?? 0,
      chunkCount: document._count.document_chunks,
      parseStartedAt: document.parse_started_at,
      parseFinishedAt: document.parse_finished_at,
      lastReparseAt: document.last_reparse_at,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
      uploader: document.b_users
        ? {
            userId: document.b_users.id.toString(),
            email: document.b_users.email,
            fullName: document.b_users.full_name,
            avatarUrl: document.b_users.avatar_url,
          }
        : null,
    };
  }

  /**
   * 统一输出文档处理任务结构。
   */
  private buildDocumentProcessingTaskItem(task: DocumentProcessingTaskRecord) {
    return {
      id: task.id.toString(),
      documentId: task.document_id.toString(),
      processingVersion: task.processing_version,
      jobId: task.job_id,
      stage: task.stage,
      status: task.status,
      attempt: task.attempt,
      errorCode: task.error_code,
      errorMessage: task.error_message,
      startedAt: task.started_at,
      finishedAt: task.finished_at,
      durationMs: task.duration_ms,
      heartbeatAt: task.heartbeat_at,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    };
  }

  /**
   * 构建文档详情页需要的处理概览信息。
   */
  private buildDocumentProcessingOverview(
    document: DocumentWithUploader,
    recentTasks: DocumentProcessingTaskRecord[],
  ) {
    const currentVersionTasks = recentTasks.filter(
      (task) => task.processing_version === document.processing_version,
    );
    const latestTask = recentTasks[0] ?? null;
    const latestFailedTask =
      recentTasks.find(
        (task) => task.status === 'failed' || task.status === 'timed_out',
      ) ?? null;

    return {
      currentStage: document.current_stage,
      currentProcessingVersion: document.processing_version,
      retryCount: document.retry_count,
      lastErrorCode: document.last_error_code,
      lastErrorStage: document.last_error_stage,
      errorMessage: document.error_msg,
      latestTask: latestTask
        ? this.buildDocumentProcessingTaskItem(latestTask)
        : null,
      latestFailedTask: latestFailedTask
        ? this.buildDocumentProcessingTaskItem(latestFailedTask)
        : null,
      currentVersionTaskCount: currentVersionTasks.length,
      stageDurations: currentVersionTasks
        .filter((task) => task.duration_ms !== null)
        .map((task) => ({
          stage: task.stage,
          status: task.status,
          attempt: task.attempt,
          durationMs: task.duration_ms,
        })),
    };
  }

  /**
   * 在知识库权限通过后继续补充文档级删除 / 重解析权限判断。
   */
  private assertCanManageDocument(
    permission: KbPermissionContext,
    uploaderId: bigint | null,
    action: 'delete' | 'reparse',
  ) {
    const canManageAny =
      action === 'delete'
        ? permission.permissions.canDeleteAnyDocument
        : permission.permissions.canReparseAnyDocument;
    if (canManageAny) {
      return;
    }

    const canManageOwn =
      action === 'delete'
        ? permission.permissions.canDeleteOwnDocument
        : permission.permissions.canReparseOwnDocument;
    if (
      canManageOwn &&
      uploaderId &&
      uploaderId.toString() === permission.userId
    ) {
      return;
    }

    // 自己上传的文档判断需要基于当前用户，而 Guard 只缓存了知识库级权限，因此这里回退到角色权限语义。
    if (canManageOwn) {
      throw new BusinessException(
        ErrorCode.KNOWLEDGE_UNAUTHORIZED,
        action === 'delete'
          ? '你只能删除自己上传的文档'
          : '你只能重解析自己上传的文档',
      );
    }

    throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
  }

  /**
   * 将字符串形式的文档 ID 解析为 bigint。
   */
  private parseDocumentId(documentId: string) {
    try {
      return BigInt(documentId);
    } catch {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '文档 ID 格式不正确');
    }
  }

  /**
   * 将字符串形式的处理版本号解析为 number。
   */
  private parseProcessingVersion(processingVersion: string) {
    const parsedValue = Number(processingVersion);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '处理版本号格式不正确',
      );
    }

    return parsedValue;
  }

  /**
   * 统一构造文档处理入队载荷。
   */
  private buildDocumentProcessingJobPayload(options: {
    documentId: bigint;
    kbId: string;
    processingVersion: number;
    triggerType: 'upload' | 'reparse';
    requestedBy: number;
  }) {
    return {
      documentId: options.documentId.toString(),
      kbId: options.kbId,
      processingVersion: options.processingVersion,
      triggerType: options.triggerType,
      requestedBy: options.requestedBy.toString(),
      requestedAt: new Date().toISOString(),
    };
  }

  /**
   * 上传成功但入队失败时，回滚已创建的文档记录和源文件，避免残留脏数据。
   */
  private async rollbackUploadedDocument(documentId: bigint, filePath: string) {
    await this.prisma.b_documents.delete({
      where: {
        id: documentId,
      },
    });
    await this.fileStorageService.deleteFile(filePath);
  }
}
