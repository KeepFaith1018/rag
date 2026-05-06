<script setup lang="ts">
import { onMounted, computed } from 'vue';
import ChatStatusBanner from '@/components/chat/ChatStatusBanner.vue';
import ChatTopNavBar from '@/components/layout/ChatTopNavBar.vue';
import ChatStream from '@/components/chat/ChatStream.vue';
import ChatInputArea from '@/components/chat/ChatInputArea.vue';
import ChatCitationPanel from '@/components/chat/ChatCitationPanel.vue';
import ChatSettingsBar from '@/components/chat/ChatSettingsBar.vue';
import { useChatStore } from '@/stores/chat';
import { useAgentChat } from '@/modules/chat/composables/useAgentChat';
import { listAvailableKbs, listAvailableModels } from '@/api/chat';

const chatStore = useChatStore();
const { sendMessage, abort, isStreaming } = useAgentChat();

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
        visibility: kb.visibility,
        isPublic: kb.isPublic,
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
  chatStore.setLastUserMessage(message);
  await sendMessage(message);
}

// 处理取消请求
function handleCancel() {
  abort();
}

// 处理重试
async function handleRetry(messageId: string | number) {
  const msgIndex = chatStore.messages.findIndex((m) => m.id === messageId);
  if (msgIndex === -1) return;

  // 从失败消息往前找最近一条用户消息
  let lastUserMsg = '';
  for (let i = msgIndex - 1; i >= 0; i--) {
    if (chatStore.messages[i].role === 'user') {
      lastUserMsg = chatStore.messages[i].content;
      break;
    }
  }
  if (!lastUserMsg) return;

  // 删除失败消息及之后的所有消息
  chatStore.messages.splice(msgIndex);
  await sendMessage(lastUserMsg);
}
</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <ChatTopNavBar />

    <!-- 警告横幅 -->
    <ChatStatusBanner v-if="chatStore.hasWarnings" />

    <!-- 设置条：模式/知识库/模型选择 -->
    <div class="px-6 py-3 border-b border-outline-variant/10">
      <ChatSettingsBar />
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 overflow-hidden flex flex-col relative">
      <!-- 消息流区域：占满上方空间，底部留出输入框空间 -->
      <div class="flex-1 overflow-y-auto pb-36">
        <ChatStream :messages="chatStore.messages" :is-agent-working="isStreaming" @retry="handleRetry" />
      </div>

      <!-- 引用面板 -->
      <ChatCitationPanel v-if="showCitationPanel" />

      <!-- 浮动输入框，绝对定位在底部 -->
      <div class="absolute bottom-0 left-0 right-0 px-6 py-4">
        <ChatInputArea
          :is-streaming="isStreaming"
          @send="handleSendMessage"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </div>
</template>
