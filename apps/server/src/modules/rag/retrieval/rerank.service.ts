import { Injectable, Logger, Inject } from '@nestjs/common';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RerankModelService } from './rerank-model.service';
import type { FusedHit } from './interfaces/fused-hit.interface';
import type { RerankedHit } from './interfaces/reranked-hit.interface';

export interface RerankParams {
  candidates: FusedHit[];
  originalQuery: string;
  rewrittenQuery?: string;
  questionType?: 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
  topN?: number;
}

/**
 * 检索结果重排序服务。
 *
 * 使用 qwen3-rerank 模型进行深度语义精排，
 * 失败时回退到轻量级文本重叠计分。
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

  constructor(
    private readonly rerankModelService: RerankModelService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 对融合后的候选列表执行 Re-rank 过滤。
   *
   * 优先使用 qwen3-rerank 模型获取语义相关性分数，
   * 失败时回退到轻量级文本重叠计分。
   */
  async rerank(params: RerankParams): Promise<RerankedHit[]> {
    const { candidates, originalQuery, topN = 10 } = params;

    if (!candidates.length) {
      return [];
    }

    try {
      // 优先使用 rerank 模型
      const { scores } = await this.rerankModelService.rerank({
        query: originalQuery,
        documents: candidates.map((c) => c.content),
        topN,
      });

      // 将 rerank 分数与 RRF 分数融合
      const maxFusionScore = candidates[0]?.fusionScore ?? 1;
      const results = candidates
        .map((c, i) => ({
          hit: c,
          rerankScore: scores[i] ?? 0,
          fusionScore:
            maxFusionScore > 0
              ? Math.round((c.fusionScore / maxFusionScore) * 1000) / 1000
              : c.fusionScore,
        }))
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, topN);

      return this.buildRerankedHits(results);
    } catch (error) {
      // 回退到轻量级过滤
      this.logger.warn(
        `[RerankService] qwen3-rerank 调用失败，回退到轻量级过滤: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.lightweightRerank(candidates, originalQuery, topN);
    }
  }

  /**
   * 轻量级文本重叠计分（回退方案）
   */
  private lightweightRerank(
    candidates: FusedHit[],
    originalQuery: string,
    topN: number,
  ): RerankedHit[] {
    const maxScore = candidates[0]?.fusionScore ?? 1;
    const normalized = candidates.map((c) => ({
      ...c,
      fusionScore:
        maxScore > 0
          ? Math.round((c.fusionScore / maxScore) * 1000) / 1000
          : c.fusionScore,
    }));

    const queryTokens = this.tokenize(originalQuery.toLowerCase());
    const scored = normalized.map((c) => {
      const contentLower = c.content.toLowerCase();
      const overlapCount = queryTokens.filter(
        (t) => t.length > 1 && contentLower.includes(t),
      ).length;
      const overlapRatio =
        queryTokens.length > 0 ? overlapCount / queryTokens.length : 0;
      const rerankScore =
        Math.round((c.fusionScore * 0.7 + overlapRatio * 0.3) * 1000) / 1000;

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

    return [...primary, ...secondary]
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, topN);
  }

  /**
   * 构建 RerankedHit 列表
   */
  private buildRerankedHits(
    results: Array<{ hit: FusedHit; rerankScore: number; fusionScore: number }>,
  ): RerankedHit[] {
    const scored = results.map((r) => {
      const primary = r.rerankScore >= this.PRIMARY_THRESHOLD;
      const secondary =
        r.rerankScore >= this.DISCARD_THRESHOLD &&
        r.rerankScore < this.PRIMARY_THRESHOLD;

      return {
        chunkId: r.hit.chunkId,
        docId: r.hit.docId,
        kbId: r.hit.kbId,
        content: r.hit.content,
        title: r.hit.title,
        fusionScore: r.fusionScore,
        rerankScore: r.rerankScore,
        payload: r.hit.payload,
        isPrimary: primary,
        isSecondary: secondary,
      } as RerankedHit & { isPrimary?: boolean; isSecondary?: boolean };
    });

    // 过滤分级
    const primary = scored.filter((h) => h.isPrimary);
    const secondary = scored
      .filter((h) => h.isSecondary)
      .slice(0, this.MAX_SECONDARY);

    const filtered = scored
      .filter((h) => h.isPrimary || h.isSecondary)
      .sort((a, b) => b.rerankScore - a.rerankScore);

    return filtered.map(({ isPrimary, isSecondary, ...hit }) => hit);
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