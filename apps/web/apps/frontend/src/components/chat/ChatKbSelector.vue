<script setup lang="ts">
/**
 * ChatKbSelector - 知识库选择器
 *
 * 仅在 RAG 模式下展示，支持多选知识库。
 */
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

const isRagMode = computed(() => chatStore.chatMode === 'rag');

const selectedCount = computed(() => chatStore.selectedKbIds.length);

const selectedKbNames = computed(() => {
  return chatStore.availableKbs
    .filter((kb) => chatStore.selectedKbIds.includes(kb.kbId))
    .map((kb) => kb.kbName)
    .join(', ');
});

/**
 * 切换知识库选中状态。
 */
function toggleKb(kbId: string) {
  chatStore.toggleKb(kbId);
}

/**
 * 全选知识库。
 */
function selectAll() {
  const allKbIds = chatStore.availableKbs.map((kb) => kb.kbId);
  chatStore.setSelectedKbIds(allKbIds);
}

/**
 * 清空选择。
 */
function clearAll() {
  chatStore.setSelectedKbIds([]);
}

/**
 * 判断知识库是否被选中。
 */
function isSelected(kbId: string): boolean {
  return chatStore.selectedKbIds.includes(kbId);
}
</script>

<template>
  <!-- 仅 RAG 模式下展示 -->
  <div
    v-if="isRagMode"
    class="flex items-center gap-3 px-4 py-2 bg-surface-container-low rounded-xl border border-outline-variant/10"
  >
    <!-- 知识库图标 -->
    <div class="flex items-center gap-1.5 text-primary">
      <span class="material-symbols-outlined text-[18px]">library_books</span>
      <span class="text-xs font-label uppercase tracking-widest">知识库</span>
    </div>

    <!-- 分割线 -->
    <div class="w-px h-5 bg-outline-variant/20"></div>

    <!-- 知识库列表 -->
    <div class="flex items-center gap-2 flex-1 overflow-x-auto">
      <button
        v-for="kb in chatStore.availableKbs"
        :key="kb.kbId"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label transition-all whitespace-nowrap"
        :class="[
          isSelected(kb.kbId)
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-surface-container-high text-outline hover:text-on-surface',
        ]"
        @click="toggleKb(kb.kbId)"
      >
        <!-- 选中指示 -->
        <span
          class="w-1.5 h-1.5 rounded-full transition-colors"
          :class="isSelected(kb.kbId) ? 'bg-primary' : 'bg-outline/30'"
        ></span>
        {{ kb.kbName }}
      </button>
    </div>

    <!-- 选中数量提示 -->
    <div
      v-if="selectedCount > 0"
      class="flex items-center gap-2 text-xs text-outline"
    >
      <span class="font-label">已选 {{ selectedCount }} 个</span>
      <button
        class="text-primary hover:text-primary/80 transition-colors"
        @click="clearAll"
      >
        清空
      </button>
    </div>
  </div>
</template>
