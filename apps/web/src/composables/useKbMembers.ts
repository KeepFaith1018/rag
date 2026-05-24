import { ref } from "vue";
import {
  cancelKnowledgeBaseInvitation,
  createKnowledgeBaseInvitation,
  listKnowledgeBaseInvitations,
  listKnowledgeBaseMembers,
  removeKnowledgeBaseMember,
  updateKnowledgeBaseMemberRole,
} from "@/api/kb-member";
import type {
  CreateKnowledgeBaseInvitationPayload,
  KnowledgeBaseInvitationItem,
  KnowledgeBaseMemberItem,
} from "@/types/knowledge-base";

/**
 * 知识库成员与邀请管理封装。
 */
export function useKbMembers() {
  const isLoading = ref(false);
  const isSubmitting = ref(false);
  const members = ref<KnowledgeBaseMemberItem[]>([]);
  const invitations = ref<KnowledgeBaseInvitationItem[]>([]);

  /**
   * 刷新成员列表。
   */
  async function fetchMembers(kbId: string) {
    isLoading.value = true;

    try {
      const result = await listKnowledgeBaseMembers(kbId);
      members.value = result.list;
      return result;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 刷新邀请列表。
   */
  async function fetchInvitations(kbId: string) {
    isLoading.value = true;

    try {
      const result = await listKnowledgeBaseInvitations(kbId);
      invitations.value = result.list;
      return result;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 同步拉取成员与邀请数据。
   */
  async function reload(kbId: string) {
    await Promise.all([fetchMembers(kbId), fetchInvitations(kbId)]);
  }

  /**
   * 创建邀请并刷新邀请列表。
   */
  async function createInvitation(
    kbId: string,
    payload: CreateKnowledgeBaseInvitationPayload,
  ) {
    isSubmitting.value = true;

    try {
      const result = await createKnowledgeBaseInvitation(kbId, payload);
      await fetchInvitations(kbId);
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 取消邀请并刷新邀请列表。
   */
  async function cancelInvitation(kbId: string, invitationId: string) {
    isSubmitting.value = true;

    try {
      const result = await cancelKnowledgeBaseInvitation(kbId, invitationId);
      await fetchInvitations(kbId);
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 移除成员并刷新成员列表。
   */
  async function removeMember(kbId: string, memberUserId: string) {
    isSubmitting.value = true;

    try {
      const result = await removeKnowledgeBaseMember(kbId, memberUserId);
      await fetchMembers(kbId);
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 更新成员角色并刷新成员列表。
   */
  async function updateMemberRole(
    kbId: string,
    memberUserId: string,
    role: string,
  ) {
    isSubmitting.value = true;

    try {
      const result = await updateKnowledgeBaseMemberRole(kbId, memberUserId, role);
      await fetchMembers(kbId);
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    isLoading,
    isSubmitting,
    members,
    invitations,
    fetchMembers,
    fetchInvitations,
    reload,
    createInvitation,
    cancelInvitation,
    removeMember,
    updateMemberRole,
  };
}
