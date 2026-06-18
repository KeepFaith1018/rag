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
  fusedHits: FusedHit[];
  rerankedHits: RerankedHit[];
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  totalDurationMs: number;
}

import type { DenseHit } from '../interfaces/dense-hit.interface';
import type { FusedHit } from '../interfaces/fused-hit.interface';
import type { RerankedHit } from '../interfaces/reranked-hit.interface';
import type { SparseHit } from '../interfaces/sparse-hit.interface';