import { Injectable } from '@nestjs/common';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { FusedHit } from '../interfaces/fused-hit.interface';
import type { RerankedHit } from '../interfaces/reranked-hit.interface';

export interface RerankParams {
  candidates: FusedHit[];
  originalQuery: string;
  rewrittenQuery?: string;
  questionType?: 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
}

/**
 * 检索结果重排序服务。
 *
 * 首版采用基于分数的动态阈值过滤策略，后续阶段可接入
 * Cross-Encoder Reranker 模型（如 Cohere、BGE-Reranker）做深度语义精排。
 *
 * 过滤策略：
 * - 低于 0.5 直接丢弃
 * - 高于 0.7 作为主证据
 * - 0.5 ~ 0.7 保留前 2 条作为候补证据
 */
@Injectable()
export class RerankService {
  /** RRF 分数归一化后低于此阈值直接丢弃 */
  private readonly DISCARD_THRESHOLD = 0.5;
  /** RRF 分数高于此阈值视为主证据 */
  private readonly PRIMARY_THRESHOLD = 0.7;
  /** 中间区段最多保留的候补证据数 */
  private readonly MAX_SECONDARY = 2;

  /**
   * 对融合后的候选列表执行 Re-rank 过滤。
   *
   * 当前阶段通过 RRF 分数阈值进行轻量过滤，并为每条结果
   * 生成基于原始 query 与 chunk 内容的简单文本匹配加分。
   */
  async rerank(params: RerankParams): Promise<RerankedHit[]> {
    const { candidates, originalQuery } = params;

    if (!candidates.length) {
      return [];
    }

    try {
      // 先归一化 RRF 分数（后续换 Cross-Encoder 可以直接替换此步骤）
      const maxScore = candidates[0]?.fusionScore ?? 1;
      const normalized = candidates.map((c) => ({
        ...c,
        fusionScore: maxScore > 0
          ? Math.round((c.fusionScore / maxScore) * 1000) / 1000
          : c.fusionScore,
      }));

      // 文本匹配加分：query 与 chunk content 的词汇重叠率
      const queryTokens = this.tokenize(originalQuery.toLowerCase());
      const scored = normalized.map((c) => {
        const contentLower = c.content.toLowerCase();
        const overlapCount = queryTokens.filter(
          (t) => t.length > 1 && contentLower.includes(t),
        ).length;
        const overlapRatio = queryTokens.length > 0
          ? overlapCount / queryTokens.length
          : 0;
        // RRF 归一化分数 70% + 文本匹配 30%
        const rerankScore = Math.round(
          (c.fusionScore * 0.7 + overlapRatio * 0.3) * 1000,
        ) / 1000;

        return {
          chunkId: c.chunkId,
          docId: c.docId,
          kbId: c.kbId,
          content: c.content,
          title: c.title,
          fusionScore: c.fusionScore,
          rerankScore,
          payload: c.payload,
        } satisfies RerankedHit;
      });

      // 过滤 + 分级
      const primary = scored.filter(
        (h) => h.rerankScore >= this.PRIMARY_THRESHOLD,
      );
      const secondary = scored
        .filter(
          (h) =>
            h.rerankScore >= this.DISCARD_THRESHOLD &&
            h.rerankScore < this.PRIMARY_THRESHOLD,
        )
        .slice(0, this.MAX_SECONDARY);

      return [...primary, ...secondary].sort(
        (a, b) => b.rerankScore - a.rerankScore,
      );
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new BusinessException(ErrorCode.RERANK_FAILED, {
        message: 'Rerank 失败',
        cause: error,
        context: { candidateCount: candidates.length },
      });
    }
  }

  /**
   * 简单分词，供文本匹配计分使用。
   */
  private tokenize(text: string): string[] {
    return text
      .split(/[\s,，。！？、；：""''（）\(\)\[\]【】{}<>\/\\|@#$%^&*+=~`]+/)
      .filter((t) => t.length > 1);
  }
}
