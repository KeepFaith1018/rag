import type {
  DenseHit,
  SparseHit,
  FusedHit,
  RerankedHit,
} from './types.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 按 chunkId 去重，保留最高分 */
export function dedupByHighestScore<T extends { chunkId: string; score: number }[]>(
  resultGroups: T[],
  topK?: number,
): T {
  const best = new Map<string, T[number]>();
  for (const group of resultGroups) {
    for (const hit of group) {
      const existing = best.get(hit.chunkId);
      if (!existing || hit.score > existing.score) {
        best.set(hit.chunkId, hit);
      }
    }
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score);
  return (topK ? sorted.slice(0, topK) : sorted) as unknown as T;
}

export function roundTo(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** 拼接检索上下文 */
export function buildContext(
  hits: Array<{ content: string; docId?: string; title?: string }>,
  maxChars = 12000,
): string {
  let budget = maxChars;
  const parts: string[] = [];
  for (let i = 0; i < hits.length && budget > 0; i++) {
    const h = hits[i];
    const label = h.title
      ? `[片段${i + 1}] ${h.title}\n`
      : `[片段${i + 1}]\n`;
    const maxLen = budget - label.length;
    const content = h.content.length > maxLen ? h.content.slice(0, maxLen) + '...' : h.content;
    parts.push(label + content);
    budget -= label.length + content.length;
  }
  return parts.join('\n---\n') || '（未检索到相关上下文）';
}

/** Qdrant 向量 + payload → DenseHit 标准化 */
export function mapQdrantResult(r: { id: string | number; score: number; payload?: Record<string, unknown> }): DenseHit {
  const p = r.payload ?? {};
  return {
    pointId: String(r.id),
    kbId: String(p['kbId'] ?? ''),
    docId: String(p['docId'] ?? ''),
    chunkId: String(p['chunkId'] ?? ''),
    content: String(p['content'] ?? ''),
    score: r.score,
    payload: p,
  };
}
