/**
 * 聊天模块 Pinia Store（统一入口）
 *
 * 组合 chat-session / chat-agent / chat-config 三个 domain store，
 * 保持与旧版 API 完全兼容。
 */
import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch, toRef } from 'vue';
import type { Ref } from 'vue';
import {
  listChatSessions,
  getChatSession,
  listChatMessages,
} from '@/api/chat';
import type {
  ChatMessageItem,
  ChatSessionSummary,
  ChatMode,
  KbOption,
  ModelOption,
  RenderableBlock,
} from '@/modules/chat/types/chat';
import type {
  Citation,
  AguiStepRecord,
  AguiToolCallRecord,
} from '@/modules/chat/types/stream';
import { useChatSessionStore } from './chat-session';
import { useChatAgentStore } from './chat-agent';
import { useChatConfigStore, type AvailableKb, type AvailableModel } from './chat-config';

export const useChatStore = defineStore('chat', () => {
  const sessionStore = useChatSessionStore();
  const agentStore = useChatAgentStore();
  const configStore = useChatConfigStore();

  // ─── Session 代理（storeToRefs / toRef 保留 Ref 响应性） ──

  const { sessions, messages, isSending } = storeToRefs(sessionStore);
  // 使用 toRef 创建双向绑定 ref，避免 watch 克隆的微任务窗口和双写不一致
  const currentSession = toRef(sessionStore, 'currentSession') as Ref<ChatSessionSummary | null>;

  const isLoadingSessions = ref(false);
  const isLoadingMessages = ref(false);
  const sessionsPage = ref(1);
  const sessionsPageSize = ref(20);
  const sessionsTotal = ref(0);
  const hasMoreSessions = computed(() => sessions.value.length < sessionsTotal.value);

  // ─── Config 代理 ───────────────────────────────────────────

  const { chatMode, selectedKbIds, selectedKbCount } = storeToRefs(configStore);
  // 使用 toRef 而非直接取值，保持双向响应式绑定
  const lastUserMessage = toRef(configStore, 'lastUserMessage') as Ref<string>;

  const availableKbs = ref<KbOption[]>([]);
  const availableModels = ref<ModelOption[]>([]);
  const selectedModel = ref<ModelOption | null>(null);

  // 保持 config store 的 refs 与本地 refs 同步
  watch(() => configStore.availableKbs, (val) => { availableKbs.value = val as unknown as KbOption[]; }, { immediate: true });
  watch(() => configStore.availableModels, (val) => { availableModels.value = val as unknown as ModelOption[]; }, { immediate: true });
  watch(() => configStore.selectedModel, (val) => { selectedModel.value = (val as unknown as ModelOption | null) ?? null; }, { immediate: true });

  // ─── Agent 代理 ────────────────────────────────────────────

  const {
    agentPhase, agentPhaseLabel, agentPhaseDetail,
    citations, highlightedCitationIndex, agentWarnings, retrievalProgresses,
    aguiSteps, aguiToolCalls, hasCitations, hasWarnings,
  } = storeToRefs(agentStore);

  // ─── 会话操作 ─────────────────────────────────────────────

  async function loadSessions(page = 1, pageSize = 20) {
    try {
      isLoadingSessions.value = true;
      const result = await listChatSessions({ page, pageSize });
      sessions.value = result.list;
      sessionsTotal.value = result.total;
      sessionsPage.value = page;
    } catch {
      // 静默失败
    } finally {
      isLoadingSessions.value = false;
    }
  }

  async function loadMessages(sessionId: string) {
    try {
      isLoadingMessages.value = true;
      const result = await listChatMessages(sessionId);
      messages.value = result.list;
    } catch {
      // 静默失败
    } finally {
      isLoadingMessages.value = false;
    }
  }

  async function createSession() {
    const session = await sessionStore.createSession();
    if (session) await loadMessages(session.id);
    return session;
  }

  async function selectSession(sessionId: string) {
    await sessionStore.selectSession(sessionId);
    // 解析历史消息中的引用数据
    for (const msg of messages.value) {
      if (msg.references && Array.isArray(msg.references) && !msg.citations) {
        msg.citations = (msg.references as Citation[]).map((ref, i) => ({
          ...ref,
          index: ref.index ?? i + 1,
        }));
      }
    }
    // 取最后一条有引用的 AI 消息，展示引用面板
    const lastCitationMsg = [...messages.value]
      .reverse()
      .find((m) => m.citations && m.citations.length > 0);
    if (lastCitationMsg?.citations) {
      agentStore.setCitations(lastCitationMsg.citations);
    } else {
      agentStore.setCitations([]);
    }
  }

  async function removeSession(sessionId: string) {
    await sessionStore.removeSession(sessionId);
  }

  async function renameSession(sessionId: string, title: string) {
    await sessionStore.renameSession(sessionId, title);
  }

  async function switchToSession(sessionId: string) {
    try {
      const session = await getChatSession(sessionId);
      sessionStore.setCurrentSession(session);
      await loadMessages(sessionId);
    } catch {
      // 静默失败
    }
  }

  // ─── 消息操作 ─────────────────────────────────────────────

  function addUserMessage(msg: ChatMessageItem) {
    messages.value.push(msg);
    return msg;
  }

  function addAssistantMessage(msg: ChatMessageItem) {
    messages.value.push(msg);
    return msg;
  }

  function setMessageStatus(msgId: number, status: string) {
    sessionStore.setMessageStatus(msgId, status as never);
  }

  function setSending(val: boolean) {
    sessionStore.setSending(val);
  }

  function appendMessageHtml(msgIndex: number, html: string) {
    sessionStore.appendMessageHtml(msgIndex, html);
  }

  function appendMessageBlocks(msgIndex: number, blocks: RenderableBlock[]) {
    sessionStore.appendMessageBlocks(msgIndex, blocks);
  }

  function setLastUserMessage(message: string) {
    configStore.setLastUserMessage(message);
  }

  // ─── 配置操作 ─────────────────────────────────────────────

  function setChatMode(mode: ChatMode) {
    configStore.setChatMode(mode);
    if (mode === 'chat') {
      configStore.setSelectedKbIds([]);
    }
  }

  function setSelectedKbIds(kbIds: string[]) {
    configStore.setSelectedKbIds(kbIds);
  }

  function toggleKb(kbId: string) {
    configStore.toggleKb(kbId);
  }

  function setAvailableKbs(kbs: AvailableKb[]) {
    configStore.setAvailableKbs(kbs);
  }

  function setAvailableModels(models: AvailableModel[]) {
    configStore.setAvailableModels(models);
  }

  function setSelectedModel(model: AvailableModel | null) {
    configStore.setSelectedModel(model);
  }

  // ─── Agent 操作 ───────────────────────────────────────────

  function resetAgentState() {
    agentStore.resetAgentState();
  }

  function setRunStarted(runId: string) {
    agentStore.setRunStarted(runId);
  }

  function setRunFinished() {
    agentStore.setRunFinished();
  }

  function upsertStep(step: AguiStepRecord) {
    agentStore.upsertStep(step);
  }

  function upsertToolCall(tc: AguiToolCallRecord) {
    agentStore.upsertToolCall(tc);
  }

  function addCitation(citation: Citation) {
    agentStore.addCitation(citation);
  }

  function setCitations(citationsList: Citation[]) {
    agentStore.setCitations(citationsList);
  }

  function appendCitations(newDocs: Citation[]) {
    agentStore.appendCitations(newDocs);
  }

  return {
    // session state
    sessions,
    currentSession,
    messages,
    isLoadingSessions,
    isLoadingMessages,
    isSending,
    sessionsPage,
    sessionsPageSize,
    sessionsTotal,
    hasMoreSessions,
    lastUserMessage,
    // config state
    chatMode,
    selectedKbIds,
    selectedKbCount,
    selectedModel,
    availableKbs,
    availableModels,
    // citation actions
    setCitations,
    appendCitations,
    // agent state
    agentPhase,
    agentPhaseLabel,
    agentPhaseDetail,
    citations,
    highlightedCitationIndex,
    agentWarnings,
    retrievalProgresses,
    aguiSteps,
    aguiToolCalls,
    hasCitations,
    hasWarnings,
    // session actions
    loadSessions,
    loadMessages,
    createSession,
    selectSession,
    switchToSession,
    removeSession,
    renameSession,
    // message actions
    addUserMessage,
    addAssistantMessage,
    setMessageStatus,
    setSending,
    appendMessageHtml,
    appendMessageBlocks,
    setLastUserMessage,
    // config actions
    setChatMode,
    setSelectedKbIds,
    toggleKb,
    setAvailableKbs,
    setAvailableModels,
    setSelectedModel,
    // agent actions
    resetAgentState,
    setRunStarted,
    setRunFinished,
    upsertStep,
    upsertToolCall,
    addCitation,
  };
});
