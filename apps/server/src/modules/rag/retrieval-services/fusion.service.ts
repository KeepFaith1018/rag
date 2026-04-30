import { Injectable } from '@nestjs/common';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { DenseHit } from '../retrieval-interfaces/dense-hit.interface';
import type { SparseHit } from '../retrieval-interfaces/sparse-hit.interface';
import type { FusedHit } from '../retrieval-interfaces/fused-hit.interface';

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

      // 计算每个 chunk 的 RRF 分数
      const fusedList: FusedHit[] = [];

      for (const chunkId of allChunkIds) {
        const denseRank = denseRankMap.get(chunkId);
        const sparseRank = sparseRankMap.get(chunkId);

        let fusionScore = 0;
        if (denseRank !== undefined) {
          fusionScore += 1 / (k + (denseRank));
        }
        if (sparseRank !== undefined) {
          fusionScore += 1 / (k + (sparseRank));
        }

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
