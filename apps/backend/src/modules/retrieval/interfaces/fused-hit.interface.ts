/** RRF 融合后的候选分片 */
export interface FusedHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  fusionScore: number;
  denseScore?: number;
  sparseScore?: number;
  denseRank?: number;
  sparseRank?: number;
  payload: Record<string, unknown>;
}
