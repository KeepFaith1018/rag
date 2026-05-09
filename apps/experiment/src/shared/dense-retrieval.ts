/**
 * 稠密向量检索。
 * 从 DenseRetrievalService 简化。
 */
import { embedDocuments } from './embedding.js';
import { searchChunkVectors } from './qdrant.js';
import { dedupByHighestScore } from './utils.js';
import type { DenseHit } from './types.js';

export interface DenseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
  scoreThreshold?: number;
}

/** 批量向量检索 + 去重 */
export async function denseRetrieve(params: DenseRetrieveParams): Promise<DenseHit[]> {
  const { queries, kbIds, topK, scoreThreshold } = params;
  if (!queries.length || !kbIds.length) return [];

  const vectors = await embedDocuments(queries);
  const resultGroups = await Promise.all(
    vectors.map((vector) =>
      searchChunkVectors({ vector, kbIds, topK, scoreThreshold }),
    ),
  );
  return dedupByHighestScore(resultGroups as unknown as DenseHit[][]);
}
