<script setup lang="ts">
/**
 * 成员面板 — 成员列表 + 邀请码管理
 */
import { ref } from 'vue'
import type { KnowledgeBaseMemberItem, KnowledgeBaseInvitationItem, KnowledgeBaseMemberRole } from "@/types/knowledge-base";

defineProps<{
  members: KnowledgeBaseMemberItem[];
  memberCount: number;
  invitations: KnowledgeBaseInvitationItem[];
  error: string;
  canManage: boolean;
}>();

const emit = defineEmits<{
  reload: [];
  createInvitation: [role: KnowledgeBaseMemberRole];
  cancelInvitation: [inv: KnowledgeBaseInvitationItem];
  removeMember: [member: KnowledgeBaseMemberItem];
  updateRole: [member: KnowledgeBaseMemberItem, role: KnowledgeBaseMemberRole];
}>();

const showInviteModal = ref(false);
const selectedRole = ref<KnowledgeBaseMemberRole>('member');

const roleOptions: Array<{
  value: KnowledgeBaseMemberRole;
  label: string;
  icon: string;
  desc: string;
}> = [
  { value: 'manager', label: '管理员', icon: 'manage_accounts', desc: '可管理设置与成员' },
  { value: 'collaborator', label: '协作者', icon: 'edit', desc: '可上传及管理文档' },
  { value: 'member', label: '成员', icon: 'person', desc: '可查看与提问' },
];

function openInviteModal() {
  selectedRole.value = 'member';
  showInviteModal.value = true;
}

function confirmCreateInvitation() {
  emit('createInvitation', selectedRole.value);
  showInviteModal.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 邀请码创建弹窗 -->
    <div
      v-if="showInviteModal"
      class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
    >
      <div
        class="w-full max-w-lg rounded-[20px] border border-outline-variant/10 bg-surface-container-low shadow-[0_28px_120px_rgba(0,0,0,0.35)]"
      >
        <div class="px-6 py-5 border-b border-outline-variant/10">
          <div class="flex items-center justify-between gap-4">
            <h3 class="font-headline text-lg font-bold">创建邀请码</h3>
            <button
              type="button"
              class="w-8 h-8 rounded-xl hover:bg-surface-container-high transition-colors flex items-center justify-center text-on-surface-variant"
              @click="showInviteModal = false"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <div class="px-6 py-5 space-y-5">
          <div>
            <label class="text-[13px] font-medium text-on-surface-variant mb-3 block">选择成员角色</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                v-for="role in roleOptions"
                :key="role.value"
                type="button"
                class="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all"
                :class="selectedRole === role.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30'"
                @click="selectedRole = role.value"
              >
                <span class="material-symbols-outlined text-2xl">{{ role.icon }}</span>
                <span class="text-sm font-medium">{{ role.label }}</span>
                <span class="text-[10px] text-outline text-center">{{ role.desc }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="px-6 py-5 border-t border-outline-variant/10 flex items-center justify-end gap-3">
          <button
            class="px-4 py-2 rounded-lg text-sm text-outline hover:bg-surface-container-high transition-colors"
            @click="showInviteModal = false"
          >取消</button>
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium bg-primary-container text-on-primary-container hover:brightness-110 transition-all"
            @click="confirmCreateInvitation"
          >生成邀请码</button>
        </div>
      </div>
    </div>

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
                <span class="text-xs text-outline ml-2">{{ member.email }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <!-- 角色切换 -->
              <select
                v-if="member.role !== 'owner'"
                :value="member.role"
                class="text-xs bg-surface-container-highest border border-outline-variant/15 rounded-lg px-2 py-1 text-on-surface focus:outline-none focus:border-primary"
                @change="$emit('updateRole', member, ($event.target as HTMLSelectElement).value as KnowledgeBaseMemberRole)"
              >
                <option value="manager">管理员</option>
                <option value="collaborator">协作者</option>
                <option value="member">成员</option>
              </select>
              <span v-else class="text-xs text-outline bg-surface-container-high px-2 py-1 rounded-lg">拥有者</span>
              <button v-if="member.role !== 'owner'" class="text-xs text-error hover:underline" @click="$emit('removeMember', member)">移除</button>
            </div>
          </div>
        </template>
        <div v-else class="text-sm text-outline py-4">当前没有额外成员。</div>
      </div>

      <!-- 有效邀请码 -->
      <div class="px-6 py-4 border-t border-outline-variant/5">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-semibold">有效邀请码</div>
          <button class="btn-primary-sm" @click="openInviteModal">创建邀请码</button>
        </div>
        <template v-if="invitations.length">
          <div v-for="inv in invitations" :key="inv.id" class="flex items-center justify-between py-2 border-b border-outline-variant/5 last:border-0">
            <div>
              <span class="text-sm text-primary">有效至 {{ new Date(inv.expiresAt).toLocaleString() }}</span>
              <span class="text-xs text-outline ml-3">{{ inv.role === 'manager' ? '管理员' : inv.role === 'collaborator' ? '协作者' : '成员' }}</span>
            </div>
            <div class="flex items-center gap-2">
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

<style scoped>
.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.3rem 0.7rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  font-family: var(--font-headline);
  font-weight: 500;
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  border: 1px solid transparent;
  transition: all 0.2s ease;
  cursor: pointer;
}
.btn-primary-sm:hover {
  filter: brightness(1.1);
}
.btn-primary-sm:active {
  transform: scale(0.98);
}

.btn-outline-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.3rem 0.7rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  font-family: var(--font-headline);
  font-weight: 500;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--color-outline-variant) 30%, transparent);
  color: var(--color-on-surface);
  transition: all 0.2s ease;
  cursor: pointer;
}
.btn-outline-sm:hover {
  background: var(--color-surface-container-high);
}
.btn-outline-sm:active {
  transform: scale(0.98);
}
</style>
