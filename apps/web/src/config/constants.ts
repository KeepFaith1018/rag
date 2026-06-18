/** 知识库名称最大长度 */
export const KB_NAME_MAX_LENGTH = 20;

/** 知识库描述最大长度 */
export const KB_DESCRIPTION_MAX_LENGTH = 200;

/** 分片上传每块大小 (字节) */
export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/** 分片上传并发数 */
export const CHUNK_UPLOAD_CONCURRENCY = 3;

/** 分片上传最大重试次数 */
export const CHUNK_UPLOAD_MAX_RETRIES = 3;

/** SSE 重连最大次数 */
export const SSE_MAX_RECONNECT = 2;

/** 搜索防抖间隔 (毫秒) */
export const SEARCH_DEBOUNCE_MS = 280;
