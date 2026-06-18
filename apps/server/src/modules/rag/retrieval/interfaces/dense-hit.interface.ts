/**
 * 稠密向量检索命中结果，由 QdrantService.searchChunkVectors() 产出。
 * 该接口与 common/vector/qdrant.service.ts 中的 DenseHit 保持一致。
 */
export interface DenseHit {
  pointId: string;
  kbId: string;
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  payload: Record<string, unknown>;
}