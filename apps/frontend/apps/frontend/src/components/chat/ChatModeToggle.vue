<script setup lang="ts">
/**
 * ChatModeToggle - 聊天模式切换
 *
 * 切换普通对话模式 (chat) 和 RAG 模式 (rag)。
 */
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

const chatMode = computed(() => chatStore.chatMode);

const isRagMode = computed(() => chatMode.value === 'rag');

/**
 * 切换到普通对话模式。
 */
function switchToChat() {
  chatStore.setChatMode('chat');
}

/**
 * 切换到 RAG 模式。
 */
function switchToRag() {
  chatStore.setChatMode('rag');
}
</script>

<template>
  <div class="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
    <!-- 普通对话模式 -->
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label transition-all whitespace-nowrap"
      :class="[
        !isRagMode
          ? 'bg-primary-container text-on-primary-container shadow-sm'
          : 'text-outline hover:text-on-surface',
      ]"
      @click="switchToChat"
    >
      <span class="material-symbols-outlined text-[14px]">chat</span>
      对话
    </button>

    <!-- RAG 模式 -->
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label transition-all whitespace-nowrap"
      :class="[
        isRagMode
          ? 'bg-primary-container text-on-primary-container shadow-sm'
          : 'text-outline hover:text-on-surface',
      ]"
      @click="switchToRag"
    >
      <span class="material-symbols-outlined text-[14px]">library_books</span>
      知识库问答
    </button>
  </div>
</template>
