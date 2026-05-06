<script setup lang="ts">
import { computed, ref } from 'vue';
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

/** Agent 步骤列表 */
const agentSteps = computed(() => chatStore.agentSteps);

/** 工具调用列表 */
const toolCalls = computed(() => chatStore.toolCalls);

/** 是否展开 Agent 详情（默认展开） */
const isExpanded = ref(true);

/** 检索进度列表 */
const retrievalProgresses = computed(() => chatStore.retrievalProgresses);

/** Agent 阶段配置 */
const phaseConfig: Record<string, { label: string; icon: string; color: string }> = {
  planning: { label: '规划中', icon: 'psychology', color: 'text-purple-400' },
  retrieving: { label: '检索中', icon: 'search', color: 'text-blue-400' },
  reranking: { label: '重排中', icon: 'sort', color: 'text-cyan-400' },
  verifying: { label: '校验中', icon: 'verified', color: 'text-amber-400' },
  writing: { label: '生成中', icon: 'edit_note', color: 'text-green-400' },
  done: { label: '完成', icon: 'check_circle', color: 'text-primary' },
};

/** 节点类型到中文的映射 */
const stepTypeLabels: Record<string, string> = {
  route_query: '路由分析',
  rewrite_query: '查询改写',
  decompose_question: '问题拆解',
  hybrid_retrieve: '混合检索',
  relevance_check: '相关性检查',
  fact_check: '事实校验',
  completeness_check: '完整性检查',
};

/** 获取步骤的中文标签 */
function getStepLabel(stepType: string): string {
  return stepTypeLabels[stepType] || stepType;
}

/** 获取步骤的状态图标 */
function getStepIcon(status: string): string {
  switch (status) {
    case 'completed':
      return 'check_circle';
    case 'failed':
      return 'error';
    case 'started':
      return 'hourglass_empty';
    default:
      return 'circle';
  }
}

/** 获取步骤的状态颜色 */
function getStepColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-400';
    case 'failed':
      return 'text-red-400';
    case 'started':
      return 'text-amber-400';
    default:
      return 'text-outline';
  }
}

/** 格式化输出信息为可读字符串 */
function formatOutput(output: Record<string, unknown> | undefined): string {
  if (!output) return '';
  const entries = Object.entries(output);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (typeof value === 'object') {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${String(value)}`;
    })
    .join(' | ');
}
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

      <!-- Agent 详情面板 (RAG 模式) -->
      <div
        v-if="isRagMode && (agentSteps.length > 0 || toolCalls.length > 0)"
        class="flex flex-col gap-3"
      >
        <!-- 面板头部：可折叠 -->
        <button
          class="flex items-center justify-between px-4 py-2 bg-surface-container-low rounded-xl border border-outline-variant/10 hover:bg-surface-container-high transition-colors"
          @click="isExpanded = !isExpanded"
        >
          <div class="flex items-center gap-2">
            <span
              :class="['material-symbols-outlined text-base', phaseConfig[agentPhase ?? 'planning']?.color]"
            >
              {{ phaseConfig[agentPhase ?? 'planning']?.icon || 'circle' }}
            </span>
            <span class="text-sm font-medium text-on-surface">
              {{ chatStore.agentPhaseLabel || phaseConfig[agentPhase ?? 'planning']?.label }}
            </span>
            <span
              v-if="chatStore.agentPhaseDetail"
              class="text-xs text-outline"
            >
              — {{ chatStore.agentPhaseDetail }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-outline">
              {{ agentSteps.length }} 个步骤
            </span>
            <span
              :class="[
                'material-symbols-outlined text-base transition-transform',
                isExpanded ? 'rotate-180' : '',
              ]"
            >
              expand_more
            </span>
          </div>
        </button>

        <!-- 展开的内容 -->
        <div
          v-if="isExpanded"
          class="flex flex-col gap-2"
        >
          <!-- 检索进度（如果有） -->
          <div
            v-if="retrievalProgresses.length > 0"
            class="flex flex-col gap-1.5 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
          >
            <div class="text-xs font-label text-outline uppercase tracking-widest">检索进度</div>
            <div class="flex gap-4">
              <div
                v-for="(progress, idx) in retrievalProgresses"
                :key="idx"
                class="flex items-center gap-3"
              >
                <span class="text-xs text-on-surface">Dense: {{ progress.denseCount ?? 0 }}</span>
                <span class="text-xs text-on-surface">Sparse: {{ progress.sparseCount ?? 0 }}</span>
                <span class="text-xs text-primary font-medium">Fused: {{ progress.fusedCount ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- 工具调用记录 -->
          <div
            v-if="toolCalls.length > 0"
            class="flex flex-col gap-1.5 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
          >
            <div class="text-xs font-label text-outline uppercase tracking-widest">工具调用</div>
            <div
              v-for="(tool, idx) in toolCalls"
              :key="idx"
              class="flex items-start gap-2 py-1.5 border-b border-outline-variant/5 last:border-0"
            >
              <span class="material-symbols-outlined text-sm text-blue-400 mt-0.5">build</span>
              <div class="flex-1">
                <div class="text-xs font-medium text-on-surface">{{ tool.toolName }}</div>
                <div
                  v-if="tool.input?.queries"
                  class="text-[10px] text-outline mt-0.5"
                >
                  查询: {{ Array.isArray(tool.input.queries) ? tool.input.queries.join(', ') : tool.input.queries }}
                </div>
                <div
                  v-if="tool.durationMs"
                  class="text-[10px] text-outline mt-0.5"
                >
                  耗时: {{ tool.durationMs }}ms
                </div>
              </div>
              <span
                v-if="tool.output"
                class="text-[10px] text-green-400"
              >
                ✓
              </span>
            </div>
          </div>

          <!-- Agent 执行步骤 -->
          <div
            v-if="agentSteps.length > 0"
            class="flex flex-col gap-1.5 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
          >
            <div class="text-xs font-label text-outline uppercase tracking-widest">执行流程</div>
            <div class="flex flex-col gap-1">
              <div
                v-for="(step, idx) in agentSteps"
                :key="idx"
                class="flex items-center gap-2 py-1.5 border-b border-outline-variant/5 last:border-0"
              >
                <span
                  :class="['material-symbols-outlined text-sm', getStepColor(step.status), getStepIcon(step.status)]"
                >
                  {{ getStepIcon(step.status) }}
                </span>
                <div class="flex-1">
                  <div class="text-xs font-medium text-on-surface">
                    {{ getStepLabel(step.stepType) || step.stepType }}
                  </div>
                  <div
                    v-if="step.output"
                    class="text-[10px] text-outline mt-0.5"
                  >
                    {{ formatOutput(step.output) }}
                  </div>
                </div>
                <span
                  :class="['text-[10px] px-1.5 py-0.5 rounded', step.status === 'completed' ? 'bg-green-400/10 text-green-400' : step.status === 'failed' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400']"
                >
                  {{ step.status }}
                </span>
              </div>
            </div>
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