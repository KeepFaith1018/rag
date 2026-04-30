/** Reranker 精排后的最终结果 */
export interface RerankedHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  fusionScore: number;
  rerankScore: number;
  payload: Record<string, unknown>;
}
