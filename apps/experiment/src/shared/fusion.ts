/**
 * RRF 融合。
 * 从 FusionService 简化。
 */
import { roundTo } from './utils.js';
import type { DenseHit, SparseHit, FusedHit } from './types.js';

export interface FusionParams {
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  topK: number;
  k?: number;
}

/** RRF 融合稠密+稀疏结果 */
export function fuse(params: FusionParams): FusedHit[] {
  const { denseHits, sparseHits, topK, k = 60 } = params;
  if (!denseHits.length && !sparseHits.length) return [];

  const denseRankMap = buildRankMap(denseHits, 'chunkId');
  const sparseRankMap = buildRankMap(sparseHits, 'chunkId');

  const allChunkIds = new Set([...denseRankMap.keys(), ...sparseRankMap.keys()]);

  const contentMap = new Map<string, string>();
  const docIdMap = new Map<string, string>();
  const kbIdMap = new Map<string, string>();
  const titleMap = new Map<string, string>();
  const payloadMap = new Map<string, Record<string, unknown>>();

  for (const h of denseHits) {
    contentMap.set(h.chunkId, h.content);
    docIdMap.set(h.chunkId, h.docId);
    kbIdMap.set(h.chunkId, h.kbId);
    payloadMap.set(h.chunkId, h.payload);
  }
  for (const h of sparseHits) {
    if (!contentMap.has(h.chunkId)) {
      contentMap.set(h.chunkId, h.content);
      docIdMap.set(h.chunkId, h.docId);
      kbIdMap.set(h.chunkId, h.kbId);
    }
    if (h.title && !titleMap.has(h.chunkId)) {
      titleMap.set(h.chunkId, h.title);
    }
  }

  const denseConf = computePathConfidence(denseHits);
  const sparseConf = computePathConfidence(sparseHits);

  const fusedList: FusedHit[] = [];
  for (const chunkId of allChunkIds) {
    const denseRank = denseRankMap.get(chunkId);
    const sparseRank = sparseRankMap.get(chunkId);
    let fusionScore = 0;
    if (denseRank !== undefined) fusionScore += denseConf / (k + denseRank);
    if (sparseRank !== undefined) fusionScore += sparseConf / (k + sparseRank);
    fusionScore *= computeQualityMultiplier(payloadMap.get(chunkId));

    fusedList.push({
      chunkId,
      docId: docIdMap.get(chunkId) ?? '',
      kbId: kbIdMap.get(chunkId) ?? '',
      content: contentMap.get(chunkId) ?? '',
      title: titleMap.get(chunkId),
      fusionScore: roundTo(fusionScore, 6),
      denseScore: denseHits.find((h) => h.chunkId === chunkId)?.score,
      sparseScore: sparseHits.find((h) => h.chunkId === chunkId)?.score,
      payload: payloadMap.get(chunkId) ?? {},
    });
  }

  return fusedList.sort((a, b) => b.fusionScore - a.fusionScore).slice(0, topK);
}

function buildRankMap<T extends Record<string, unknown>>(
  hits: T[],
  keyField: keyof T,
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < hits.length; i++) {
    const id = String(hits[i][keyField]);
    if (!map.has(id)) map.set(id, i);
  }
  return map;
}

function computePathConfidence<T extends { score: number }>(hits: T[]): number {
  const n = Math.min(hits.length, 50);
  if (n <= 1) return 1.0;
  const scores = hits.slice(0, n).map((h) => h.score);
  const maxScore = scores[0] ?? 0;
  if (maxScore <= 0) return 0.5;
  const expScores = scores.map((s) => Math.exp(s - maxScore));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const probs = expScores.map((e) => e / sumExp);
  let entropy = 0;
  for (const p of probs) if (p > 0) entropy -= p * Math.log(p);
  const normalizedEntropy = entropy / Math.log(n);
  return roundTo(1 - normalizedEntropy * 0.5);
}

function computeQualityMultiplier(payload?: Record<string, unknown>): number {
  if (!payload) return 1.0;
  let m = 1.0;
  if (payload['chunkStrategy'] === 'structured-token-aware') m *= 1.05;
  const blockType = payload['blockType'] as string | undefined;
  if (blockType === 'code' || blockType === 'table') m *= 1.03;
  const sectionLevel = payload['sectionLevel'] as number | undefined;
  if (sectionLevel != null && sectionLevel >= 3) m *= 1.02;
  return roundTo(m);
}
