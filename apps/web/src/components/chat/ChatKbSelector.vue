<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

/** RAG 模式下且有可用知识库时显示 */
const visible = computed(
  () => chatStore.chatMode === 'rag' && chatStore.availableKbs.length > 0,
);

/** 权限配置 */
const permissionConfig: Record<string, { label: string; color: string }> = {
  owner: { label: '所有者', color: 'text-purple-400' },
  manager: { label: '管理员', color: 'text-red-400' },
  collaborator: { label: '协作者', color: 'text-blue-400' },
  member: { label: '成员', color: 'text-green-400' },
  publicVisitor: { label: '访客', color: 'text-gray-400' },
};

/**
 * 切换知识库选中状态
 */
function toggleKb(kbId: string) {
  chatStore.toggleKb(kbId);
}

/**
 * 检查知识库是否选中
 */
function isSelected(kbId: string): boolean {
  return chatStore.selectedKbIds.includes(kbId);
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <div
      v-if="visible"
      class="flex flex-wrap items-center gap-2 px-4 py-3 bg-surface-container-low/50 rounded-xl border border-outline-variant/10"
    >
      <span class="text-xs text-outline font-medium mr-1 flex items-center gap-1">
        <span class="material-symbols-outlined text-[14px]">folder_open</span>
        选择知识库
      </span>

      <button
        v-for="kb in chatStore.availableKbs"
        :key="kb.kbId"
        :class="[
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
          isSelected(kb.kbId)
            ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
            : 'bg-surface-container border-outline-variant/10 text-outline hover:border-outline',
        ]"
        @click="toggleKb(kb.kbId)"
      >
        <!-- 选中状态图标 -->
        <span
          :class="[
            'material-symbols-outlined text-[14px]',
            isSelected(kb.kbId) ? 'text-primary' : 'opacity-0',
          ]"
        >
          check_circle
        </span>

        <!-- 知识库名称 -->
        <span class="max-w-[120px] truncate">{{ kb.kbName }}</span>

        <!-- 权限标签 -->
        <span
          :class="[
            'text-[10px] px-1 py-0.5 rounded',
            permissionConfig[kb.permission]?.color || 'text-gray-400',
          ]"
        >
          {{ permissionConfig[kb.permission]?.label || kb.permission }}
        </span>
      </button>

      <!-- 未选择知识库提示 -->
      <span
        v-if="chatStore.selectedKbIds.length === 0"
        class="text-xs text-amber-400 flex items-center gap-1"
      >
        <span class="material-symbols-outlined text-[14px]">info</span>
        请选择至少一个知识库
      </span>
    </div>
  </Transition>
</template>
