import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { RerankedHit } from '../interfaces/reranked-hit.interface';

export interface CreateCitationsParams {
  messageId: bigint;
  hits: RerankedHit[];
}

export interface CitationRecord {
  citationId: string;
  kbId: string;
  kbName?: string;
  docId: string;
  docTitle?: string;
  chunkId: string;
  quote: string;
  score: number;
}

/**
 * 引用构建服务。
 *
 * 负责将精排后的检索命中结果持久化为消息引用记录，
 * 并产出前端可直接消费的引用快照。
 */
@Injectable()
export class CitationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为指定消息创建引用记录。
   *
   * 每条 hit 生成一条 b_chat_message_citations 记录，
   * quote 字段截取 chunk 内容的前 200 个字符作为摘要。
   */
  async createCitations(params: CreateCitationsParams): Promise<CitationRecord[]> {
    const { messageId, hits } = params;

    if (!hits.length) {
      return [];
    }

    try {
      const records = hits.map((hit, index) => ({
        message_id: messageId,
        kb_id: this.toBigInt(hit.kbId),
        doc_id: this.toBigInt(hit.docId),
        chunk_id: this.toBigInt(hit.chunkId),
        score: hit.rerankScore,
        quote: hit.content.slice(0, 200),
        order_no: index,
      }));

      await this.prisma.b_chat_message_citations.createMany({
        data: records,
      });

      // 批量查询知识库名称和文档标题用于前端展示
      const kbIds = [...new Set(hits.map((h) => h.kbId))];
      const docIds = [...new Set(hits.map((h) => h.docId))];

      const [kbList, docList] = await Promise.all([
        this.prisma.b_knowledge_bases.findMany({
          where: { id: { in: kbIds.map((id) => this.toBigInt(id)) } },
          select: { id: true, name: true },
        }),
        this.prisma.b_documents.findMany({
          where: { id: { in: docIds.map((id) => this.toBigInt(id)) } },
          select: { id: true, title: true },
        }),
      ]);

      const kbNameMap = new Map(
        kbList.map((kb) => [String(kb.id), kb.name]),
      );
      const docTitleMap = new Map(
        docList.map((doc) => [String(doc.id), doc.title]),
      );

      return hits.map((hit, index) => ({
        citationId: `${messageId}-${index}`,
        kbId: hit.kbId,
        kbName: kbNameMap.get(hit.kbId),
        docId: hit.docId,
        docTitle: docTitleMap.get(hit.docId),
        chunkId: hit.chunkId,
        quote: hit.content.slice(0, 200),
        score: hit.rerankScore,
      }));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.CITATION_BUILD_FAILED, {
        context: {
          module: 'CitationService',
          action: 'createCitations',
          messageId: String(messageId),
          hitCount: hits.length,
        },
      });
    }
  }

  /**
   * 查询指定消息的引用列表。
   */
  async getCitationsByMessage(messageId: bigint): Promise<CitationRecord[]> {
    try {
      const citations = await this.prisma.b_chat_message_citations.findMany({
        where: { message_id: messageId },
        orderBy: { order_no: 'asc' },
      });

      if (!citations.length) {
        return [];
      }

      const kbIds = [...new Set(citations.map((c) => c.kb_id))];
      const docIds = [...new Set(citations.map((c) => c.doc_id))];

      const [kbList, docList] = await Promise.all([
        this.prisma.b_knowledge_bases.findMany({
          where: { id: { in: kbIds } },
          select: { id: true, name: true },
        }),
        this.prisma.b_documents.findMany({
          where: { id: { in: docIds } },
          select: { id: true, title: true },
        }),
      ]);

      const kbNameMap = new Map(kbList.map((kb) => [String(kb.id), kb.name]));
      const docTitleMap = new Map(
        docList.map((doc) => [String(doc.id), doc.title]),
      );

      return citations.map((c, index) => ({
        citationId: `${messageId}-${index}`,
        kbId: String(c.kb_id),
        kbName: kbNameMap.get(String(c.kb_id)),
        docId: String(c.doc_id),
        docTitle: docTitleMap.get(String(c.doc_id)),
        chunkId: String(c.chunk_id),
        quote: c.quote ?? '',
        score: c.score ?? 0,
      }));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.CITATION_BUILD_FAILED, {
        context: {
          module: 'CitationService',
          action: 'getCitationsByMessage',
          messageId: String(messageId),
        },
      });
    }
  }

  private toBigInt(value: string): bigint {
    try {
      return BigInt(value);
    } catch {
      throw new BusinessException(ErrorCode.PARAM_ERROR, {
        message: `无法解析 ID: ${value}`,
      });
    }
  }
}
