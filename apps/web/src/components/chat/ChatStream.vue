<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
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

const containerRef = ref<HTMLElement | null>(null);

/** 检查是否在底部附近（用于滚动锚定），默认阈值 200px */
function isNearBottom(): boolean {
  const el = containerRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
}

/** 滚动到底部，仅当用户未手动上滚时执行 */
function scrollToBottom(force = false) {
  if (!force && !isNearBottom()) return;
  requestAnimationFrame(() => {
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
  });
}

/** 统一滚动触发：新消息 / Agent 状态变化时滚动 */
watch(
  () => [props.messages.length, props.isAgentWorking, props.messages.at(-1)?.content?.length ?? 0],
  () => scrollToBottom(),
);

onMounted(() => {
  nextTick(() => scrollToBottom(true));
});

function handleRetry(messageId: string | number) {
  emit('retry', messageId);
}
</script>

<template>
  <section
    ref="containerRef"
    class="message-stream flex-1 min-h-0 flex flex-col py-4 space-y-4 w-full"
  >
    <template v-if="messages.length > 0">
      <template
        v-for="msg in messages"
        :key="msg.id"
      >
        <UserMessageItem
          v-if="msg.role === 'user'"
          v-memo="[msg.content]"
          :message="msg"
        />
        <AIMessageItem
          v-else
          v-memo="[msg.content, msg.messageStatus, msg.blocks?.length ?? 0]"
          :message="msg"
          @retry="handleRetry(msg.id)"
        />
      </template>
    </template>

    <!-- 空状态 -->
    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center text-center space-y-4"
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
  scrollbar-gutter: stable;
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
