<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessageItem } from '@/modules/chat/types/chat'
import type { AguiStepRecord, AguiToolCallRecord, TimelineEntry } from '@/modules/chat/types/stream'
import { useChatStore } from '@/stores/chat'
import { useMessage } from '@/composables/useMessage'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'

const props = defineProps<{
  message: ChatMessageItem
}>()

const emit = defineEmits<{
  retry: []
}>()

const chatStore = useChatStore()
const messageToast = useMessage()
const copied = ref(false)
const stepsExpanded = ref(true)

const isStreaming = computed(() => props.message.messageStatus === 'streaming')
const isError = computed(() => props.message.messageStatus === 'error')
const isAborted = computed(() => props.message.messageStatus === 'aborted')
const isRagMode = computed(() => props.message.chatMode === 'rag')

const hasContent = computed(() =>
  props.message.htmlContent || props.message.content,
)

/** 优先使用消息自身的步骤数据（历史消息），流式中 fallback store */
const displaySteps = computed<AguiStepRecord[]>(() =>
  props.message.aguiSteps?.length
    ? props.message.aguiSteps
    : isStreaming.value ? chatStore.aguiSteps : [],
)

const displayToolCalls = computed<AguiToolCallRecord[]>(() =>
  props.message.aguiToolCalls?.length
    ? props.message.aguiToolCalls
    : isStreaming.value ? chatStore.aguiToolCalls : [],
)

const hasAgentData = computed(() =>
  isRagMode.value && (displaySteps.value.length > 0 || displayToolCalls.value.length > 0),
)

/** 合并步骤和工具为统一时间线，按到达顺序排列 */
const timeline = computed<TimelineEntry[]>(() => {
  const entries: TimelineEntry[] = [
    ...displaySteps.value.map(s => ({ kind: 'step' as const, step: s, order: s.order ?? 0 })),
    ...displayToolCalls.value.map(t => ({ kind: 'tool' as const, tool: t, order: t.order ?? 0 })),
  ]
  entries.sort((a, b) => a.order - b.order)
  return entries
})

/** 步骤图标和标签映射 */
const stepMeta = (stepName: string): { icon: string; label: string } => {
  const map: Record<string, { icon: string; label: string }> = {
    route: { icon: 'psychology', label: '路由分析' },
    decompose: { icon: 'account_tree', label: '问题拆解' },
    rewrite: { icon: 'edit', label: '查询改写' },
    rewrite_fallback: { icon: 'replay', label: '改写回退' },
    relevance_check: { icon: 'preview', label: '相关性校验' },
    audit: { icon: 'grading', label: '检索审计' },
    writer: { icon: 'edit_note', label: '生成回答' },
    writer_correct: { icon: 'edit_note', label: '修正回答' },
    writer_supplement: { icon: 'note_add', label: '补充回答' },
    fact_check: { icon: 'fact_check', label: '事实审核' },
    completeness_check: { icon: 'checklist', label: '完整性校验' },
    supplement_retrieve: { icon: 'search', label: '补充检索' },
  }
  return map[stepName] ?? { icon: 'circle', label: stepName }
}

/** 工具图标和标签映射 */
const toolMeta = (toolName: string): { icon: string; label: string } => {
  const map: Record<string, { icon: string; label: string }> = {
    search_knowledge_base: { icon: 'search', label: '知识库检索' },
    web_search: { icon: 'language', label: '联网搜索' },
  }
  return map[toolName] ?? { icon: 'build', label: toolName }
}

/** 工具输出摘要 */
function toolOutputSummary(tc: AguiToolCallRecord): string {
  if (!tc.output) return ''
  if (tc.toolCallName === 'search_knowledge_base') {
    return `检索到 ${tc.output.hitCount ?? 0} 条结果` + (tc.durationMs ? ` (${tc.durationMs}ms)` : '')
  }
  if (tc.toolCallName === 'web_search') {
    return `${tc.output.resultCount ?? 0} 条结果` + (tc.durationMs ? ` (${tc.durationMs}ms)` : '')
  }
  return ''
}

/** 步骤输出摘要 */
function stepOutputSummary(step: AguiStepRecord): string {
  if (!step.output) return ''
  if (step.stepName === 'route') {
    return `意图: ${step.output.intent ?? 'unknown'}`
  }
  if (step.stepName === 'rewrite') {
    const queries = step.output.queries as string[] | undefined
    return `改写完成 → ${queries?.length ?? 0} 条查询`
  }
  if (step.stepName === 'audit') {
    const verdict = step.output.verdict as string | undefined
    const label = verdict === 'sufficient' ? '检索充分' : verdict === 'insufficient' ? '检索不足' : (verdict ?? 'unknown')
    return `评估: ${label}`
  }
  if (step.stepName === 'writer') {
    return `回答生成完成 → ${step.output.answerLength ?? 0} 字`
  }
  return ''
}

/** 审计是否判定为不足 */
function isAuditInsufficient(step: AguiStepRecord): boolean {
  return step.stepName === 'audit' && step.status === 'completed' && step.output?.verdict === 'insufficient'
}

/** 状态颜色 */
const stepStatusColor = (step: AguiStepRecord) =>
  isAuditInsufficient(step) ? 'text-amber-400'
    : step.status === 'completed' ? 'text-green-400'
    : step.status === 'running' ? 'text-amber-400'
    : 'text-outline'

const toolStatusColor = (status: string) =>
  status === 'completed' ? 'text-green-400' : 'text-amber-400'

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.message.content || '')
    copied.value = true
    messageToast.success('已复制')
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    messageToast.error('复制失败')
  }
}

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <div class="px-6 py-2">
    <div class="max-w-3xl">
      <!-- 流式等待：还没有文字，显示阶段状态 -->
      <div
        v-if="!hasContent && isStreaming && isRagMode"
        class="flex items-center gap-2 py-2"
      >
        <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
        <span class="text-xs text-outline">
          {{ chatStore.agentPhaseLabel || '正在思考...' }}
          <span v-if="chatStore.agentPhaseDetail" class="ml-2 text-outline/60">— {{ chatStore.agentPhaseDetail }}</span>
        </span>
      </div>

      <!-- 普通模式等待 -->
      <div
        v-else-if="!hasContent && isStreaming"
        class="flex items-center gap-2 py-2"
      >
        <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
        <span class="text-xs text-outline">思考中...</span>
      </div>

      <!-- Agent 步骤面板 -->
      <div
        v-if="hasAgentData"
        class="mb-3 rounded-xl border border-outline-variant/10 bg-surface-container-low overflow-hidden"
      >
        <!-- 面板头部：可折叠 -->
        <button
          class="flex items-center justify-between w-full px-4 py-2.5 hover:bg-surface-container-high transition-colors"
          @click="stepsExpanded = !stepsExpanded"
        >
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-base text-primary">account_tree</span>
            <span class="text-sm font-medium text-on-surface">思考过程</span>
            <span class="text-xs text-outline">
              {{ displaySteps.length }} 个步骤{{ displayToolCalls.length > 0 ? ` + ${displayToolCalls.length} 个工具` : '' }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-outline">
              {{ isStreaming ? '进行中' : '已完成' }}
            </span>
            <span
              :class="['material-symbols-outlined text-base text-outline transition-transform', stepsExpanded ? 'rotate-180' : '']"
            >
              expand_more
            </span>
          </div>
        </button>

        <!-- 展开内容 -->
        <div v-if="stepsExpanded" class="px-4 pb-3 space-y-2">
          <!-- 统一时间线（步骤 + 工具按到达顺序排列） -->
          <div class="flex flex-col gap-1.5">
            <template v-for="(entry, idx) in timeline" :key="idx">
              <!-- 步骤 -->
              <div
                v-if="entry.kind === 'step' && entry.step"
                class="flex items-start gap-2 py-1.5 border-b border-outline-variant/5 last:border-0"
              >
                <span
                  v-if="entry.step.status === 'running'"
                  class="inline-block w-2 h-2 rounded-full bg-amber-400 mt-1.5 animate-pulse flex-shrink-0"
                />
                <span
                  v-else
                  :class="['material-symbols-outlined text-sm mt-0.5 flex-shrink-0', stepStatusColor(entry.step)]"
                >
                  {{ isAuditInsufficient(entry.step) ? 'warning' : entry.step.status === 'completed' ? 'check_circle' : 'circle' }}
                </span>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm text-outline">{{ stepMeta(entry.step.stepName).icon }}</span>
                    <span class="text-xs font-medium text-on-surface">{{ stepMeta(entry.step.stepName).label }}</span>
                    <span
                      :class="['text-[10px] px-1 rounded', isAuditInsufficient(entry.step) ? 'bg-amber-400/10 text-amber-400' : entry.step.status === 'completed' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400']"
                    >
                      {{ isAuditInsufficient(entry.step) ? '不足' : entry.step.status === 'running' ? '进行中' : '完成' }}
                    </span>
                  </div>
                  <div
                    v-if="stepOutputSummary(entry.step)"
                    class="text-[10px] text-outline mt-0.5 truncate"
                  >
                    {{ stepOutputSummary(entry.step) }}
                  </div>
                </div>

                <span v-if="entry.step.durationMs" class="text-[10px] text-outline/50 flex-shrink-0 mt-0.5">
                  {{ entry.step.durationMs }}ms
                </span>
              </div>

              <!-- 工具调用 -->
              <div
                v-if="entry.kind === 'tool' && entry.tool"
                class="ml-4 pl-3 py-1.5 border-l-2 border-outline-variant/20 rounded"
              >
                <div class="flex items-start gap-2">
                  <span
                    v-if="entry.tool.status === 'running'"
                    class="inline-block w-2 h-2 rounded-full bg-amber-400 mt-1.5 animate-pulse flex-shrink-0"
                  />
                  <span
                    v-else
                    :class="['material-symbols-outlined text-sm mt-0.5 flex-shrink-0', toolStatusColor(entry.tool.status)]"
                  >
                    {{ entry.tool.status === 'completed' ? 'check_circle' : 'build' }}
                  </span>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-sm text-outline">{{ toolMeta(entry.tool.toolCallName).icon }}</span>
                      <span class="text-xs font-medium text-on-surface">{{ toolMeta(entry.tool.toolCallName).label }}</span>
                      <span
                        :class="['text-[10px] px-1 rounded', entry.tool.status === 'completed' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400']"
                      >
                        {{ entry.tool.status === 'running' ? '调用中' : '完成' }}
                      </span>
                    </div>
                    <div
                      v-if="entry.tool.input && entry.tool.toolCallName === 'search_knowledge_base'"
                      class="text-[10px] text-outline mt-0.5 truncate"
                    >
                      查询: {{ (entry.tool.input.queries as string[] | undefined)?.join(', ') ?? '' }}
                    </div>
                    <div
                      v-if="toolOutputSummary(entry.tool)"
                      class="text-[10px] text-primary mt-0.5"
                    >
                      {{ toolOutputSummary(entry.tool) }}
                    </div>
                  </div>

                  <span v-if="entry.tool.durationMs" class="text-[10px] text-outline/50 flex-shrink-0 mt-0.5">
                    {{ entry.tool.durationMs }}ms
                  </span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Markdown 内容 (Incremark AST blocks) -->
      <MarkdownRenderer
        v-if="hasContent && message.blocks?.length"
        :blocks="message.blocks"
      />
      <!-- 兼容旧消息（无 blocks 的历史数据） -->
      <div
        v-else-if="hasContent"
        class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed"
        v-html="message.htmlContent || message.content"
      />

      <!-- 已取消 -->
      <div v-if="isAborted" class="text-xs text-error mt-2">请求已取消</div>

      <!-- 错误 -->
      <div v-if="isError" class="text-xs text-error mt-2">生成失败，请重试</div>

      <!-- 完成后的脚注 -->
      <div
        v-if="!isStreaming && hasContent && isRagMode && chatStore.citations.length > 0"
        class="flex items-center gap-2 mt-2 text-xs text-outline/50"
      >
        <span class="material-symbols-outlined text-[14px]">menu_book</span>
        <span>参考 {{ chatStore.citations.length }} 条知识库内容</span>
      </div>

      <!-- 底部操作栏 -->
      <div
        v-if="!isStreaming"
        class="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-outline-variant/10"
      >
        <button
          v-if="hasContent"
          class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-low rounded transition-colors"
          @click="handleCopy"
        >
          <span class="material-symbols-outlined text-xs">{{ copied ? 'check' : 'content_copy' }}</span>
          {{ copied ? '已复制' : '复制' }}
        </button>

        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-low rounded transition-colors"
          @click="handleRetry"
        >
          <span class="material-symbols-outlined text-xs">refresh</span>
          重试
        </button>
      </div>
    </div>
  </div>
</template>
