<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import UserMessageItem from './UserMessageItem.vue';
import AIMessageItem from './AIMessageItem.vue';
import type { ChatMessageItem } from '@/modules/chat/types/chat';

const props = defineProps<{
  messages: ChatMessageItem[];
  isAgentWorking: boolean;
}>();

const emit = defineEmits<{
  retry: [messageId: string | number]
}>();

/** 自动滚动到底部 */
const containerRef = ref<HTMLElement | null>(null);
let observer: MutationObserver | null = null;

function scrollToBottom() {
  nextTick(() => {
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
  });
}

/** 使用 MutationObserver 监听 DOM 变化实现流式滚动 */
function setupObserver() {
  if (!containerRef.value) return;

  observer = new MutationObserver(() => {
    scrollToBottom();
  });

  observer.observe(containerRef.value, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

onMounted(() => {
  setupObserver();
  scrollToBottom();
});

onUnmounted(() => {
  observer?.disconnect();
});

/** 监听消息变化，自动滚动 */
watch(
  () => props.messages.length,
  () => scrollToBottom(),
);

watch(
  () => props.isAgentWorking,
  (working) => {
    if (working) scrollToBottom();
  },
);

function handleRetry(messageId: string | number) {
  emit('retry', messageId);
}
</script>

<template>
  <section
    ref="containerRef"
    class="message-stream py-4 space-y-4 w-full"
  >
    <template v-if="messages.length > 0">
      <template
        v-for="msg in messages"
        :key="msg.id"
      >
        <UserMessageItem
          v-if="msg.role === 'user'"
          :message="msg"
        />
        <AIMessageItem
          v-else
          :message="msg"
          @retry="handleRetry(msg.id)"
        />
      </template>
    </template>

    <!-- 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center h-64 text-center space-y-4"
    >
      <div class="w-16 h-16 rounded-2xl bg-surface-container-low flex items-center justify-center">
        <span class="material-symbols-outlined text-4xl text-primary">chat</span>
      </div>
      <div>
        <p class="text-on-surface font-medium">开始对话</p>
        <p class="text-sm text-outline mt-1">发送消息开启智能问答体验</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.message-stream {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-surface-container-high) transparent;
}
.message-stream::-webkit-scrollbar {
  width: 6px;
}
.message-stream::-webkit-scrollbar-track {
  background: transparent;
}
.message-stream::-webkit-scrollbar-thumb {
  background: var(--color-surface-container-high) !important;
  border-radius: 10px;
}
.message-stream::-webkit-scrollbar-thumb:hover {
  background: var(--color-primary) !important;
}
</style>
