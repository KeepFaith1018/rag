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
 * 下载知识库原始文档。
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
