import { apiRequest } from "@/api/api";
import type {
  CreateKnowledgeBaseInvitationPayload,
  CreateKnowledgeBaseInvitationResponse,
  JoinKnowledgeBasePayload,
  JoinKnowledgeBaseResponse,
  KnowledgeBaseInvitationItem,
  KnowledgeBaseInvitationListResponse,
  KnowledgeBaseMemberListResponse,
} from "@/types/knowledge-base";

/**
 * 获取知识库成员列表。
 */
export function listKnowledgeBaseMembers(kbId: string) {
  return apiRequest<KnowledgeBaseMemberListResponse>({
    url: `/knowledge-bases/${kbId}/members`,
    method: "GET",
  });
}

/**
 * 创建知识库邀请。
 */
export function createKnowledgeBaseInvitation(
  kbId: string,
  payload: CreateKnowledgeBaseInvitationPayload,
) {
  return apiRequest<CreateKnowledgeBaseInvitationResponse>({
    url: `/knowledge-bases/${kbId}/invitations`,
    method: "POST",
    body: payload,
  });
}

/**
 * 获取有效邀请列表。
 */
export function listKnowledgeBaseInvitations(kbId: string) {
  return apiRequest<KnowledgeBaseInvitationListResponse>({
    url: `/knowledge-bases/${kbId}/invitations`,
    method: "GET",
  });
}

/**
 * 取消知识库邀请。
 */
export function cancelKnowledgeBaseInvitation(
  kbId: string,
  invitationId: string,
) {
  return apiRequest<KnowledgeBaseInvitationItem>({
    url: `/knowledge-bases/${kbId}/invitations/${invitationId}`,
    method: "DELETE",
  });
}

/**
 * 通过邀请码加入知识库。
 */
export function joinKnowledgeBaseByInvite(payload: JoinKnowledgeBasePayload) {
  return apiRequest<JoinKnowledgeBaseResponse>({
    url: "/knowledge-bases/join",
    method: "POST",
    body: payload,
  });
}

/**
 * 移除知识库成员。
 */
export function removeKnowledgeBaseMember(kbId: string, memberUserId: string) {
  return apiRequest<{ kbId: string; memberUserId: string; removed: boolean }>({
    url: `/knowledge-bases/${kbId}/members/${memberUserId}`,
    method: "DELETE",
  });
}

/**
 * 更新成员角色。
 */
export function updateKnowledgeBaseMemberRole(
  kbId: string,
  memberUserId: string,
  role: string,
) {
  return apiRequest<{ kbId: string; memberUserId: string; role: string; updated: boolean }>({
    url: `/knowledge-bases/${kbId}/members/${memberUserId}`,
    method: "PATCH",
    body: { role },
  });
}
