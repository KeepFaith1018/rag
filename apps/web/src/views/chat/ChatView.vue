<script setup lang="ts">
import { onMounted, computed } from 'vue';
import ChatStatusBanner from '@/components/chat/ChatStatusBanner.vue';
import ChatTopNavBar from '@/components/layout/ChatTopNavBar.vue';
import ChatStream from '@/components/chat/ChatStream.vue';
import ChatInputArea from '@/components/chat/ChatInputArea.vue';
import ChatCitationPanel from '@/components/chat/ChatCitationPanel.vue';
import { useChatStore } from '@/stores/chat';
import { useAgentChat } from '@/modules/chat/composables/useAgentChat';
import { listAvailableKbs, listAvailableModels } from '@/api/chat';
import { getUserModels } from '@/api/model-config';
import { useMessage } from '@/composables/useMessage';

const chatStore = useChatStore();
const { sendMessage, abort, isStreaming } = useAgentChat();
const message = useMessage();

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
        visibility: kb.visibility || 'private',
        isPublic: kb.isPublic,
      })),
    );
  } catch (e) {
    message.error('加载知识库失败，请刷新重试');
  }
  try {
    const [sysModels, userModels] = await Promise.all([
      listAvailableModels(),
      getUserModels().catch(() => [] as unknown as Awaited<ReturnType<typeof getUserModels>>),
    ]);

    const merged = [
      ...sysModels.map((m) => ({
        configId: m.configId,
        modelName: m.modelName,
        provider: m.provider,
        source: m.source,
      })),
      ...(Array.isArray(userModels) ? userModels : []).map((m) => ({
        configId: String(m.id),
        modelName: m.model_name,
        provider: m.provider,
        source: 'user' as const,
      })),
    ];

    chatStore.setAvailableModels(merged);
  } catch (e) {
    message.error('加载模型配置失败，请刷新重试');
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
    const msg = chatStore.messages[i];
    if (msg && msg.role === 'user') {
      lastUserMsg = msg.content;
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
  <div class="flex flex-col h-full w-full">
    <ChatTopNavBar />

    <!-- 警告横幅 -->
    <ChatStatusBanner v-if="chatStore.hasWarnings" />

    <!-- 主内容区：消息流 + 引用面板（水平排列） -->
    <div class="flex-1 overflow-hidden flex">
      <!-- 消息流区域 -->
      <div class="flex-1 overflow-hidden flex flex-col">
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-4xl mx-auto px-4 md:px-6">
            <ChatStream :messages="chatStore.messages" :is-agent-working="isStreaming" @retry="handleRetry" />
          </div>
        </div>

        <!-- 输入区 -->
        <div class="shrink-0 border-t border-outline-variant/10 bg-surface/80 backdrop-blur-xl">
          <div class="max-w-4xl mx-auto px-4 md:px-6 py-3">
            <ChatInputArea
              :is-streaming="isStreaming"
              @send="handleSendMessage"
              @cancel="handleCancel"
            />
            <p class="text-center text-[10px] text-outline/50 mt-2">
              Linsor AI 可能产生不准确答案，请核实关键信息
            </p>
          </div>
        </div>
      </div>

      <!-- 引用面板（右侧边栏） -->
      <ChatCitationPanel v-if="showCitationPanel" />
    </div>
  </div>
</template>
