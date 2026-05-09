import { apiRequest, apiRequestBlob } from "@/api/api";
import type { ApiQueryParams } from "@/types/api";
import type {
  KnowledgeBaseDocumentDetail,
  KnowledgeBaseDocumentListResponse,
  ListKnowledgeBaseDocumentsQuery,
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
  return apiRequest<{ kbId: string; documentId: string; deleted: boolean }>({
    url: `/knowledge-bases/${kbId}/documents/${documentId}`,
    method: "DELETE",
  });
}

/**
 * 触发文档重解析。
 */
export function reparseKnowledgeBaseDocument(kbId: string, documentId: string) {
  return apiRequest<{ kbId: string; documentId: string; reparsed: boolean }>({
    url: `/knowledge-bases/${kbId}/documents/${documentId}/reparse`,
    method: "POST",
  });
}

/**
 * 获取文档预览 URL。
 */
export function getDocumentPreviewUrl(kbId: string, documentId: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  return `${base}/knowledge-bases/${kbId}/documents/${documentId}/preview`;
}

/**
 * 获取文档下载 URL。
 */
export function getDocumentDownloadUrl(kbId: string, documentId: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
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
