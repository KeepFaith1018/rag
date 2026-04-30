/**
 * 前端上传流程状态定义。
 */
export type UploadLifecycleStatus =
  | "idle"
  | "hashing"
  | "initializing"
  | "uploading"
  | "paused"
  | "merging"
  | "completed"
  | "instantCompleted"
  | "failed";

/**
 * 单个文件分片的前端描述结构。
 */
export interface FileChunkItem {
  index: number;
  start: number;
  end: number;
  size: number;
  blob: Blob;
}

/**
 * 初始化上传请求参数。
 */
export interface InitUploadPayload {
  fileName: string;
  title?: string;
  fileSize: number;
  mimeType?: string;
  fileHash: string;
  chunkSize: number;
  totalChunks: number;
}

/**
 * 初始化上传响应结构。
 */
export interface InitUploadResult {
  kbId: string;
  uploadId: string | null;
  documentId: string | null;
  isInstantUploaded: boolean;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: string;
}

/**
 * 上传分片响应结构。
 */
export interface UploadChunkResult {
  kbId: string;
  uploadId: string;
  chunkIndex: number;
  uploadedCount: number;
  totalChunks: number;
  status: string;
}

/**
 * 上传状态查询响应结构。
 */
export interface UploadStatusResult {
  kbId: string;
  uploadId: string;
  status: string;
  uploadedChunks: number[];
  missingChunks: number[];
  uploadedCount: number;
  totalChunks: number;
  chunkSize: number;
  isExpired: boolean;
  documentId: string | null;
}

/**
 * 完成上传响应结构。
 */
export interface CompleteUploadResult {
  kbId: string;
  uploadId: string;
  documentId: string;
  status: string;
  isInstantUploaded: boolean;
}

/**
 * 组合式上传状态快照。
 */
export interface ChunkUploadState {
  status: UploadLifecycleStatus;
  progress: number;
  kbId: string;
  fileName: string;
  fileHash: string;
  uploadId: string | null;
  documentId: string | null;
  uploadedChunks: number[];
  totalChunks: number;
  chunkSize: number;
  errorMessage: string;
}

/**
 * 用于本地持久化的上传任务快照。
 */
export interface PersistedUploadTaskSnapshot {
  kbId: string;
  fileName: string;
  fileHash: string;
  uploadId: string;
  totalChunks: number;
  chunkSize: number;
  title?: string;
}
