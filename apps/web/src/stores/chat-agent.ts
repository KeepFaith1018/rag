/**
 * 聊天 Agent Store
 *
 * 管理 Agent 运行时状态：AG-UI 步骤/工具调用/引用/警告/检索进度/阶段。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  AgentPhase,
  Citation,
  AgentWarningPart,
  RetrievalProgressPart,
  AguiStepRecord,
  AguiToolCallRecord,
} from '@/modules/chat/types/stream';

export type { AgentPhase, Citation, AgentWarningPart, RetrievalProgressPart, AguiStepRecord, AguiToolCallRecord };

export const useChatAgentStore = defineStore('chat-agent', () => {
  // ── 状态 ──
  const agentPhase = ref<AgentPhase | null>(null);
  const agentPhaseLabel = ref('');
  const agentPhaseDetail = ref('');
  const citations = ref<Citation[]>([]);
  const highlightedCitationIndex = ref<number | null>(null);
  const agentWarnings = ref<AgentWarningPart[]>([]);
  const retrievalProgresses = ref<RetrievalProgressPart[]>([]);
  const currentRunId = ref<string | null>(null);
  const aguiSteps = ref<AguiStepRecord[]>([]);
  const aguiToolCalls = ref<AguiToolCallRecord[]>([]);
  let timelineOrder = 0;

  // ── 计算 ──
  const hasCitations = computed(() => citations.value.length > 0);
  const hasWarnings = computed(() => agentWarnings.value.length > 0);

  // ── 重置 ──
  function resetAgentState() {
    agentPhase.value = null;
    agentPhaseLabel.value = '';
    agentPhaseDetail.value = '';
    citations.value = [];
    highlightedCitationIndex.value = null;
    agentWarnings.value = [];
    retrievalProgresses.value = [];
    aguiSteps.value = [];
    aguiToolCalls.value = [];
    currentRunId.value = null;
    timelineOrder = 0;
  }

  function setRunStarted(runId: string) {
    currentRunId.value = runId;
  }

  function setRunFinished() {
    agentPhase.value = 'done';
  }

  function setAgentPhase(phase: AgentPhase, label: string, detail: string) {
    agentPhase.value = phase;
    agentPhaseLabel.value = label;
    agentPhaseDetail.value = detail;
  }

  function addRetrievalProgress(progress: RetrievalProgressPart) {
    const idx = retrievalProgresses.value.findIndex(
      (p) => p.type === 'retrieval-progress' && p.denseCount === progress.denseCount && p.sparseCount === progress.sparseCount,
    );
    if (idx >= 0) {
      retrievalProgresses.value[idx] = progress;
    } else {
      retrievalProgresses.value.push(progress);
    }
  }

  function stepLabel(stepName: string): string {
    const map: Record<string, string> = {
      route: '路由分析',
      decompose: '问题拆解',
      rewrite: '查询改写',
      rewrite_fallback: '改写回退',
      relevance_check: '相关性校验',
      audit: '检索审计',
      writer: '生成回答',
    };
    return map[stepName] ?? stepName;
  }

  function stepOutputSummary(stepName: string, output: Record<string, unknown>): string {
    if (stepName === 'writer') return `回答生成完成 → ${output.answerLength ?? 0} 字`;
    if (stepName === 'rewrite') return `改写完成 → ${(output.queries as unknown[] | undefined)?.length ?? 0} 条查询`;
    if (stepName === 'audit') return `评估: ${output.verdict ?? 'unknown'}`;
    if (stepName === 'route') return `意图: ${output.intent ?? 'unknown'}`;
    if (stepName === 'fact_check') {
      if (output.skipped) return '已跳过';
      return output.itemCount != null ? `审核 ${output.itemCount} 条` : '';
    }
    if (stepName === 'completeness_check') {
      if (output.skipped) return '已跳过';
      const cov = output.coverage as number | undefined;
      return cov != null ? `覆盖率: ${Math.round(cov * 100)}%` : '';
    }
    return '';
  }

  function upsertStep(step: AguiStepRecord) {
    const existing = aguiSteps.value.find((s) => s.stepName === step.stepName);
    if (existing) {
      Object.assign(existing, step);
    } else {
      aguiSteps.value.push({ ...step, order: ++timelineOrder });
    }
    const phaseMap: Record<string, AgentPhase> = {
      route: 'planning',
      rewrite: 'planning',
      audit: 'verifying',
      writer: 'writing',
    };
    const phase = phaseMap[step.stepName] ?? null;
    if (phase && step.status === 'running') {
      setAgentPhase(phase, stepLabel(step.stepName), '');
    }
    if (step.status === 'completed' && step.output) {
      agentPhaseDetail.value = stepOutputSummary(step.stepName, step.output);
    }
  }

  function upsertToolCall(tc: AguiToolCallRecord) {
    const existing = aguiToolCalls.value.find((t) => t.toolCallId === tc.toolCallId);
    if (existing) {
      Object.assign(existing, tc);
    } else {
      aguiToolCalls.value.push({ ...tc, order: ++timelineOrder });
    }
    if (tc.toolCallName === 'search_knowledge_base' && tc.output) {
      addRetrievalProgress({
        type: 'retrieval-progress',
        denseCount: tc.output.denseCount as number | undefined,
        sparseCount: tc.output.sparseCount as number | undefined,
        fusedCount: tc.output.hitCount as number | undefined,
      });
    }
  }

  function addCitation(citation: Citation) {
    citations.value.push(citation);
  }

  function setCitations(citationsList: Citation[]) {
    citations.value = citationsList;
  }

  function appendCitations(newDocs: Citation[]) {
    const existingChunkIds = new Set(citations.value.map((c) => c.chunkId));
    const unique = newDocs.filter((d) => !existingChunkIds.has(d.chunkId));
    citations.value = [...citations.value, ...unique].map((c, i) => ({
      ...c,
      index: i + 1,
    }));
  }

  return {
    // state
    agentPhase,
    agentPhaseLabel,
    agentPhaseDetail,
    citations,
    highlightedCitationIndex,
    agentWarnings,
    retrievalProgresses,
    currentRunId,
    aguiSteps,
    aguiToolCalls,
    // computed
    hasCitations,
    hasWarnings,
    // actions
    resetAgentState,
    setRunStarted,
    setRunFinished,
    setAgentPhase,
    addRetrievalProgress,
    upsertStep,
    upsertToolCall,
    addCitation,
    setCitations,
    appendCitations,
    stepLabel,
    stepOutputSummary,
  };
});
