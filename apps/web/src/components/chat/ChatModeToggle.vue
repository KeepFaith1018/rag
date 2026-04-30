<script setup lang="ts">
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Chat 模式 -->
    <button
      :class="[
        'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all',
        chatStore.chatMode === 'chat'
          ? 'bg-primary-container text-on-primary-container shadow-lg'
          : 'bg-surface-container-low text-outline hover:text-on-surface',
      ]"
      @click="chatStore.setChatMode('chat')"
    >
      <span class="material-symbols-outlined text-[16px]">chat</span>
      普通对话
    </button>

    <!-- RAG 模式 -->
    <button
      :class="[
        'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all',
        chatStore.chatMode === 'rag'
          ? 'bg-primary-container text-on-primary-container shadow-lg'
          : 'bg-surface-container-low text-outline hover:text-on-surface',
      ]"
      @click="chatStore.setChatMode('rag')"
    >
      <span class="material-symbols-outlined text-[16px]">library_books</span>
      RAG 问答
      <span
        v-if="chatStore.selectedKbCount > 0"
        class="ml-1 px-1.5 py-0.5 bg-primary/20 text-primary rounded-full text-[10px]"
      >
        {{ chatStore.selectedKbCount }}
      </span>
    </button>
  </div>
</template>
