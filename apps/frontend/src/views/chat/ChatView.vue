<script setup lang="ts">
import TopNavBar from '@/components/layout/TopNavBar.vue';
import ChatStream from '@/components/chat/ChatStream.vue';
import ChatInputArea from '@/components/chat/ChatInputArea.vue';
import { ref } from 'vue';

interface ChatMessage {
  id: number;
  role: 'ai' | 'user';
  name: string;
  content: string;
  time?: string;
  tag?: string;
}

const messages = ref<ChatMessage[]>([
  {
    id: 1,
    role: 'ai',
    name: '链接引擎',
    tag: '系统',
    content: '<p>我已经分析了为 <span class="text-primary font-medium">Linsor AI</span> 提供的技术规范。架构层表明正向高度模块化、事件驱动的组件转变。</p><div class="my-6 p-5 bg-surface-container-low rounded-xl border-l-2 border-primary/40 relative overflow-hidden"><div class="absolute inset-0 opacity-[0.03]" style="background-image: radial-gradient(circle, #c3c0ff 1px, transparent 1px); background-size: 12px 12px;"></div><code class="text-xs text-on-surface block leading-loose font-mono">[System_State]: 就绪<br/>[Knowledge_Source]: 知识源_v1.2<br/>[Analysis_Depth]: 高</code></div><p>您是否希望我根据这些参数生成部署示意图？</p>'
  },
  {
    id: 2,
    role: 'user',
    name: '首席架构师',
    time: '14:22 PM',
    content: '是的，开始生成示意图。请优先考虑低延迟边缘节点，并确保玻璃拟态参数遵循 v2 设计规范。'
  }
]);

const isAgentWorking = ref(true);

</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <TopNavBar title="AI 对话舱" subtitle="Nexus_Engine_v4" />
    
    <div class="flex-1 overflow-y-auto w-full">
      <ChatStream :messages="messages" :is-agent-working="isAgentWorking" />
    </div>

    <ChatInputArea />
  </div>
</template>
