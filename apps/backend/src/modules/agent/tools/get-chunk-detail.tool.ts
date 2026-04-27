import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

export interface ChunkDetail {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  pageNo?: number;
  charStart?: number;
  charEnd?: number;
  metadata?: unknown;
}

/**
 * 分片详情查询工具。
 *
 * 根据 chunkId 获取完整的分片内容和元数据信息，
 * 供 Agent 在校验或补充阶段深入查看特定分片。
 */
@Injectable()
export class GetChunkDetailTool {
  constructor(private readonly prisma: PrismaService) {}

  async execute(chunkId: string): Promise<ChunkDetail | null> {
    const parsedId = BigInt(chunkId);

    const chunk = await this.prisma.b_document_chunks.findUnique({
      where: { id: parsedId },
      include: {
        b_documents: {
          select: { id: true, kb_id: true, title: true },
        },
      },
    });

    if (!chunk) {
      throw new BusinessException(ErrorCode.NOT_FOUND, {
        message: `分片 ${chunkId} 不存在`,
      });
    }

    return {
      chunkId: String(chunk.id),
      docId: String(chunk.doc_id),
      kbId: String(chunk.b_documents.kb_id),
      content: chunk.content,
      title: chunk.b_documents.title,
      pageNo: chunk.page_no ?? undefined,
      charStart: chunk.char_start ?? undefined,
      charEnd: chunk.char_end ?? undefined,
      metadata: chunk.metadata_json,
    };
  }
}
