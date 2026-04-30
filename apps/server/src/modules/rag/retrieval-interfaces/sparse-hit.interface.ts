/** 稀疏/关键词检索命中结果 */
export interface SparseHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  score: number;
  title?: string;
  titlePath?: string;
  keywordText?: string;
}
