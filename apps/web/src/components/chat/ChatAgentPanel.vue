<script setup lang="ts">
/**
 * Agent 步骤面板 — 独立组件，与消息内容渲染周期隔离。
 *
 * 父组件 AIMessageItem 因 msg.blocks 替换而高频重渲染（40次/秒）。
 * 将此面板抽离为独立组件，Vue 的 props 浅比较会跳过无变化的子树。
 */
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import type { AguiStepRecord, AguiToolCallRecord, TimelineEntry } from '@/modules/chat/types/stream'

const props = defineProps<{
  messageSteps?: AguiStepRecord[]
  messageToolCalls?: AguiToolCallRecord[]
  isStreaming: boolean
}>()

const chatStore = useChatStore()
const stepsExpanded = ref(true)
const expandedTools = ref<Set<string>>(new Set())

function toggleToolQueries(toolCallId: string) {
  if (expandedTools.value.has(toolCallId)) {
    expandedTools.value.delete(toolCallId)
  } else {
    expandedTools.value.add(toolCallId)
  }
}

const displaySteps = computed<AguiStepRecord[]>(() =>
  props.messageSteps?.length
    ? props.messageSteps
    : props.isStreaming ? chatStore.aguiSteps : [],
)

const displayToolCalls = computed<AguiToolCallRecord[]>(() =>
  props.messageToolCalls?.length
    ? props.messageToolCalls
    : props.isStreaming ? chatStore.aguiToolCalls : [],
)

const hasAgentData = computed(() =>
  displaySteps.value.length > 0 || displayToolCalls.value.length > 0,
)

const timeline = computed<TimelineEntry[]>(() => {
  const entries: TimelineEntry[] = [
    ...displaySteps.value.map(s => ({ kind: 'step' as const, step: s, order: s.order ?? 0 })),
    ...displayToolCalls.value.map(t => ({ kind: 'tool' as const, tool: t, order: t.order ?? 0 })),
  ]
  entries.sort((a, b) => a.order - b.order)
  return entries
})

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

const toolMeta = (toolName: string): { icon: string; label: string } => {
  const map: Record<string, { icon: string; label: string }> = {
    search_knowledge_base: { icon: 'search', label: '知识库检索' },
    web_search: { icon: 'language', label: '联网搜索' },
  }
  return map[toolName] ?? { icon: 'build', label: toolName }
}

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

function stepOutputSummary(step: AguiStepRecord): string {
  if (!step.output) return ''
  if (step.stepName === 'route') return `意图: ${step.output.intent ?? 'unknown'}`
  if (step.stepName === 'rewrite') {
    const queries = step.output.queries as string[] | undefined
    return `改写完成 → ${queries?.length ?? 0} 条查询`
  }
  if (step.stepName === 'audit') {
    const verdict = step.output.verdict as string | undefined
    const label = verdict === 'sufficient' ? '检索充分' : verdict === 'insufficient' ? '检索不足' : (verdict ?? 'unknown')
    return `评估: ${label}`
  }
  if (step.stepName === 'writer') return `回答生成完成 → ${step.output.answerLength ?? 0} 字`
  if (step.stepName === 'fact_check') {
    if (step.output?.skipped) return '已跳过'
    const risk = step.output?.overallRisk as string | undefined
    if (risk === 'low') return '风险: 低'
    if (risk === 'medium') return '风险: 中'
    if (risk === 'high') return '风险: 高'
    return step.output?.itemCount != null ? `审核 ${step.output.itemCount} 条` : ''
  }
  if (step.stepName === 'completeness_check') {
    if (step.output?.skipped) return '已跳过'
    const cov = step.output?.coverage as number | undefined
    return cov != null ? `覆盖率: ${Math.round(cov * 100)}%` : ''
  }
  return ''
}

function isAuditInsufficient(step: AguiStepRecord): boolean {
  return step.stepName === 'audit' && step.status === 'completed' && step.output?.verdict === 'insufficient'
}

const stepStatusColor = (step: AguiStepRecord) =>
  isAuditInsufficient(step) ? 'text-amber-400'
    : step.status === 'completed' ? 'text-green-400'
    : step.status === 'running' ? 'text-amber-400'
    : 'text-outline'

const toolStatusColor = (status: string) =>
  status === 'completed' ? 'text-green-400' : 'text-amber-400'
</script>

<template>
  <div
    v-if="hasAgentData"
    class="mb-3 rounded-xl border border-outline-variant/10 bg-surface-container-low overflow-hidden"
  >
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
        <span class="text-xs text-outline">{{ props.isStreaming ? '进行中' : '已完成' }}</span>
        <span :class="['material-symbols-outlined text-base text-outline transition-transform', stepsExpanded ? 'rotate-180' : '']">expand_more</span>
      </div>
    </button>

    <div v-if="stepsExpanded" class="px-4 pb-3 space-y-2">
      <div class="flex flex-col gap-1.5">
        <template v-for="entry in timeline" :key="entry.kind === 'step' ? `step-${entry.step!.stepName}` : `tool-${entry.tool!.toolCallId}`">
          <div v-if="entry.kind === 'step' && entry.step" class="step-item flex items-start gap-2 py-2 border-b border-outline-variant/5 last:border-0">
            <span v-if="entry.step.status === 'running'" class="inline-block w-2 h-2 rounded-full bg-amber-400 mt-1.5 animate-pulse flex-shrink-0" />
            <span v-else :class="['material-symbols-outlined text-sm mt-0.5 flex-shrink-0', stepStatusColor(entry.step)]">
              {{ isAuditInsufficient(entry.step) ? 'warning' : entry.step.status === 'completed' ? 'check_circle' : 'circle' }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-sm text-outline">{{ stepMeta(entry.step.stepName).icon }}</span>
                <span class="text-xs font-medium text-on-surface">{{ stepMeta(entry.step.stepName).label }}</span>
                <span :class="['text-[10px] px-1 rounded', isAuditInsufficient(entry.step) ? 'bg-amber-400/10 text-amber-400' : entry.step.status === 'completed' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400']">
                  {{ isAuditInsufficient(entry.step) ? '不足' : entry.step.status === 'running' ? '进行中' : '完成' }}
                </span>
              </div>
              <div v-if="stepOutputSummary(entry.step)" class="text-[10px] text-outline mt-0.5 truncate">{{ stepOutputSummary(entry.step) }}</div>
            </div>
            <span v-if="entry.step.durationMs" class="text-[10px] text-outline/50 flex-shrink-0 mt-0.5">{{ entry.step.durationMs }}ms</span>
          </div>

          <div v-if="entry.kind === 'tool' && entry.tool" class="step-item ml-4 pl-3 py-2 border-l-2 border-outline-variant/20 rounded">
            <div class="flex items-start gap-2">
              <span v-if="entry.tool.status === 'running'" class="inline-block w-2 h-2 rounded-full bg-amber-400 mt-1.5 animate-pulse flex-shrink-0" />
              <span v-else :class="['material-symbols-outlined text-sm mt-0.5 flex-shrink-0', toolStatusColor(entry.tool.status)]">
                {{ entry.tool.status === 'completed' ? 'check_circle' : 'build' }}
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-sm text-outline">{{ toolMeta(entry.tool.toolCallName).icon }}</span>
                  <span class="text-xs font-medium text-on-surface">{{ toolMeta(entry.tool.toolCallName).label }}</span>
                  <span :class="['text-[10px] px-1 rounded', entry.tool.status === 'completed' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400']"> {{ entry.tool.status === 'running' ? '调用中' : '完成' }} </span>
                </div>
                <div v-if="entry.tool.input && entry.tool.toolCallName === 'search_knowledge_base'" class="text-[10px] text-outline mt-0.5">
                  <template v-if="(entry.tool.input.queries as string[])?.length">
                    <span v-if="!expandedTools.has(entry.tool.toolCallId)" class="cursor-pointer hover:text-on-surface transition-colors" @click="toggleToolQueries(entry.tool.toolCallId)">{{ (entry.tool.input.queries as string[]).length }} 条查询 ▸</span>
                    <span v-else class="cursor-pointer hover:text-on-surface transition-colors" @click="toggleToolQueries(entry.tool.toolCallId)">{{ (entry.tool.input.queries as string[]).join('；') }} ▾</span>
                  </template>
                </div>
                <div v-if="toolOutputSummary(entry.tool)" class="text-[10px] text-primary mt-0.5">{{ toolOutputSummary(entry.tool) }}</div>
              </div>
              <span v-if="entry.tool.durationMs" class="text-[10px] text-outline/50 flex-shrink-0 mt-0.5">{{ entry.tool.durationMs }}ms</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-item {
  animation: stepIn 0.3s ease both;
}
.step-item:nth-child(1) { animation-delay: 0s; }
.step-item:nth-child(2) { animation-delay: 0.04s; }
.step-item:nth-child(3) { animation-delay: 0.08s; }
.step-item:nth-child(4) { animation-delay: 0.12s; }
.step-item:nth-child(5) { animation-delay: 0.16s; }
.step-item:nth-child(6) { animation-delay: 0.20s; }
.step-item:nth-child(7) { animation-delay: 0.24s; }
.step-item:nth-child(8) { animation-delay: 0.28s; }
.step-item:nth-child(9) { animation-delay: 0.32s; }
.step-item:nth-child(10) { animation-delay: 0.36s; }

@keyframes stepIn {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
