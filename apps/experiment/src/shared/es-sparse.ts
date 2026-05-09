/**
 * Elasticsearch 稀疏检索。
 * 从 ElasticsearchSparseRetrievalService 简化。
 */
import { env } from './env.js';
import { dedupByHighestScore } from './utils.js';
import type { SparseHit } from './types.js';

const ES_NODE = env('ELASTICSEARCH_NODE', 'http://localhost:9200');
const ES_INDEX = env('ELASTICSEARCH_INDEX', 'kb_document_chunks_es');

export interface SparseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
}

/** ES BM25 检索，ES 不可用时返回空数组 */
export async function retrieve(params: SparseRetrieveParams): Promise<SparseHit[]> {
  const { queries, kbIds, topK } = params;
  if (!queries.length || !kbIds.length) return [];

  try {
    const resultGroups = await Promise.all(
      queries.map((query) => searchES(query, kbIds, topK)),
    );
    return dedupByHighestScore(
      resultGroups.map((group) =>
        group.map((hit) => ({
          chunkId: hit.chunkId,
          docId: hit.docId,
          kbId: hit.kbId,
          content: hit.content,
          title: hit.title,
          score: hit.score,
        })),
      ),
      topK,
    );
  } catch (e) {
    console.warn('[ES] 检索失败，降级为空结果:', (e as Error).message);
    return [];
  }
}

async function searchES(
  query: string,
  kbIds: string[],
  topK: number,
): Promise<SparseHit[]> {
  const resp = await fetch(`${ES_NODE}/${ES_INDEX}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: topK,
      query: {
        bool: {
          must: [{ multi_match: { query, fields: ['content', 'title'] } }],
          filter: [{ terms: { kbId: kbIds } }],
        },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) throw new Error(`ES ${resp.status}`);

  const data = (await resp.json()) as {
    hits?: { hits?: Array<{ _source?: Record<string, unknown>; _score?: number }> };
  };
  return (data.hits?.hits ?? []).map((h) => {
    const s = h._source ?? {};
    return {
      chunkId: String(s['chunkId'] ?? ''),
      docId: String(s['docId'] ?? ''),
      kbId: String(s['kbId'] ?? ''),
      content: String(s['content'] ?? ''),
      title: s['title'] ? String(s['title']) : undefined,
      score: h._score ?? 0,
    };
  });
}
