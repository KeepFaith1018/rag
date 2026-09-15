import {
  apiRequest,
  apiRequestBlob,
  apiRequestStream,
  ensureFreshAccessToken,
} from "@/api/api";
import { getAccessToken } from "@/utils/token";
import type { ApiQueryParams } from "@/types/api";
import type {
  KnowledgeBaseDocumentDetail,
  KnowledgeBaseDocumentListResponse,
  ListKnowledgeBaseDocumentsQuery,
  DocumentProcessingChangedEvent,
} from "@/types/knowledge-base";

/**
 * 获取知识库文档列表。
 */
export function listKnowledgeBaseDocuments(
  kbId: string,
  query: ListKnowledgeBaseDocumentsQuery = {},
) {
  return apiRequest<KnowledgeBaseDocumentListResponse>({
    url: `/knowledge-bases/${kbId}/documents`,
    method: "GET",
    params: query as ApiQueryParams,
  });
}

/**
 * 获取文档详情。
 */
export function getKnowledgeBaseDocumentDetail(
  kbId: string,
  documentId: string,
) {
  return apiRequest<KnowledgeBaseDocumentDetail>({
    url: `/knowledge-bases/${kbId}/documents/${documentId}`,
    method: "GET",
  });
}

/**
 * 删除文档。
 */
export function deleteKnowledgeBaseDocument(kbId: string, documentId: string) {
  return apiRequest<{
    kbId: string;
    documentId: string;
    deleting?: boolean;
    deleted: boolean;
  }>({
    url: `/knowledge-bases/${kbId}/documents/${documentId}`,
    method: "DELETE",
  });
}

/** 使用 Authorization header 消费知识库级处理状态 SSE。 */
export async function consumeDocumentProcessingEvents(
  kbId: string,
  signal: AbortSignal,
  handlers: {
    connected: () => void;
    changed: (event: DocumentProcessingChangedEvent) => void;
  },
) {
  const currentToken = getAccessToken();
  if (!currentToken || tokenExpiresWithin(currentToken, 60))
    await ensureFreshAccessToken(currentToken || undefined);
  const response = await apiRequestStream({
    url: `/knowledge-bases/${kbId}/documents/processing/stream`,
    method: "GET",
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error(`DOCUMENT_PROCESSING_STREAM_HTTP_${response.status}`);
  handlers.connected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      pending += decoder
        .decode(result.value, { stream: true })
        .replace(/\r\n/g, "\n");
      let boundary = pending.indexOf("\n\n");
      while (boundary >= 0) {
        const block = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        parseProcessingEvent(block, handlers.changed);
        boundary = pending.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseProcessingEvent(
  block: string,
  changed: (event: DocumentProcessingChangedEvent) => void,
) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  const value = JSON.parse(data) as Partial<DocumentProcessingChangedEvent>;
  if (value.schemaVersion !== 0 && value.schemaVersion !== 1)
    throw new Error("DOCUMENT_PROCESSING_SCHEMA_UNSUPPORTED");
  if (
    value.eventType !== "document_processing_changed" ||
    typeof value.documentId !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return;
  changed(value as DocumentProcessingChangedEvent);
}

function tokenExpiresWithin(token: string, seconds: number) {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return !payload.exp || payload.exp * 1000 <= Date.now() + seconds * 1000;
  } catch {
    return true;
  }
}

/**
 * 修改文档展示标题。
 */
export function updateKnowledgeBaseDocument(
  kbId: string,
  documentId: string,
  payload: { title: string },
) {
  return apiRequest<KnowledgeBaseDocumentDetail>({
    url: `/knowledge-bases/${kbId}/documents/${documentId}`,
    method: "PATCH",
    body: payload,
  });
}

/**
 * 获取文档预览 URL。
 */
export function getDocumentPreviewUrl(
  kbId: string,
  documentId: string,
): string {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  return `${base}/knowledge-bases/${kbId}/documents/${documentId}/preview`;
}

/**
 * 获取文档下载 URL。
 */
export function getDocumentDownloadUrl(
  kbId: string,
  documentId: string,
): string {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  return `${base}/knowledge-bases/${kbId}/documents/${documentId}/download`;
}

/**
 * 下载知识库原始文档（Blob 方式，支持进度监听）。
 */
export function downloadKnowledgeBaseDocument(
  kbId: string,
  documentId: string,
) {
  return apiRequestBlob({
    url: `/knowledge-bases/${kbId}/documents/${documentId}/download`,
    method: "GET",
    headers: {
      Accept: "*/*",
    },
  });
}
