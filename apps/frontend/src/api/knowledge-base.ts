import { apiRequest } from "@/api/api";
import type { ApiQueryParams } from "@/types/api";
import type {
  CreateKnowledgeBasePayload,
  KnowledgeBaseDetail,
  KnowledgeBaseListResponse,
  ListKnowledgeBasesQuery,
  ListPublicKnowledgeBasesQuery,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

/**
 * 获取当前用户可见的知识库列表。
 */
export function listMyKnowledgeBases(query: ListKnowledgeBasesQuery = {}) {
  return apiRequest<KnowledgeBaseListResponse>({
    url: "/knowledge-bases",
    method: "GET",
    params: query as ApiQueryParams,
  });
}

/**
 * 获取公开共享知识库列表。
 */
export function listPublicKnowledgeBases(
  query: ListPublicKnowledgeBasesQuery = {},
) {
  return apiRequest<KnowledgeBaseListResponse>({
    url: "/public/knowledge-bases",
    method: "GET",
    params: query as ApiQueryParams,
  });
}

/**
 * 获取知识库详情。
 */
export function getKnowledgeBaseDetail(kbId: string) {
  return apiRequest<KnowledgeBaseDetail>({
    url: `/knowledge-bases/${kbId}`,
    method: "GET",
  });
}

/**
 * 创建知识库。
 */
export function createKnowledgeBase(payload: CreateKnowledgeBasePayload) {
  return apiRequest<KnowledgeBaseDetail>({
    url: "/knowledge-bases",
    method: "POST",
    body: payload,
  });
}

/**
 * 更新知识库。
 */
export function updateKnowledgeBase(
  kbId: string,
  payload: UpdateKnowledgeBasePayload,
) {
  return apiRequest<KnowledgeBaseDetail>({
    url: `/knowledge-bases/${kbId}`,
    method: "PATCH",
    body: payload,
  });
}

/**
 * 删除知识库。
 */
export function deleteKnowledgeBase(kbId: string) {
  return apiRequest<{ id: string; deleted: boolean }>({
    url: `/knowledge-bases/${kbId}`,
    method: "DELETE",
  });
}
