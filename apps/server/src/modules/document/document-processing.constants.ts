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
 * 默认分片目标大小，按近似 token 长度控制。
 */
export const DOCUMENT_CHUNK_SIZE = 700;

/**
 * 默认分片重叠大小，按近似 token 长度控制。
 */
export const DOCUMENT_CHUNK_OVERLAP = 100;
