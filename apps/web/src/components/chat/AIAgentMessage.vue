<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { ChatMessageItem } from '@/modules/chat/types/chat';

interface Props {
  message: ChatMessageItem;
}

const props = defineProps<Props>();

const chatStore = useChatStore();

/** 是否是 AI 消息 */
const isAI = computed(() => props.message.role === 'ai');

/** 当前 Agent 阶段 */
const agentPhase = computed(() => chatStore.agentPhase);

/** 是否正在流式输出 */
const isStreaming = computed(() => props.message.messageStatus === 'streaming');

/** 是否是 RAG 模式 */
const isRagMode = computed(() => props.message.chatMode === 'rag');

/** Agent 阶段配置 */
const phaseConfig: Record<string, { label: string; icon: string; color: string }> = {
  planning: { label: '规划中', icon: 'psychology', color: 'text-purple-400' },
  retrieving: { label: '检索中', icon: 'search', color: 'text-blue-400' },
  reranking: { label: '重排中', icon: 'sort', color: 'text-cyan-400' },
  verifying: { label: '校验中', icon: 'verified', color: 'text-amber-400' },
  writing: { label: '生成中', icon: 'edit_note', color: 'text-green-400' },
  done: { label: '完成', icon: 'check_circle', color: 'text-primary' },
};
</script>

<template>
  <div
    v-if="isAI"
    class="flex gap-6 items-start group"
  >
    <!-- Avatar -->
    <div
      class="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center border shadow-xl bg-surface-container-high border-outline-variant/10"
    >
      <span
        class="material-symbols-outlined text-[20px] text-primary"
        style="font-variation-settings: 'FILL' 1;"
      >
        smart_toy
      </span>
    </div>

    <!-- Content Area -->
    <div class="flex-1 space-y-4">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <span class="font-headline font-bold text-sm tracking-tight text-on-surface">{{ message.name }}</span>

        <span
          v-if="isRagMode"
          class="text-[10px] font-label font-medium uppercase tracking-[0.1em] text-outline px-2 py-0.5 bg-surface-container-low rounded border border-outline-variant/5"
        >
          RAG
        </span>
      </div>

      <!-- Agent 状态头部 (RAG 模式) -->
      <div
        v-if="agentPhase && isRagMode"
        class="flex items-center gap-4 px-4 py-2 bg-surface-container-low rounded-xl border border-outline-variant/10"
      >
        <div class="flex items-center gap-1.5">
          <span
            :class="['material-symbols-outlined text-base', phaseConfig[agentPhase]?.color]"
          >
            {{ phaseConfig[agentPhase]?.icon || 'circle' }}
          </span>
          <span class="text-sm font-medium text-on-surface">
            {{ chatStore.agentPhaseLabel || phaseConfig[agentPhase]?.label }}
          </span>
          <span
            v-if="chatStore.agentPhaseDetail"
            class="text-xs text-outline"
          >
            — {{ chatStore.agentPhaseDetail }}
          </span>
        </div>

        <!-- 流式指示器 -->
        <div v-if="isStreaming" class="ml-auto flex items-center gap-2">
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
          <span class="text-xs text-primary font-label">生成中...</span>
        </div>
      </div>

      <!-- 检索进度 (RAG 模式 retrieving 阶段) -->
      <div
        v-if="agentPhase === 'retrieving' && chatStore.retrievalProgresses.length > 0"
        class="flex flex-col gap-2 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
      >
        <div class="text-xs font-label text-outline uppercase tracking-widest">检索进度</div>
        <div class="flex gap-4">
          <div
            v-for="progress in chatStore.retrievalProgresses"
            :key="progress.type"
            class="flex items-center gap-2"
          >
            <span class="text-xs text-on-surface">Dense: {{ progress.denseCount ?? 0 }}</span>
            <span class="text-xs text-on-surface">Sparse: {{ progress.sparseCount ?? 0 }}</span>
            <span class="text-xs text-primary font-medium">Fused: {{ progress.fusedCount ?? 0 }}</span>
          </div>
        </div>
      </div>

      <!-- AI 回复内容 -->
      <div
        v-if="message.htmlContent || message.content"
        class="prose prose-invert max-w-none text-on-surface-variant font-body leading-relaxed text-sm"
        v-html="message.htmlContent || message.content"
      ></div>

      <!-- 流式加载中的占位符 -->
      <div
        v-else-if="isStreaming"
        class="flex gap-6 items-center py-4"
      >
        <div class="w-2 h-2 bg-primary rounded-full ai-thinking-glow"></div>
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

      <!-- 已取消状态 -->
      <div
        v-if="message.messageStatus === 'aborted'"
        class="text-sm text-error font-medium"
      >
        请求已取消
      </div>

      <!-- 错误状态 -->
      <div
        v-if="message.messageStatus === 'error'"
        class="text-sm text-error font-medium"
      >
        生成失败，请重试
      </div>
    </div>
  </div>

  <!-- 用户消息 -->
  <div
    v-else
    class="flex gap-6 items-start group flex-row-reverse"
  >
    <!-- Avatar -->
    <div
      class="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center border shadow-xl bg-primary-container border-primary/20 shadow-[0_0_20px_rgba(79,70,229,0.2)]"
    >
      <span class="material-symbols-outlined text-[20px] text-on-primary-container">person</span>
    </div>

    <!-- Content Area -->
    <div class="flex-1 space-y-4 text-right">
      <!-- Header -->
      <div class="flex items-center gap-3 justify-end">
        <span class="font-headline font-bold text-sm tracking-tight text-on-surface">{{ message.name }}</span>
      </div>

      <!-- Body -->
      <div
        class="inline-block p-5 bg-surface-container-low rounded-2xl rounded-tr-none border border-outline-variant/10 text-on-surface-variant text-sm max-w-[80%] text-left"
        v-html="message.content"
      ></div>
    </div>
  </div>
</template>

<style scoped>
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
</style>