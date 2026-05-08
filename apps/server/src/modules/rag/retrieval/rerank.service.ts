import { Injectable, Logger, Inject } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RerankModelService } from './rerank-model.service';
import { tokenize, roundTo } from '@common/utils/retrieval.utils';
import { getErrorMessage } from '@common/utils/message.utils';
import type { QuestionType } from '@common/types/rag.types';
import type { FusedHit } from './interfaces/fused-hit.interface';
import type { RerankedHit } from './interfaces/reranked-hit.interface';

export interface RerankParams {
  candidates: FusedHit[];
  queries: string[];
  questionType?: QuestionType;
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
   *
   * 非事实类（对比/研究）使用多查询评分取 max，
   * 避免单主题块被原始对比查询误杀。
   */
  async rerank(params: RerankParams): Promise<RerankedHit[]> {
    const { candidates, queries, questionType = 'fact_lookup', topN = 10 } = params;

    if (!candidates.length) {
      return [];
    }

    try {
      const scores = await this.multiQueryRerank(candidates, queries, topN, questionType);

      const maxFusionScore = candidates[0]?.fusionScore ?? 1;
      const results = candidates
        .map((c, i) => {
          const baseScore = scores[i] ?? 0;
          // O7: titlePath 查询匹配加权
          const tpBoost = this.computeTitlePathBoost(c.payload, queries);
          const rerankScore = Math.min(baseScore * tpBoost, 1.0);
          return {
            hit: c,
            rerankScore,
            fusionScore:
              maxFusionScore > 0
                ? roundTo(c.fusionScore / maxFusionScore)
                : c.fusionScore,
          };
        })
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, topN);

      return this.buildRerankedHits(results, questionType);
    } catch (error) {
      this.logger.warn(
        `[RerankService] qwen3-rerank 调用失败，回退到轻量级过滤: ${
          getErrorMessage(error)
        }`,
      );
      return this.lightweightRerank(candidates, queries, questionType, topN);
    }
  }

  /**
   * 多查询 Rerank 评分。
   *
   * fact_lookup：仅用第一条查询评分（单查询）。
   * compare_analysis / research_or_open_world：用全部查询分别评分，取最大值，
   *   确保单主题块能从对应的子查询中获得高分。
   */
  private async multiQueryRerank(
    candidates: FusedHit[],
    queries: string[],
    topN: number,
    questionType: QuestionType,
  ): Promise<number[]> {
    if (questionType === 'fact_lookup') {
      const mainQuery = queries[0] ?? '';
      const { scores } = await this.rerankModelService.rerank({
        query: mainQuery,
        documents: candidates.map((c) => c.content),
        topN,
      });
      return scores;
    }

    // 多查询：每个候选取所有查询中的最高分
    const allScores: number[][] = await Promise.all(
      queries.map(async (q) => {
        const { scores } = await this.rerankModelService.rerank({
          query: q,
          documents: candidates.map((c) => c.content),
          topN,
        });
        return scores;
      }),
    );

    return candidates.map((_, i) =>
      Math.max(...allScores.map((scores) => scores[i] ?? 0)),
    );
  }

  /**
   * 轻量级文本重叠计分（回退方案）。
   *
   * fact_lookup：单查询计分。
   * 非事实类：多查询分别计分取 max。
   */
  private lightweightRerank(
    candidates: FusedHit[],
    queries: string[],
    questionType: QuestionType,
    topN: number,
  ): RerankedHit[] {
    const maxScore = candidates[0]?.fusionScore ?? 1;
    const normalized = candidates.map((c) => ({
      ...c,
      fusionScore:
        maxScore > 0
          ? roundTo(c.fusionScore / maxScore)
          : c.fusionScore,
    }));

    const scored = normalized.map((c) => {
      const contentLower = c.content.toLowerCase();
      let bestOverlapRatio = 0;
      for (const q of queries) {
        const queryTokens = tokenize(q.toLowerCase());
        if (!queryTokens.length) continue;
        const overlapCount = queryTokens.filter(
          (t) => t.length > 1 && contentLower.includes(t),
        ).length;
        const ratio = overlapCount / queryTokens.length;
        if (ratio > bestOverlapRatio) bestOverlapRatio = ratio;
        if (questionType === 'fact_lookup' && q === queries[0]) break;
      }

      const tpBoost = this.computeTitlePathBoost(c.payload, queries);
      const rerankScore = Math.min(
        roundTo((c.fusionScore * 0.7 + bestOverlapRatio * 0.3) * tpBoost),
        1.0,
      );

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

  private buildRerankedHits(
    results: Array<{ hit: FusedHit; rerankScore: number; fusionScore: number }>,
    _questionType: string = 'fact_lookup',
  ): RerankedHit[] {
    const PROCEDURAL_KEYWORDS = /教程|指南|配置|搭建|入门|实战|步骤|安装/;

    const scored = results.map((r) => {
      const title = (r.hit.title ?? (r.hit.payload?.['title'] as string) ?? '');
      const titleBonus = PROCEDURAL_KEYWORDS.test(title) ? 1.1 : 1.0;
      const adjustedScore = Math.min(r.rerankScore * titleBonus, 1.0);

      const primary = adjustedScore >= this.PRIMARY_THRESHOLD;
      const secondary =
        adjustedScore >= this.DISCARD_THRESHOLD &&
        adjustedScore < this.PRIMARY_THRESHOLD;

      return {
        chunkId: r.hit.chunkId,
        docId: r.hit.docId,
        kbId: r.hit.kbId,
        content: r.hit.content,
        title: r.hit.title,
        fusionScore: r.fusionScore,
        rerankScore: roundTo(adjustedScore),
        payload: r.hit.payload,
        isPrimary: primary,
        isSecondary: secondary,
      } as RerankedHit & { isPrimary?: boolean; isSecondary?: boolean };
    });

    const filtered = scored
      .filter((h) => h.isPrimary || h.isSecondary)
      .sort((a, b) => b.rerankScore - a.rerankScore);

    return filtered.map(({ isPrimary: _isPrimary, isSecondary: _isSecondary, ...hit }) => hit);
  }

  private computeTitlePathBoost(
    payload: Record<string, unknown>,
    queries: string[],
  ): number {
    const tpVal = payload['titlePath'];
    const tpArr: string[] = Array.isArray(tpVal)
      ? tpVal.map(String)
      : [];
    if (tpArr.length === 0) return 1.0;

    const tpLower = tpArr.join(' ').toLowerCase();
    let maxOverlap = 0;
    for (const q of queries) {
      const tokens = tokenize(q.toLowerCase());
      if (tokens.length === 0) continue;
      const matched = tokens.filter(
        (t) => t.length > 1 && tpLower.includes(t),
      ).length;
      const ratio = matched / tokens.length;
      if (ratio > maxOverlap) maxOverlap = ratio;
    }

    return maxOverlap > 0.5
      ? roundTo(1.0 + (maxOverlap - 0.5) * 0.2)
      : 1.0;
  }
}