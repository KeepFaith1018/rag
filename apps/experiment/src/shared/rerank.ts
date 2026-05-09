/**
 * qwen3-rerank 重排序。
 * 从 RerankModelService 简化。
 */
import { env } from './env.js';
import { roundTo } from './utils.js';
import type { FusedHit, RerankedHit, QuestionType } from './types.js';

const API_KEY = env('BAILIAN_API_KEY');
const BASE_URL = env('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');

export interface RerankParams {
  candidates: FusedHit[];
  queries: string[];
  questionType?: QuestionType;
  topN?: number;
}

/** 调用 qwen3-rerank，失败时回退轻量评分 */
export async function rerank(params: RerankParams): Promise<RerankedHit[]> {
  const { candidates, queries, questionType = 'fact_lookup', topN = 10 } = params;
  if (!candidates.length) return [];

  try {
    const scores = await multiQueryRerank(candidates, queries, questionType, topN);
    const maxFusionScore = candidates[0]?.fusionScore ?? 1;

    const results = candidates.map((c, i) => {
      const rerankScore = Math.min(scores[i] ?? 0, 1.0);
      return {
        hit: c,
        rerankScore,
        fusionScore: maxFusionScore > 0 ? roundTo(c.fusionScore / maxFusionScore) : c.fusionScore,
      };
    });

    return applyFilter(results, topN);
  } catch (e) {
    console.warn('[Rerank] API 调用失败，回退轻量评分:', (e as Error).message);
    return lightweightRerank(candidates, queries, questionType, topN);
  }
}

async function multiQueryRerank(
  candidates: FusedHit[],
  queries: string[],
  topN: number,
  questionType: QuestionType,
): Promise<number[]> {
  if (questionType === 'fact_lookup') {
    const mainQuery = queries[0] ?? '';
    return callRerankApi(mainQuery, candidates.map((c) => c.content), topN);
  }

  const allScores: number[][] = await Promise.all(
    queries.map((q) => callRerankApi(q, candidates.map((c) => c.content), topN)),
  );
  return candidates.map((_, i) => Math.max(...allScores.map((s) => s[i] ?? 0)));
}

async function callRerankApi(
  query: string,
  documents: string[],
  topN: number,
): Promise<number[]> {
  const resp = await fetch(`${BASE_URL}/rerank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: env('BAILIAN_RERANK_MODEL', 'qwen3-rerank'),
      query,
      documents,
      top_n: topN,
      return_documents: false,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error(`Rerank API ${resp.status}`);

  const data = (await resp.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };
  const scores = new Array<number>(documents.length).fill(0);
  for (const item of data.results) {
    if (item.index >= 0 && item.index < documents.length) {
      scores[item.index] = item.relevance_score;
    }
  }
  return scores;
}

function applyFilter(
  results: Array<{ hit: FusedHit; rerankScore: number; fusionScore: number }>,
  topN: number,
): RerankedHit[] {
  const filtered = results
    .filter((r) => r.rerankScore >= 0.5)
    .map((r) => ({
      chunkId: r.hit.chunkId,
      docId: r.hit.docId,
      kbId: r.hit.kbId,
      content: r.hit.content,
      title: r.hit.title,
      fusionScore: r.fusionScore,
      rerankScore: roundTo(r.rerankScore),
      payload: r.hit.payload,
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topN);

  return filtered;
}

function lightweightRerank(
  candidates: FusedHit[],
  queries: string[],
  _questionType: QuestionType,
  topN: number,
): RerankedHit[] {
  const maxScore = candidates[0]?.fusionScore ?? 1;
  return candidates
    .map((c) => {
      const contentLower = c.content.toLowerCase();
      let bestOverlap = 0;
      for (const q of queries) {
        const tokens = q.toLowerCase().split(/\s+/);
        const overlap = tokens.filter((t) => t.length > 1 && contentLower.includes(t)).length;
        const ratio = tokens.length > 0 ? overlap / tokens.length : 0;
        if (ratio > bestOverlap) bestOverlap = ratio;
      }
      const fusionScore = maxScore > 0 ? roundTo(c.fusionScore / maxScore) : c.fusionScore;
      const rerankScore = roundTo(Math.min(fusionScore * 0.7 + bestOverlap * 0.3, 1.0));
      return { ...c, fusionScore, rerankScore } as RerankedHit;
    })
    .filter((h) => h.rerankScore >= 0.4)
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topN);
}
