/**
 * 聊天模块 Pinia Store
 *
 * 管理会话列表、当前会话、消息历史、Agent 状态等。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  listChatMessages,
  renameChatSession,
  deleteChatSession,
} from '@/api/chat';
import type {
  ChatSessionSummary,
  ChatMessageItem,
  ChatMode,
  KbOption,
  ModelOption,
} from '@/modules/chat/types/chat';
import type {
  AgentPhase,
  Citation,
  AgentWarningPart,
  RetrievalProgressPart,
  AguiStepRecord,
  AguiToolCallRecord,
} from '@/modules/chat/types/stream';

export const useChatStore = defineStore('chat', () => {
  // ─── 状态 ────────────────────────────────────────────────

  /** 会话列表 */
  const sessions = ref<ChatSessionSummary[]>([]);

  /** 当前会话 */
  const currentSession = ref<ChatSessionSummary | null>(null);

  /** 消息列表 */
  const messages = ref<ChatMessageItem[]>([]);

  /** 加载状态 */
  const isLoadingSessions = ref(false);
  const isLoadingMessages = ref(false);
  const isSending = ref(false);

  /** 分页状态 */
  const sessionsPage = ref(1);
  const sessionsPageSize = ref(20);
  const sessionsTotal = ref(0);
  const hasMoreSessions = computed(() => sessions.value.length < sessionsTotal.value);

  /** 当前输入模式 */
  const chatMode = ref<ChatMode>('chat');

  /** 当前选中的知识库 ID 列表 */
  const selectedKbIds = ref<string[]>([]);

  /** 可选知识库列表 */
  const availableKbs = ref<KbOption[]>([]);

  /** 当前选中的模型 */
  const selectedModel = ref<ModelOption | null>(null);

  /** 可选模型列表 */
  const availableModels = ref<ModelOption[]>([]);

  // ─── Agent 状态 ───────────────────────────────────────────

  /** 当前 Agent 阶段 */
  const agentPhase = ref<AgentPhase | null>(null);

  /** 当前阶段标签 */
  const agentPhaseLabel = ref('');

  /** 当前阶段详情 */
  const agentPhaseDetail = ref('');

  /** 引用列表 */
  const citations = ref<Citation[]>([]);

  /** 警告信息 */
  const agentWarnings = ref<AgentWarningPart[]>([]);

  /** 检索进度列表 */
  const retrievalProgresses = ref<RetrievalProgressPart[]>([]);

  /** 当前 run ID */
  const currentRunId = ref<string | null>(null);

  /** AG-UI 步骤记录 */
  const aguiSteps = ref<AguiStepRecord[]>([]);

  /** AG-UI 工具调用记录 */
  const aguiToolCalls = ref<AguiToolCallRecord[]>([]);

  /** 时间线时序计数器，确保步骤和工具按到达顺序排列 */
  let timelineOrder = 0;

  /** 最后一条用户消息内容（用于重试） */
  const lastUserMessage = ref('');

  /** 本次提问是否开启联网搜索 */
  const enableWebSearch = ref(false);

  // ─── 计算属性 ─────────────────────────────────────────────

  const hasActiveSession = computed(() => currentSession.value !== null);

  const isRagMode = computed(() => chatMode.value === 'rag');

  const selectedKbCount = computed(() => selectedKbIds.value.length);

  const hasCitations = computed(() => citations.value.length > 0);

  const hasWarnings = computed(() => agentWarnings.value.length > 0);

  /**
   * 知识库级联选项（用于级联选择器）
   * 按 私人 / 共享(我创建+我加入) / 公开 组织
   */
  const kbCascaderOptions = computed(() => {
    const privateKbs = availableKbs.value.filter(
      (kb) => kb.visibility === 'private',
    );
    const sharedOwned = availableKbs.value.filter(
      (kb) => kb.visibility === 'shared' && kb.permission === 'owner',
    );
    const sharedJoined = availableKbs.value.filter(
      (kb) =>
        kb.visibility === 'shared' &&
        kb.permission !== 'owner' &&
        kb.permission !== 'publicVisitor',
    );
    const publicKbs = availableKbs.value.filter(
      (kb) => kb.permission === 'publicVisitor',
    );

    const groups = [];

    if (privateKbs.length > 0) {
      groups.push({
        label: '私人',
        value: 'private',
        children: privateKbs.map((kb) => ({
          label: kb.kbName,
          value: kb.kbId,
          permission: kb.permission,
        })),
      });
    }

    if (sharedOwned.length > 0 || sharedJoined.length > 0) {
      const sharedChildren = [];
      if (sharedOwned.length > 0) {
        sharedChildren.push({
          label: '我创建',
          value: 'shared-owned',
          children: sharedOwned.map((kb) => ({
            label: kb.kbName,
            value: kb.kbId,
            permission: kb.permission,
          })),
        });
      }
      if (sharedJoined.length > 0) {
        sharedChildren.push({
          label: '我加入',
          value: 'shared-joined',
          children: sharedJoined.map((kb) => ({
            label: kb.kbName,
            value: kb.kbId,
            permission: kb.permission,
          })),
        });
      }
      groups.push({
        label: '共享',
        value: 'shared',
        children: sharedChildren,
      });
    }

    if (publicKbs.length > 0) {
      groups.push({
        label: '公开',
        value: 'public',
        disabled: true,
        children: publicKbs.map((kb) => ({
          label: kb.kbName,
          value: kb.kbId,
          permission: kb.permission,
        })),
      });
    }

    return groups;
  });

  // ─── 会话操作 ─────────────────────────────────────────────

  /**
   * 加载会话列表（首页）。
   * 调用此方法会重置会话列表。
   */
  async function loadSessions() {
    isLoadingSessions.value = true;
    sessionsPage.value = 1;
    sessions.value = [];
    try {
      const response = await listChatSessions({
        page: sessionsPage.value,
        pageSize: sessionsPageSize.value,
      });
      if ('list' in response) {
        sessions.value = response.list;
        sessionsTotal.value = response.total;
      } else {
        sessions.value = [];
        sessionsTotal.value = 0;
      }
    } finally {
      isLoadingSessions.value = false;
    }
  }

  /**
   * 加载更多会话（下一页）。
   * 用于无限滚动场景。
   */
  async function loadMoreSessions() {
    if (isLoadingSessions.value || !hasMoreSessions.value) return;
    isLoadingSessions.value = true;
    try {
      sessionsPage.value += 1;
      const response = await listChatSessions({
        page: sessionsPage.value,
        pageSize: sessionsPageSize.value,
      });
      if ('list' in response) {
        sessions.value.push(...response.list);
        sessionsTotal.value = response.total;
      }
    } finally {
      isLoadingSessions.value = false;
    }
  }

  /**
   * 创建新会话。
   */
  async function createSession(title?: string) {
    const session = await createChatSession({ title });
    sessions.value.unshift(session);
    currentSession.value = session;
    messages.value = [];
    return session;
  }

  /**
   * 选择会话并加载消息。
   */
  async function selectSession(sessionId: string) {
    isLoadingMessages.value = true;
    try {
      currentSession.value = await getChatSession(sessionId);
      const response = await listChatMessages(sessionId);
      messages.value = 'list' in response ? response.list : response;
      // 恢复上一轮的模式和知识库选择
      if (currentSession.value.lastChatMode) {
        chatMode.value = currentSession.value.lastChatMode;
      }
      if (currentSession.value.lastSelectedKbIds) {
        selectedKbIds.value = currentSession.value.lastSelectedKbIds;
      }
    } finally {
      isLoadingMessages.value = false;
    }
  }

  /**
   * 重命名会话。
   */
  async function renameSession(sessionId: string, title: string) {
    await renameChatSession(sessionId, title);
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
    }
    if (currentSession.value?.id === sessionId) {
      currentSession.value.title = title;
    }
  }

  /**
   * 删除会话。
   */
  async function removeSession(sessionId: string) {
    await deleteChatSession(sessionId);
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    if (currentSession.value?.id === sessionId) {
      currentSession.value = null;
      messages.value = [];
    }
  }

  /**
   * 添加用户消息到列表（乐观更新）。
   */
  function addUserMessage(message: ChatMessageItem) {
    messages.value.push(message);
  }

  /**
   * 添加助手消息到列表（乐观更新）。
   */
  function addAssistantMessage(message: ChatMessageItem) {
    messages.value.push(message);
  }

  /**
   * 更新助手消息内容（流式过程中逐步更新）。
   */
  function updateAssistantMessage(messageId: number, content: string) {
    const msg = messages.value.find((m) => m.id === messageId);
    if (msg) {
      msg.content = content;
    }
  }

  /**
   * 更新助手消息 HTML 内容（流式渲染，追加模式）。
   * @param messageId 消息 ID
   * @param html 增量 HTML 片段
   * @param mode 追加或替换
   */
  function updateAssistantMessageHtml(
    messageId: number,
    html: string,
    mode: 'append' | 'replace' = 'append',
  ) {
    const msg = messages.value.find((m) => m.id === messageId);
    if (msg) {
      if (mode === 'append') {
        msg.htmlContent = (msg.htmlContent || '') + html;
      } else {
        msg.htmlContent = html;
      }
      // content 保持同步用于纯文本场景
      msg.content = msg.htmlContent;
    }
  }

  /**
   * 设置助手消息状态。
   */
  function setMessageStatus(
    messageId: number,
    status: ChatMessageItem['messageStatus'],
  ) {
    const msg = messages.value.find((m) => m.id === messageId);
    if (msg) {
      msg.messageStatus = status;
    }
  }

  /**
   * 添加检索进度。
   */
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

  /**
   * 设置 run 开始。
   */
  function setRunStarted(runId: string) {
    currentRunId.value = runId;
  }

  /**
   * 设置 run 完成。
   */
  function setRunFinished() {
    agentPhase.value = 'done';
  }

  /**
   * 插入或更新 AG-UI 步骤记录。
   * STEP_STARTED 创建 running 状态，STEP_FINISHED 更新为 completed。
   */
  function upsertStep(step: AguiStepRecord) {
    const existing = aguiSteps.value.find((s) => s.stepName === step.stepName);
    if (existing) {
      Object.assign(existing, step);
    } else {
      aguiSteps.value.push({ ...step, order: ++timelineOrder });
    }
    // 同步更新旧 agentPhase 以兼容 ChatAgentTimeline
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

  /**
   * 插入或更新 AG-UI 工具调用记录。
   * TOOL_CALL_START 创建 running 状态，TOOL_CALL_RESULT 更新为 completed。
   */
  function upsertToolCall(tc: AguiToolCallRecord) {
    const existing = aguiToolCalls.value.find((t) => t.toolCallId === tc.toolCallId);
    if (existing) {
      Object.assign(existing, tc);
    } else {
      aguiToolCalls.value.push({ ...tc, order: ++timelineOrder });
    }
    // 同步检索进度用于状态展示
    if (tc.toolCallName === 'search_knowledge_base' && tc.output) {
      addRetrievalProgress({
        type: 'retrieval-progress',
        denseCount: tc.output.denseCount as number | undefined,
        sparseCount: tc.output.sparseCount as number | undefined,
        fusedCount: tc.output.hitCount as number | undefined,
      });
    }
  }

  // ─── 模式切换 ─────────────────────────────────────────────

  /**
   * 切换聊天模式。
   */
  function setChatMode(mode: ChatMode) {
    chatMode.value = mode;
    if (mode === 'chat') {
      selectedKbIds.value = [];
    }
  }

  /**
   * 设置选中的知识库。
   */
  function setSelectedKbIds(kbIds: string[]) {
    selectedKbIds.value = kbIds;
  }

  /**
   * 切换知识库选中状态。
   */
  function toggleKb(kbId: string) {
    const index = selectedKbIds.value.indexOf(kbId);
    if (index === -1) {
      selectedKbIds.value.push(kbId);
    } else {
      selectedKbIds.value.splice(index, 1);
    }
  }

  /**
   * 切换联网搜索开关。
   */
  function toggleWebSearch() {
    enableWebSearch.value = !enableWebSearch.value;
  }

  function setWebSearch(enabled: boolean) {
    enableWebSearch.value = enabled;
  }

  // ─── 模型选择 ─────────────────────────────────────────────

  /**
   * 设置当前选中的模型。
   */
  function setSelectedModel(model: ModelOption | null) {
    selectedModel.value = model;
  }

  /**
   * 设置可选知识库列表。
   */
  function setAvailableKbs(kbs: KbOption[]) {
    availableKbs.value = kbs;
  }

  /**
   * 设置可选模型列表。
   */
  function setAvailableModels(models: ModelOption[]) {
    availableModels.value = models;
    // 默认选中系统模型
    const systemModel = models.find((m) => m.source === 'system');
    if (systemModel && !selectedModel.value) {
      selectedModel.value = systemModel;
    }
  }

  // ─── Agent 状态更新 ────────────────────────────────────────

  /**
   * 更新 Agent 阶段状态。
   */
  function setAgentPhase(
    phase: AgentPhase | null,
    label = '',
    detail = '',
  ) {
    agentPhase.value = phase;
    agentPhaseLabel.value = label;
    agentPhaseDetail.value = detail;
  }

  /**
   * 添加引用。
   */
  function setCitations(newCitations: Citation[]) {
    citations.value = newCitations;
  }

  /**
   * 添加警告。
   */
  function addWarning(warning: AgentWarningPart) {
    agentWarnings.value.push(warning);
  }

  /**
   * 清除警告。
   */
  function clearWarnings() {
    agentWarnings.value = [];
  }

  /** 步骤名中文映射 */
  function stepLabel(stepName: string): string {
    const map: Record<string, string> = {
      route: '路由分析',
      rewrite: '查询改写',
      audit: '检索审计',
      writer: '生成回答',
    };
    return map[stepName] ?? stepName;
  }

  /** 步骤输出摘要 */
  function stepOutputSummary(
    stepName: string,
    output: Record<string, unknown>,
  ): string {
    if (stepName === 'route') {
      return `意图: ${output.intent as string ?? 'unknown'}`;
    }
    if (stepName === 'rewrite') {
      const queries = output.queries as string[] | undefined;
      return `改写完成 → ${queries?.length ?? 0} 条查询`;
    }
    if (stepName === 'audit') {
      return `评估: ${output.verdict as string ?? 'unknown'}`;
    }
    if (stepName === 'writer') {
      return `回答生成完成 → ${Number(output.answerLength ?? 0)} 字`;
    }
    return '';
  }

  /**
   * 重置 Agent 状态。
   */
  function resetAgentState() {
    agentPhase.value = null;
    agentPhaseLabel.value = '';
    agentPhaseDetail.value = '';
    citations.value = [];
    agentWarnings.value = [];
    retrievalProgresses.value = [];
    aguiSteps.value = [];
    aguiToolCalls.value = [];
    timelineOrder = 0;
    currentRunId.value = null;
  }

  /**
   * 重置发送状态。
   */
  function setSending(sending: boolean) {
    isSending.value = sending;
  }

  /**
   * 设置最后一条用户消息（用于重试）。
   */
  function setLastUserMessage(msg: string) {
    lastUserMessage.value = msg;
  }

  // ─── 清空 ────────────────────────────────────────────────

  /**
   * 清空当前会话消息。
   */
  function clearCurrentSession() {
    currentSession.value = null;
    messages.value = [];
    resetAgentState();
  }

  return {
    // 状态
    sessions,
    currentSession,
    messages,
    isLoadingSessions,
    isLoadingMessages,
    isSending,
    chatMode,
    selectedKbIds,
    availableKbs,
    selectedModel,
    availableModels,
    // Agent 状态
    agentPhase,
    agentPhaseLabel,
    agentPhaseDetail,
    citations,
    agentWarnings,
    retrievalProgresses,
    aguiSteps,
    aguiToolCalls,
    currentRunId,
    setRunStarted,
    setRunFinished,
    upsertStep,
    upsertToolCall,
    lastUserMessage,
    // 计算属性
    hasActiveSession,
    isRagMode,
    selectedKbCount,
    hasCitations,
    hasWarnings,
    hasMoreSessions,
    kbCascaderOptions,
    // 会话操作
    loadSessions,
    loadMoreSessions,
    createSession,
    selectSession,
    renameSession,
    removeSession,
    addUserMessage,
    addAssistantMessage,
    updateAssistantMessage,
    updateAssistantMessageHtml,
    setMessageStatus,
    // 模式切换
    setChatMode,
    setSelectedKbIds,
    toggleKb,
    // 模型选择
    setSelectedModel,
    setAvailableKbs,
    setAvailableModels,
    // Agent 状态
    setAgentPhase,
    setCitations,
    addWarning,
    clearWarnings,
    resetAgentState,
    setSending,
    setLastUserMessage,
    clearCurrentSession,
    addRetrievalProgress,
    enableWebSearch,
    toggleWebSearch,
    setWebSearch,
  };
});
