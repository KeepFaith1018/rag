import { apiRequest } from "@/api/api";
import type {
  CompleteUploadResult,
  InitUploadPayload,
  InitUploadResult,
  UploadChunkResult,
  UploadStatusResult,
} from "../types/upload";

/**
 * 初始化上传会话。
 */
export function initChunkUpload(kbId: string, payload: InitUploadPayload) {
  return apiRequest<InitUploadResult>({
    url: `/knowledge-bases/${kbId}/uploads/init`,
    method: "POST",
    body: payload,
  });
}

/**
 * 上传单个文件分片。
 */
export function uploadChunk(
  kbId: string,
  uploadId: string,
  payload: {
    chunkIndex: number;
    chunkHash?: string;
    file: Blob;
    fileName: string;
  },
) {
  const formData = new FormData();
  formData.append("chunkIndex", String(payload.chunkIndex));

  if (payload.chunkHash) {
    formData.append("chunkHash", payload.chunkHash);
  }

  formData.append("file", payload.file, payload.fileName);

  return apiRequest<UploadChunkResult>({
    url: `/knowledge-bases/${kbId}/uploads/${uploadId}/chunks`,
    method: "POST",
    body: formData,
  });
}

/**
 * 查询上传会话状态。
 */
export function getUploadStatus(kbId: string, uploadId: string) {
  return apiRequest<UploadStatusResult>({
    url: `/knowledge-bases/${kbId}/uploads/${uploadId}/status`,
    method: "GET",
  });
}

/**
 * 通知后端执行分片合并。
 */
export function completeChunkUpload(
  kbId: string,
  uploadId: string,
  payload: {
    fileHash?: string;
    totalChunks?: number;
  },
) {
  return apiRequest<CompleteUploadResult>({
    url: `/knowledge-bases/${kbId}/uploads/${uploadId}/complete`,
    method: "POST",
    body: payload,
  });
}

/**
 * 取消上传会话并清理临时分片。
 */
export function cancelChunkUpload(kbId: string, uploadId: string) {
  return apiRequest<{
    kbId: string;
    uploadId: string;
    cancelled: boolean;
  }>({
    url: `/knowledge-bases/${kbId}/uploads/${uploadId}`,
    method: "DELETE",
  });
}
