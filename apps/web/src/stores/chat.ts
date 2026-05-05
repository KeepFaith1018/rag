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

  /** 最后一条用户消息内容（用于重试） */
  const lastUserMessage = ref('');

  // ─── 计算属性 ─────────────────────────────────────────────

  const hasActiveSession = computed(() => currentSession.value !== null);

  const isRagMode = computed(() => chatMode.value === 'rag');

  const selectedKbCount = computed(() => selectedKbIds.value.length);

  const hasCitations = computed(() => citations.value.length > 0);

  const hasWarnings = computed(() => agentWarnings.value.length > 0);

  // ─── 会话操作 ─────────────────────────────────────────────

  /**
   * 加载会话列表。
   */
  async function loadSessions() {
    isLoadingSessions.value = true;
    try {
      const response = await listChatSessions();
      // 后端返回 { list: [...], total }，直接数组也兼容
      if (response && typeof response === 'object' && 'list' in response) {
        sessions.value = (response as { list: ChatSessionSummary[] }).list;
      } else if (Array.isArray(response)) {
        sessions.value = response;
      } else {
        sessions.value = [];
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
      messages.value = await listChatMessages(sessionId);
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
   * 后端发送的检索进度去重：只保留最新的
   */
  function addRetrievalProgress(progress: RetrievalProgressPart) {
    // 后端发送的检索进度没有 kbId/channel，使用索引去重
    const idx = retrievalProgresses.value.findIndex(
      (p) => p.type === 'retrieval-progress' && p.denseCount === progress.denseCount && p.sparseCount === progress.sparseCount,
    );
    if (idx >= 0) {
      retrievalProgresses.value[idx] = progress;
    } else {
      retrievalProgresses.value.push(progress);
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
    lastUserMessage,
    // 计算属性
    hasActiveSession,
    isRagMode,
    selectedKbCount,
    hasCitations,
    hasWarnings,
    // 会话操作
    loadSessions,
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
  };
});
