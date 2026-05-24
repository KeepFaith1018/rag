<script setup lang="ts">
/**
 * 成员面板 — 成员列表 + 邀请码管理
 */
import type { KnowledgeBaseMemberItem, KnowledgeBaseInvitationItem } from "@/types/knowledge-base";

defineProps<{
  /** 成员列表 */
  members: KnowledgeBaseMemberItem[];
  /** 成员总数 */
  memberCount: number;
  /** 有效邀请码列表 */
  invitations: KnowledgeBaseInvitationItem[];
  /** 错误信息 */
  error: string;
  /** 当前用户是否有管理权限 */
  canManage: boolean;
}>();
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 成员管理区域 -->
    <div v-if="canManage" class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5">
      <div class="px-6 py-4 flex items-center justify-between border-b border-outline-variant/5 bg-surface-container-high/30">
        <h4 class="text-lg font-headline font-bold">成员管理</h4>
        <div class="flex items-center gap-2">
          <button class="btn-outline-sm" @click="$emit('reload')">
            <span class="material-symbols-outlined text-[18px]">sync</span> 刷新成员
          </button>
        </div>
      </div>

      <!-- 当前成员 -->
      <div class="px-6 py-4">
        <div class="text-sm font-semibold mb-4">当前成员 ({{ memberCount }})</div>
        <template v-if="members.length">
          <div v-for="member in members" :key="member.userId" class="flex items-center justify-between py-2 border-b border-outline-variant/5 last:border-0">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center">
                <span class="material-symbols-outlined text-sm text-outline">person</span>
              </div>
              <div>
                <span class="text-sm font-medium">{{ member.fullName }}</span>
                <span class="text-xs text-outline ml-2">{{ member.email }} · {{ member.role === 'owner' ? '拥有者' : member.role === 'manager' ? '管理员' : member.role === 'collaborator' ? '协作者' : '成员' }}</span>
              </div>
            </div>
            <button v-if="member.role !== 'owner'" class="text-xs text-error hover:underline" @click="$emit('removeMember', member)">移除</button>
          </div>
        </template>
        <div v-else class="text-sm text-outline py-4">当前没有额外成员。</div>
      </div>

      <!-- 有效邀请码 -->
      <div class="px-6 py-4 border-t border-outline-variant/5">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-semibold">有效邀请码</div>
          <button class="btn-primary-sm" @click="$emit('createInvitation')">创建邀请码</button>
        </div>
        <template v-if="invitations.length">
          <div v-for="inv in invitations" :key="inv.id" class="flex items-center justify-between py-2 border-b border-outline-variant/5 last:border-0">
            <div>
              <span class="text-sm font-mono text-primary">{{ inv.inviteCode }}</span>
              <span class="text-xs text-outline ml-3">{{ inv.role === 'manager' ? '管理员' : inv.role === 'collaborator' ? '协作者' : '成员' }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="text-xs text-primary hover:underline" @click="$emit('copyInviteCode', inv.inviteCode)">复制</button>
              <button class="text-xs text-error hover:underline" @click="$emit('cancelInvitation', inv)">取消</button>
            </div>
          </div>
        </template>
        <div v-else class="text-sm text-outline">当前没有有效邀请码。</div>
      </div>

      <p v-if="error" class="text-sm text-error px-6 pb-4">{{ error }}</p>
    </div>

    <!-- 无权限提示 -->
    <div v-else class="bg-surface-container-low rounded-xl p-8 text-center border border-outline-variant/5">
      <span class="material-symbols-outlined text-4xl text-outline mb-3">shield</span>
      <div class="text-lg font-headline font-semibold">当前角色无成员管理权限</div>
      <div class="text-sm text-outline mt-1">开放成员与邀请列表接口，因此这里展示只读提示。</div>
    </div>
  </div>
</template>
