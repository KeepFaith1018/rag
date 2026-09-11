export type UploadLifecycleStatus =
  | "queued"
  | "hashing"
  | "initializing"
  | "uploading"
  | "completing"
  | "paused"
  | "completed"
  | "instantCompleted"
  | "cancelled"
  | "failed";

export interface FileChunkItem {
  index: number;
  start: number;
  end: number;
  size: number;
  blob: Blob;
}

export interface UploadPartSnapshot {
  partNumber: number;
  size: number | null;
  etag: string | null;
}

export interface InitUploadPayload {
  fileName: string;
  title?: string;
  fileSize: number;
  mimeType: string;
  clientSha256: string;
}

export interface UploadSessionSnapshot {
  sessionId: string;
  status: string;
  uploadId: string | null;
  fileName: string;
  fileSize: string;
  partSize: number;
  totalParts: number;
  uploadedParts: UploadPartSnapshot[];
  missingParts: number[];
  uploadedBytes: string;
  expiresAt: string;
  documentId: string | null;
}

export interface InitUploadResult {
  isInstantUploaded: boolean;
  deduplicated: boolean;
  uploadId: string | null;
  documentId: string | null;
  document?: {
    id: string;
    title: string;
    status: string;
    processingDeferred: boolean;
    searchable: boolean;
  };
  sessionId?: string;
  status?: string;
  fileName?: string;
  fileSize?: string;
  partSize?: number;
  totalParts?: number;
  uploadedParts?: UploadPartSnapshot[];
  missingParts?: number[];
  uploadedBytes?: string;
  expiresAt?: string;
}

export interface SignedPartResult {
  sessionId: string;
  partNumber: number;
  expectedSize: number;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface UploadStatusResult extends UploadSessionSnapshot {}

export interface CompleteUploadResult {
  isInstantUploaded: boolean;
  deduplicated: boolean;
  uploadId: string | null;
  documentId: string;
  document: InitUploadResult["document"];
}

export interface PersistedUploadTaskSnapshot {
  kbId: string;
  sessionId: string | null;
  fileName: string;
  fileSize: number;
  fileSha256: string;
  partSize: number;
  totalParts: number;
  status: UploadLifecycleStatus;
  recentError: string | null;
}

export interface ChunkUploadState {
  status: UploadLifecycleStatus;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  kbId: string;
  fileName: string;
  fileSha256: string;
  sessionId: string | null;
  documentId: string | null;
  uploadedParts: number;
  totalParts: number;
  partSize: number;
  errorMessage: string;
}
