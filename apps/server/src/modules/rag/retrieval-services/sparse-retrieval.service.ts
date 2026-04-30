import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { SparseHit } from '../retrieval-interfaces/sparse-hit.interface';

export interface SparseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
}

/**
 * 关键词稀疏检索服务。
 *
 * 首版采用"应用层轻量倒排索引"策略：
 * 将查询分词后，对 b_document_chunks 做 OR-contains 匹配，
 * 按关键词命中数与文本长度加权计分。
 */
@Injectable()
export class SparseRetrievalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 对多条查询文本分别提取关键词并检索，
   * 汇总按 chunkId 去重后返回 Top-K 结果。
   */
  async retrieve(params: SparseRetrieveParams): Promise<SparseHit[]> {
    const { queries, kbIds, topK } = params;

    if (!queries.length || !kbIds.length) {
      return [];
    }

    // 从所有查询文本中提取合并关键词
    const allKeywords = this.extractKeywords(queries.join(' '));

    if (!allKeywords.length) {
      return [];
    }

    // 对每个知识库分别检索（Prisma OR 条件内不直接支持 JOIN 过滤）
    const resultGroups = await Promise.all(
      kbIds.map((kbId) => this.searchByKb(kbId, allKeywords, topK)),
    );

    // 按 chunkId 去重，保留最高分
    const seen = new Map<string, SparseHit>();
    for (const group of resultGroups) {
      for (const hit of group) {
        const existing = seen.get(hit.chunkId);
        if (!existing || hit.score > existing.score) {
          seen.set(hit.chunkId, hit);
        }
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * 在指定知识库内按关键词检索分片。
   *
   * 通过 b_document_chunks JOIN b_documents 限定 kb_id，
   * 对每个关键词做 content 包含匹配，按命中数计分。
   */
  private async searchByKb(
    kbId: string,
    keywords: string[],
    topK: number,
  ): Promise<SparseHit[]> {
    try {
      // 使用 Prisma raw query 进行跨表关键词检索
      // 构建 OR 条件的 LIKE 子句
      const likeClauses = keywords.map(() => 'dc.content LIKE ?').join(' OR ');
      const likeParams = keywords.map((kw) => `%${kw}%`);

      const sql = `
        SELECT
          dc.id AS chunkId,
          dc.doc_id AS docId,
          d.kb_id AS kbId,
          dc.content,
          d.title,
          '' AS titlePath,
          '' AS keywordText
        FROM b_document_chunks dc
        INNER JOIN b_documents d ON d.id = dc.doc_id
        WHERE d.kb_id = ?
          AND (${likeClauses})
        LIMIT ?
      `;

      const rows: Array<{
        chunkId: bigint;
        docId: bigint;
        kbId: bigint;
        content: string;
        title: string | null;
        titlePath: string;
        keywordText: string;
      }> = await this.prisma.$queryRawUnsafe(
        sql,
        BigInt(kbId),
        ...likeParams,
        topK * 2, // 多取一些供计分后截断
      );

      // 计算每条结果的匹配分数
      const scored = rows.map((row) => {
        const lowerContent = row.content.toLowerCase();
        const matchCount = keywords.filter((kw) =>
          lowerContent.includes(kw.toLowerCase()),
        ).length;

        // 分数 = 关键词命中率 * 归一化因子（短文本精确匹配加权）
        const keywordRatio = matchCount / keywords.length;
        const lengthFactor = Math.min(1, 200 / Math.max(1, row.content.length));
        const score = keywordRatio * 0.7 + lengthFactor * 0.3;

        return {
          chunkId: String(row.chunkId),
          docId: String(row.docId),
          kbId: String(row.kbId),
          content: row.content,
          title: row.title ?? undefined,
          titlePath: row.titlePath || undefined,
          keywordText: row.keywordText || undefined,
          score: Math.round(score * 1000) / 1000,
        } satisfies SparseHit;
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new BusinessException(ErrorCode.SPARSE_RETRIEVAL_FAILED, {
        message: '关键词检索失败',
        cause: error,
        context: { kbId, keywordCount: keywords.length },
      });
    }
  }

  /**
   * 从查询文本中提取关键词。
   *
   * 首版采用简单分词策略：按空格/标点切分，过滤停用词和单字词。
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
      '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
      '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
      '所', '为', '所以', '因为', '但是', '然而', '如果', '虽然', '可以',
      '这个', '那个', '什么', '怎么', '怎样', '哪', '哪里', '吗', '吧',
      '呢', '啊', '哦', '嗯', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
    ]);

    // 按中英文标点与空格切分
    const raw = text
      .split(/[\s,，。！？、；：""''（）\(\)\[\]【】{}<>\/\\|@#$%^&*+=~`]+/)
      .filter(Boolean);

    // 去重 + 过滤停用词 + 过滤单字（中文）或短词（英文 < 2 字符）
    const seen = new Set<string>();
    const keywords: string[] = [];

    for (const token of raw) {
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      if (stopWords.has(lower)) continue;
      // 纯英文短词过滤
      if (/^[a-z]$/.test(lower)) continue;
      // 单字中文（但保留有意义的单字如专业术语）
      if (lower.length === 1 && /[一-鿿]/.test(lower)) continue;

      seen.add(lower);
      keywords.push(lower);
    }

    // 限制关键词数量防止 SQL 过长
    return keywords.slice(0, 10);
  }
}
