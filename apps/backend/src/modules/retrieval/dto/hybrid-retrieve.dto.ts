/** 检索请求参数 */
export class HybridRetrieveParams {
  queries: string[];
  kbIds: string[];
  denseTopK: number;
  sparseTopK: number;
  fusionTopK: number;
  scoreThreshold: number;
}

/** 检索结果汇总 */
export class HybridRetrieveResult {
  fusedHits: import('../interfaces/fused-hit.interface').FusedHit[];
  rerankedHits: import('../interfaces/reranked-hit.interface').RerankedHit[];
  denseHits: import('../interfaces/dense-hit.interface').DenseHit[];
  sparseHits: import('../interfaces/sparse-hit.interface').SparseHit[];
  totalDurationMs: number;
}
