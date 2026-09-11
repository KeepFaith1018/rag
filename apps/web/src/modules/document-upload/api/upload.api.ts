import { apiRequest } from "@/api/api";
import type {
  CompleteUploadResult,
  InitUploadPayload,
  InitUploadResult,
  SignedPartResult,
  UploadStatusResult,
} from "../types/upload";

export function initUpload(kbId: string, payload: InitUploadPayload) {
  return apiRequest<InitUploadResult>({
    url: `/knowledge-bases/${kbId}/uploads`,
    method: "POST",
    body: payload,
  });
}

export function getUploadStatus(kbId: string, sessionId: string) {
  return apiRequest<UploadStatusResult>({
    url: `/knowledge-bases/${kbId}/uploads/${sessionId}`,
    method: "GET",
  });
}

export function signUploadPart(
  kbId: string,
  sessionId: string,
  partNumber: number,
) {
  return apiRequest<SignedPartResult>({
    url: `/knowledge-bases/${kbId}/uploads/${sessionId}/parts/${partNumber}/sign`,
    method: "POST",
  });
}

export function confirmUploadPart(
  kbId: string,
  sessionId: string,
  partNumber: number,
  payload: { etag: string },
) {
  return apiRequest<UploadStatusResult>({
    url: `/knowledge-bases/${kbId}/uploads/${sessionId}/parts/${partNumber}/confirm`,
    method: "POST",
    body: payload,
  });
}

export function completeUpload(kbId: string, sessionId: string) {
  return apiRequest<CompleteUploadResult>({
    url: `/knowledge-bases/${kbId}/uploads/${sessionId}/complete`,
    method: "POST",
  });
}

export function cancelUpload(kbId: string, sessionId: string) {
  return apiRequest<{ sessionId: string; status: string; aborted: boolean }>({
    url: `/knowledge-bases/${kbId}/uploads/${sessionId}`,
    method: "DELETE",
  });
}

/** 使用签名 URL 直传 MinIO part，并通过 XHR 获取浏览器上传进度。 */
export function putSignedPart(
  uploadUrl: string,
  body: Blob,
  onProgress?: (uploadedBytes: number) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const etag = request.getResponseHeader("ETag")?.replaceAll('"', "");
        if (etag) {
          resolve(etag);
          return;
        }
        reject(new Error("对象存储未返回分片 ETag，请检查 MinIO CORS 配置"));
        return;
      }
      reject(new Error(`分片上传失败（${request.status}）`));
    };
    request.onerror = () => reject(new Error("分片上传网络错误"));
    request.onabort = () => reject(new Error("分片上传已取消"));
    request.send(body);
  });
}
