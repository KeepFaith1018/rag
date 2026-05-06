import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { ListPublicKbDocumentsDto } from './dto/list-public-kb-documents.dto';

@Injectable()
export class PublicKbDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async findByKbId(kbId: string, query: ListPublicKbDocumentsDto) {
    try {
      const { page = 1, pageSize = 20, title, status } = query;
      const skip = (page - 1) * pageSize;

      // 校验知识库存在且为公开
      const kb = await this.prisma.b_knowledge_bases.findUnique({
        where: { id: BigInt(kbId) },
        select: {
          id: true,
          name: true,
          visibility: true,
          is_public: true,
        },
      });

      if (!kb) {
        return { kbInfo: null, list: [], total: 0, page, pageSize };
      }

      const where: Record<string, unknown> = { kb_id: BigInt(kbId) };
      if (title) where.title = { contains: title };
      if (status) where.status = status;

      const [documents, total] = await Promise.all([
        this.prisma.b_documents.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { updated_at: 'desc' },
          select: {
            id: true,
            title: true,
            original_filename: true,
            file_type: true,
            mime_type: true,
            status: true,
            current_stage: true,
            token_count: true,
            created_at: true,
            updated_at: true,
            uploader_id: true,
          },
        }),
        this.prisma.b_documents.count({ where }),
      ]);

      return {
        kbInfo: {
          id: kb.id.toString(),
          name: kb.name,
          visibility: kb.visibility,
          isPublic: kb.is_public,
        },
        list: documents.map((doc) => ({
          id: doc.id.toString(),
          title: doc.title,
          originalFilename: doc.original_filename,
          fileType: doc.file_type,
          mimeType: doc.mime_type,
          status: doc.status,
          currentStage: doc.current_stage,
          tokenCount: doc.token_count,
          uploaderId: doc.uploader_id?.toString(),
          createdAt: doc.created_at.toISOString(),
          updatedAt: doc.updated_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'PublicKbDocumentService', action: 'findByKbId', kbId },
      });
    }
  }
}
