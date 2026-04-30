<script setup lang="ts">
import { onMounted, computed } from 'vue';
import TopNavBar from '@/components/layout/TopNavBar.vue';
import ChatStream from '@/components/chat/ChatStream.vue';
import ChatInputArea from '@/components/chat/ChatInputArea.vue';
import ChatAgentTimeline from '@/components/chat/ChatAgentTimeline.vue';
import ChatCitationPanel from '@/components/chat/ChatCitationPanel.vue';
import ChatStatusBanner from '@/components/chat/ChatStatusBanner.vue';
import { useChatStore } from '@/stores/chat';
import { useAgentChat } from '@/modules/chat/composables/useAgentChat';
import { listAvailableKbs, listAvailableModels } from '@/api/chat';

const chatStore = useChatStore();
const { sendMessage, isStreaming } = useAgentChat();

// 是否显示 Agent 时间线
const showAgentTimeline = computed(
  () => chatStore.agentPhase !== null && chatStore.agentPhase !== 'done',
);

// 是否显示引用面板
const showCitationPanel = computed(() => chatStore.hasCitations);

// 加载可选知识库和模型
onMounted(async () => {
  await chatStore.loadSessions();
  try {
    const kbs = await listAvailableKbs();
    chatStore.setAvailableKbs(
      kbs.map((kb) => ({
        kbId: kb.kbId,
        kbName: kb.kbName,
        permission: kb.permission as 'owner' | 'manager' | 'collaborator' | 'member' | 'publicVisitor',
      })),
    );
  } catch (e) {
    console.error('[ChatView] 加载知识库失败:', e);
  }
  try {
    const models = await listAvailableModels();
    chatStore.setAvailableModels(
      models.map((m) => ({
        configId: m.configId,
        modelName: m.modelName,
        provider: m.provider,
        source: m.source,
      })),
    );
  } catch (e) {
    console.error('[ChatView] 加载模型失败:', e);
  }
});

// 处理发送消息
async function handleSendMessage(message: string) {
  if (!message.trim() || chatStore.isSending) return;
  await sendMessage(message);
}
</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <TopNavBar
      title="AI 对话舱"
      :subtitle="chatStore.currentSession?.title || '新建会话'"
    />

    <!-- 警告横幅 -->
    <ChatStatusBanner v-if="chatStore.hasWarnings" />

    <!-- Agent 时间线 -->
    <ChatAgentTimeline v-if="showAgentTimeline" />

    <!-- 主内容区 -->
    <div class="flex-1 overflow-hidden flex">
      <!-- 消息流 -->
      <div class="flex-1 overflow-y-auto">
        <ChatStream :messages="chatStore.messages" :is-agent-working="isStreaming" />
      </div>

      <!-- 引用面板 -->
      <ChatCitationPanel v-if="showCitationPanel" />
    </div>

    <!-- 输入区 -->
    <ChatInputArea @send="handleSendMessage" />
  </div>
</template>
