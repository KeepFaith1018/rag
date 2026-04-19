<script setup lang="ts">
import MessageBubble from './MessageBubble.vue';

interface Message {
  id: number | string;
  role: 'ai' | 'user';
  name: string;
  time?: string;
  tag?: string;
  content: string;
}

defineProps<{
  messages: Message[];
  isAgentWorking: boolean;
}>();
</script>

<template>
  <section class="message-stream px-6 py-8 space-y-12 max-w-5xl mx-auto w-full pb-32">
    <MessageBubble
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
    />

    <!-- Agent Status Component -->
    <div v-if="isAgentWorking" class="flex gap-6 items-center py-4 transition-opacity">
      <div class="w-10 flex justify-center">
        <div class="w-2 h-2 bg-primary rounded-full ai-thinking-glow"></div>
      </div>
      <div class="flex flex-col">
        <span class="text-xs font-label uppercase tracking-widest text-primary font-semibold">正在检索本地知识库...</span>
        <div class="mt-2 w-48 h-[2px] bg-surface-container-high rounded-full overflow-hidden relative">
          <div class="absolute h-full bg-primary-container w-1/3 animate-[shimmer_2s_infinite_linear]"></div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
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
