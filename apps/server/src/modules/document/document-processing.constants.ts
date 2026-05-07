/**
 * 文档异步处理阶段常量。
 */
export const DOCUMENT_PROCESSING_STAGE = {
  UPLOADED: 'uploaded',
  QUEUED: 'queued',
  PARSING: 'parsing',
  CHUNKING: 'chunking',
  EMBEDDING: 'embedding',
  READY: 'ready',
  FAILED: 'failed',
} as const;

/**
 * 文档处理主队列名称。
 */
export const DOCUMENT_PROCESSING_QUEUE_NAME = 'document-processing';

/**
 * 文档处理主任务名称。
 */
export const DOCUMENT_PROCESSING_JOB_NAME = 'process-document';

/**
 * 文档入队失败时记录的内部错误码。
 */
export const DOCUMENT_QUEUE_ENQUEUE_ERROR_CODE =
  'DOCUMENT_QUEUE_ENQUEUE_FAILED';

/**
 * 文档解析失败时记录的内部错误码。
 */
export const DOCUMENT_PARSE_ERROR_CODE = 'DOCUMENT_PARSE_FAILED';

/**
 * 文档切块失败时记录的内部错误码。
 */
export const DOCUMENT_CHUNK_ERROR_CODE = 'DOCUMENT_CHUNK_FAILED';

/**
 * 文档源文件不存在时记录的内部错误码。
 */
export const DOCUMENT_SOURCE_FILE_MISSING_ERROR_CODE =
  'DOCUMENT_SOURCE_FILE_MISSING';

/**
 * 文档文件类型暂不支持解析时记录的内部错误码。
 */
export const DOCUMENT_PARSE_UNSUPPORTED_ERROR_CODE =
  'DOCUMENT_PARSE_UNSUPPORTED';

/**
 * 文档向量化失败时记录的内部错误码。
 */
export const DOCUMENT_EMBEDDING_ERROR_CODE = 'DOCUMENT_EMBEDDING_FAILED';

/**
 * 百炼配置缺失时记录的内部错误码。
 */
export const DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE =
  'DOCUMENT_EMBEDDING_CONFIG_MISSING';

/**
 * Qdrant 写入失败时记录的内部错误码。
 */
export const DOCUMENT_VECTOR_INDEX_ERROR_CODE = 'DOCUMENT_VECTOR_INDEX_FAILED';

/**
 * Elasticsearch 写入失败时记录的内部错误码。
 */
export const DOCUMENT_ELASTICSEARCH_INDEX_ERROR_CODE =
  'DOCUMENT_ES_INDEX_FAILED';

/**
 * 文档处理任务记录状态。
 */
export const DOCUMENT_PROCESSING_TASK_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
} as const;

/**
 * 文档处理阶段任务超时时记录的内部错误码。
 */
export const DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE =
  'DOCUMENT_PROCESSING_TIMEOUT';

/**
 * 文档处理任务默认超时时间，单位毫秒。
 */
export const DOCUMENT_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 文档处理超时扫描默认间隔，单位毫秒。
 */
export const DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS = 60 * 1000;

/**
 * 默认分片目标大小，基于 tiktoken cl100k_base 真实 token 计数控制。
 */
export const DOCUMENT_CHUNK_SIZE = 700;

/**
 * 默认分片重叠大小，基于 tiktoken cl100k_base 真实 token 计数控制。
 */
export const DOCUMENT_CHUNK_OVERLAP = 100;

/**
 * 三层粒度切块大小常量。
 * 比例: Level1(根) : Level2(父) : Level3(子) ≈ 2x : 1x : 0.5x
 */
export const ROOT_CHUNK_SIZE = 1200;
export const PARENT_CHUNK_SIZE = 600;
export const CHILD_CHUNK_SIZE = 300;

/** 三层粒度 chunk 重叠 token 数 */
export const HIERARCHICAL_CHUNK_OVERLAP = 60;

/** 代码块/表格块作为原子单元保留的最大 token 数（百炼 text-embedding-v4 上限 8192，安全值 ~8000） */
export const MAX_ATOMIC_BLOCK_TOKENS = 8000;

// ── O6: 文档类型自适应 Chunk Profile ──

export interface ChunkProfile {
  name: string;
  rootSize: number;
  parentSize: number;
  childSize: number;
}

export const CHUNK_PROFILES: Record<string, ChunkProfile> = {
  'default': {
    name: 'default',
    rootSize: ROOT_CHUNK_SIZE,
    parentSize: PARENT_CHUNK_SIZE,
    childSize: CHILD_CHUNK_SIZE,
  },
  'code-heavy': {
    name: 'code-heavy',
    rootSize: 1800,
    parentSize: 900,
    childSize: 500,
  },
  verbose: {
    name: 'verbose',
    rootSize: 1400,
    parentSize: 700,
    childSize: 350,
  },
  compact: {
    name: 'compact',
    rootSize: 900,
    parentSize: 450,
    childSize: 250,
  },
};

/** 代码块比例触发 code-heavy profile 的阈值 */
export const CODE_HEAVY_RATIO_THRESHOLD = 0.3;

/** 表格比例触发 verbose profile 的阈值 */
export const TABLE_HEAVY_RATIO_THRESHOLD = 0.2;

/** 平均 section 内容长度低于此值（字符数）触发 compact profile */
export const COMPACT_CONTENT_LENGTH_THRESHOLD = 500;
