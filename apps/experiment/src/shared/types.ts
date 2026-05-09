/** 稠密向量检索命中 */
export interface DenseHit {
  pointId: string;
  kbId: string;
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  payload: Record<string, unknown>;
}

/** 稀疏/关键词检索命中 */
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

/** RRF 融合后 */
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

/** Rerank 精排后 */
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

export type QuestionType =
  | 'fact_lookup'
  | 'compare_analysis'
  | 'research_or_open_world'
  | 'greeting';

export interface TestQuestion {
  id: string;
  text: string;
  type: QuestionType;
  expectedKeyPoints: string[];
}

export interface TestData {
  kbIds: string[];
  docsCount: number;
  questions: TestQuestion[];
}

export interface ExperimentEntry {
  questionId: string;
  question: string;
  questionType: string;
  answer: string;
  hitCount: number;
  totalDurationMs: number;
  stepDurations: Record<string, number>;
  error?: string;
}

export interface ExperimentReport {
  experiment: string;
  timestamp: string;
  kbIds: string[];
  config: Record<string, unknown>;
  results: ExperimentEntry[];
  aggregation: {
    avgDurationMs: number;
    avgHitCount: number;
    avgAnswerLength: number;
    totalErrors: number;
  };
}
