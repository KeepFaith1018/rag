import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-client';
import { createHash } from 'crypto';
import { extname } from 'path';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { PrismaService } from '@common/prisma/prisma.service';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { FileStorageService } from '@common/storage/file-storage.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { KbPermissionService } from '../knowledge-base/permission/kb-permission.service';
import { KbPermissionContext } from '../knowledge-base/interfaces/kb-permission.interface';
import {
  MAX_DOCUMENT_FILE_SIZE,
  resolveDocumentMimeType,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from './document.constants';

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

/**
 * 负责知识库文档元数据管理、文件存储编排与资源级权限判断。
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbPermissionService: KbPermissionService,
    private readonly fileStorageService: FileStorageService,
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
          status: 'uploaded',
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

      return {
        ...this.buildDocumentItem(document),
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

      return {
        ...this.buildDocumentItem(document),
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

      await this.prisma.$transaction([
        this.prisma.b_document_chunks.deleteMany({
          where: {
            doc_id: document.id,
          },
        }),
        this.prisma.b_documents.update({
          where: {
            id: document.id,
          },
          data: {
            status: 'uploaded',
            error_msg: null,
            token_count: 0,
            parse_started_at: null,
            parse_finished_at: null,
            last_reparse_at: new Date(),
            updated_at: new Date(),
          },
        }),
      ]);

      return {
        kbId,
        documentId,
        reparsed: true,
        status: 'uploaded',
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
}
