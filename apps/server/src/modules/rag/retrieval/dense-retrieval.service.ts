import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../ai/embedding.service';
import { QdrantService } from '@common/vector/qdrant.service';
import { dedupByHighestScore } from '@common/utils/retrieval.utils';
import type { DenseHit } from './interfaces/dense-hit.interface';

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
          vector: vector!, // embedDocuments 保证所有 entries 均已填充
          kbIds,
          topK,
          scoreThreshold,
        }),
      ),
    );

    // 按 chunkId 去重，保留最高分
    return dedupByHighestScore(resultGroups as DenseHit[][]);
  }
}