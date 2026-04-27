import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../../ai/embedding.service';
import { QdrantService } from '@common/vector/qdrant.service';
import type { DenseHit } from '../interfaces/dense-hit.interface';

export interface DenseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
  scoreThreshold?: number;
}

/**
 * 稠密向量检索服务。
 *
 * 将查询文本向量化后调用 Qdrant 进行相似度检索，
 * 支持多条查询的批量检索与自动去重。
 */
@Injectable()
export class DenseRetrievalService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantService: QdrantService,
  ) {}

  /**
   * 对多条改写/分解后的查询逐条向量化并检索，
   * 汇总去重后返回按 score 降序排列的 Top-K 结果。
   */
  async retrieve(params: DenseRetrieveParams): Promise<DenseHit[]> {
    const { queries, kbIds, topK, scoreThreshold } = params;

    if (!queries.length || !kbIds.length) {
      return [];
    }

    // 批量向量化所有查询文本
    const { vectors } = await this.embeddingService.embedDocuments(queries);

    // 逐条检索
    const resultGroups = await Promise.all(
      vectors.map((vector) =>
        this.qdrantService.searchChunkVectors({
          vector,
          kbIds,
          topK,
          scoreThreshold,
        }),
      ),
    );

    // 按 chunkId 去重，保留最高分
    const seen = new Map<string, DenseHit>();
    for (const group of resultGroups) {
      for (const hit of group) {
        const existing = seen.get(hit.chunkId);
        if (!existing || hit.score > existing.score) {
          seen.set(hit.chunkId, hit);
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }
}
