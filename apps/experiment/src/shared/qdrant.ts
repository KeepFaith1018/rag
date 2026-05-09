/**
 * Qdrant 向量检索。
 * 从 QdrantService.searchChunkVectors() 简化。
 */
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from './env.js';
import { mapQdrantResult } from './utils.js';
import type { DenseHit } from './types.js';

let _client: QdrantClient | null = null;
const COLLECTION = 'kb_document_chunks';
const EF_SEARCH = 128;

function getClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: env('QDRANT_URL'),
      apiKey: env('QDRANT_SERVICE_API_KEY', ''),
    });
  }
  return _client;
}

export interface SearchParams {
  vector: number[];
  kbIds: string[];
  topK: number;
  scoreThreshold?: number;
}

/** 向量相似度检索 */
export async function searchChunkVectors(params: SearchParams): Promise<DenseHit[]> {
  const client = getClient();
  const kbFilters = params.kbIds.map((kbId) => ({
    key: 'kbId',
    match: { value: kbId },
  }));

  const results = await client.search(COLLECTION, {
    vector: params.vector,
    limit: params.topK,
    score_threshold: params.scoreThreshold,
    filter: kbFilters.length > 0 ? { should: kbFilters } : undefined,
    params: { ef: EF_SEARCH },
    with_payload: true,
  });

  return results.map(mapQdrantResult);
}
