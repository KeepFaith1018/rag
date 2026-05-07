import { Injectable } from '@nestjs/common';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { DenseHit } from './interfaces/dense-hit.interface';
import type { SparseHit } from './interfaces/sparse-hit.interface';
import type { FusedHit } from './interfaces/fused-hit.interface';

export interface FusionParams {
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  topK: number;
  /** RRF 平滑因子，默认 60 */
  k?: number;
}

/**
 * 混合检索融合服务。
 *
 * 采用 Reciprocal Rank Fusion (RRF) 算法对稠密向量检索与
 * 稀疏关键词检索的结果进行融合排序，对同一 chunk 的多路命中做去重合并。
 */
@Injectable()
export class FusionService {
  /**
   * 执行 RRF 融合。
   *
   * RRF 公式：score(chunk) = Σ 1 / (k + rank_i)
   * 其中 rank_i 表示该 chunk 在第 i 路检索结果中的排名（从 1 开始），
   * k 为平滑因子，用于降低单路极高排名对最终分数的过度影响。
   */
  fuse(params: FusionParams): FusedHit[] {
    const { denseHits, sparseHits, topK, k = 60 } = params;

    if (!denseHits.length && !sparseHits.length) {
      return [];
    }

    try {
      // 构建 chunkId → 各路排名 的映射
      const denseRankMap = this.buildRankMap(denseHits, 'chunkId');
      const sparseRankMap = this.buildRankMap(sparseHits, 'chunkId');

      // 收集所有唯一的 chunkId
      const allChunkIds = new Set([
        ...denseRankMap.keys(),
        ...sparseRankMap.keys(),
      ]);

      // 融合数据容器
      const payloadMap = new Map<string, Record<string, unknown>>();
      for (const hit of denseHits) {
        payloadMap.set(hit.chunkId, hit.payload);
      }

      const contentMap = new Map<string, string>();
      const docIdMap = new Map<string, string>();
      const kbIdMap = new Map<string, string>();
      const titleMap = new Map<string, string>();

      for (const hit of denseHits) {
        contentMap.set(hit.chunkId, hit.content);
        docIdMap.set(hit.chunkId, hit.docId);
        kbIdMap.set(hit.chunkId, hit.kbId);
      }
      for (const hit of sparseHits) {
        if (!contentMap.has(hit.chunkId)) {
          contentMap.set(hit.chunkId, hit.content);
          docIdMap.set(hit.chunkId, hit.docId);
          kbIdMap.set(hit.chunkId, hit.kbId);
        }
        if (hit.title && !titleMap.has(hit.chunkId)) {
          titleMap.set(hit.chunkId, hit.title);
        }
      }

      // E12: 基于 Shannon 熵的置信度加权 — 分数分布越集中置信度越高
      const denseConf = this.computePathConfidence(denseHits);
      const sparseConf = this.computePathConfidence(sparseHits);

      // 计算每个 chunk 的 RRF 分数
      const fusedList: FusedHit[] = [];

      for (const chunkId of allChunkIds) {
        const denseRank = denseRankMap.get(chunkId);
        const sparseRank = sparseRankMap.get(chunkId);

        let fusionScore = 0;
        if (denseRank !== undefined) {
          fusionScore += denseConf / (k + (denseRank));
        }
        if (sparseRank !== undefined) {
          fusionScore += sparseConf / (k + (sparseRank));
        }

        // O7: 基于 chunk 元数据的质量加权
        fusionScore *= this.computeQualityMultiplier(
          payloadMap.get(chunkId),
        );

        const denseHit = denseHits.find((h) => h.chunkId === chunkId);
        const sparseHit = sparseHits.find((h) => h.chunkId === chunkId);

        fusedList.push({
          chunkId,
          docId: docIdMap.get(chunkId) ?? '',
          kbId: kbIdMap.get(chunkId) ?? '',
          content: contentMap.get(chunkId) ?? '',
          title: titleMap.get(chunkId),
          fusionScore: Math.round(fusionScore * 1_000_000) / 1_000_000,
          denseScore: denseHit?.score,
          sparseScore: sparseHit?.score,
          denseRank: denseRank !== undefined ? (denseRank) + 1 : undefined,
          sparseRank: sparseRank !== undefined ? (sparseRank) + 1 : undefined,
          payload: payloadMap.get(chunkId) ?? {},
        });
      }

      return fusedList
        .sort((a, b) => b.fusionScore - a.fusionScore)
        .slice(0, topK);
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new BusinessException(ErrorCode.FUSION_FAILED, {
        message: 'RRF 融合失败',
        cause: error,
        context: {
          denseCount: denseHits.length,
          sparseCount: sparseHits.length,
          topK,
        },
      });
    }
  }

  /**
   * O7: 基于 chunk 元数据计算融合质量乘数。
   *
   * - structured-token-aware 策略 → 1.05（结构切分质量更高）
   * - code/table 原子块 → 1.03（完整语义单元）
   * - sectionLevel >= 3 深层内容 → 1.02（更具体的说明）
   *
   * 组合最高约 ×1.10，避免过度漂移。
   */
  private computeQualityMultiplier(
    payload: Record<string, unknown> | undefined,
  ): number {
    if (!payload) return 1.0;

    let multiplier = 1.0;
    const chunkStrategy = payload['chunkStrategy'] as string | undefined;
    if (chunkStrategy === 'structured-token-aware') {
      multiplier *= 1.05;
    }

    const blockType = payload['blockType'] as string | undefined;
    if (blockType === 'code' || blockType === 'table') {
      multiplier *= 1.03;
    }

    const sectionLevel = payload['sectionLevel'] as number | undefined;
    if (sectionLevel !== null && sectionLevel !== undefined && sectionLevel >= 3) {
      multiplier *= 1.02;
    }

    return Math.round(multiplier * 1000) / 1000;
  }

  /**
   * E12: 基于 Shannon 熵计算检索路径的置信度权重。
   *
   * 分数分布越集中（熵低）→ 置信度越高；越平均（熵高）→ 置信度越低。
   * 返回值 [0.5, 1.0]，避免任一路径被完全清零。
   */
  private computePathConfidence<T extends { score: number }>(hits: T[]): number {
    const n = Math.min(hits.length, 50);
    if (n <= 1) return 1.0;

    const scores = hits.slice(0, n).map((h) => h.score);
    const maxScore = scores[0] ?? 0;
    if (maxScore <= 0) return 0.5;

    // softmax 归一化
    const expScores = scores.map((s) => Math.exp(s - maxScore));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probs = expScores.map((e) => e / sumExp);

    // Shannon 熵
    let entropy = 0;
    for (const p of probs) {
      if (p > 0) entropy -= p * Math.log(p);
    }
    const normalizedEntropy = entropy / Math.log(n); // 0=集中, 1=均匀

    // 置信度: 低熵=高置信度，限定范围 [0.5, 1.0]
    return Math.round((1 - normalizedEntropy * 0.5) * 1000) / 1000;
  }

  /**
   * 构建命中列表的 id → 排名(0-based) 索引。
   */
  private buildRankMap<T extends Record<K, string>, K extends string>(
    hits: T[],
    keyField: K,
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < hits.length; i++) {
      const id = hits[i][keyField];
      if (!map.has(id)) {
        map.set(id, i);
      }
    }
    return map;
  }
}