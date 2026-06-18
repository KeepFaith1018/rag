<script setup lang="ts">
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();
</script>

<template>
  <div class="flex items-center rounded-lg bg-surface-container-high/80 p-0.5 border border-outline-variant/10">
    <button
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
        chatStore.chatMode === 'chat'
          ? 'bg-primary-container text-on-primary-container shadow-sm'
          : 'text-outline hover:text-on-surface',
      ]"
      @click="chatStore.setChatMode('chat')"
    >
      <span class="material-symbols-outlined text-[14px]">chat</span>
      <span>对话</span>
    </button>
    <button
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
        chatStore.chatMode === 'rag'
          ? 'bg-primary-container text-on-primary-container shadow-sm'
          : 'text-outline hover:text-on-surface',
      ]"
      @click="chatStore.setChatMode('rag')"
    >
      <span class="material-symbols-outlined text-[14px]">library_books</span>
      <span>RAG</span>
      <span
        v-if="chatStore.selectedKbCount > 0"
        class="ml-0.5 px-1.5 py-0.5 bg-primary/20 text-primary rounded text-[10px] leading-none"
      >
        {{ chatStore.selectedKbCount }}
      </span>
    </button>
  </div>
</template>
