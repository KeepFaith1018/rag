<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import MessageBubble from './MessageBubble.vue';
import type { ChatMessageItem } from '@/modules/chat/types/chat';

const props = defineProps<{
  messages: ChatMessageItem[];
  isAgentWorking: boolean;
}>();

/** 自动滚动到底部 */
const containerRef = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
  });
}

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

// 格式化时间
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
</script>

<template>
  <section
    ref="containerRef"
    class="message-stream px-6 py-8 space-y-12 max-w-5xl mx-auto w-full pb-32"
  >
    <template v-if="messages.length > 0">
      <MessageBubble
        v-for="msg in messages"
        :key="msg.id"
        :message="{
          id: msg.id,
          role: msg.role,
          name: msg.name,
          time: formatTime(msg.createdAt),
          tag: msg.role === 'ai' && msg.chatMode === 'rag' ? 'RAG' : undefined,
          content: msg.htmlContent || msg.content,
        }"
      />
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

    <!-- Agent 状态指示器 -->
    <div v-if="isAgentWorking && messages.length > 0" class="flex gap-6 items-center py-4">
      <div class="w-10 flex justify-center">
        <div class="w-2 h-2 bg-primary rounded-full ai-thinking-glow"></div>
      </div>
      <div class="flex flex-col">
        <span class="text-xs font-label uppercase tracking-widest text-primary font-semibold">
          AI 正在思考...
        </span>
        <div
          class="mt-2 w-48 h-[2px] bg-surface-container-high rounded-full overflow-hidden relative"
        >
          <div
            class="absolute h-full bg-primary-container w-1/3 animate-[shimmer_2s_infinite_linear]"
          ></div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.message-stream {
  overflow-y: auto;
}
.message-stream::-webkit-scrollbar {
  width: 4px;
}
.message-stream::-webkit-scrollbar-track {
  background: transparent;
}
.message-stream::-webkit-scrollbar-thumb {
  background: #2a2a2c;
  border-radius: 10px;
}
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
</style>
