/**
 * 聊天会话 Store
 *
 * 管理会话列表、当前会话、消息列表的 CRUD。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChatSessionSummary, ChatMessageItem, MessageRole, MessageStatus, RenderableBlock } from '@/modules/chat/types/chat';
import {
  listChatSessions,
  createChatSession,
  deleteChatSession,
  renameChatSession,
  listChatMessages,
} from '@/api/chat';

export const useChatSessionStore = defineStore('chat-session', () => {
  // ── 状态 ──
  const sessions = ref<ChatSessionSummary[]>([]);
  const currentSession = ref<ChatSessionSummary | null>(null);
  const messages = ref<ChatMessageItem[]>([]);
  const isSending = ref(false);
  const sessionsLoaded = ref(false);

  // ── 计算 ──
  const hasMessages = computed(() => messages.value.length > 0);

  // ── 会话管理 ──

  async function loadSessions() {
    try {
      const result = await listChatSessions();
      sessions.value = result.list;
      sessionsLoaded.value = true;
    } catch {
      // 静默失败
    }
  }

  async function createSession(): Promise<ChatSessionSummary | null> {
    try {
      const session = await createChatSession({ title: '新会话' });
      sessions.value.unshift(session);
      selectSession(session.id);
      return session;
    } catch {
      return null;
    }
  }

  async function selectSession(sessionId: string) {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      currentSession.value = session;
      // 加载该会话的历史消息
      try {
        const result = await listChatMessages(sessionId);
        messages.value = result.list;
      } catch {
        messages.value = [];
      }
    }
  }

  async function renameSession(sessionId: string, title: string) {
    try {
      await renameChatSession(sessionId, title);
      const session = sessions.value.find((s) => s.id === sessionId);
      if (session) session.title = title;
    } catch {
      // 静默失败
    }
  }

  async function removeSession(sessionId: string) {
    try {
      await deleteChatSession(sessionId);
      sessions.value = sessions.value.filter((s) => s.id !== sessionId);
      if (currentSession.value?.id === sessionId) {
        currentSession.value = null;
        messages.value = [];
      }
    } catch {
      // 静默失败
    }
  }

  function setCurrentSession(session: ChatSessionSummary | null) {
    currentSession.value = session;
  }

  // ── 消息管理 ──

  function addMessage(message: ChatMessageItem) {
    messages.value.push(message);
  }

  function addUserMessage(content: string) {
    const msg: ChatMessageItem = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user' as MessageRole,
      name: 'You',
      content,
      createdAt: new Date().toISOString(),
      messageStatus: 'completed',
    };
    messages.value.push(msg);
    return msg;
  }

  function addAssistantMessage(content = '') {
    const msg: ChatMessageItem = {
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant' as MessageRole,
      name: 'Linsor',
      content,
      createdAt: new Date().toISOString(),
      messageStatus: 'streaming' as MessageStatus,
    };
    messages.value.push(msg);
    return msg;
  }

  function setMessageStatus(msgId: number, status: MessageStatus) {
    const msg = messages.value.find((m) => m.id === msgId);
    if (msg) msg.messageStatus = status;
  }

  function setMessageContent(msgId: number, content: string) {
    const msg = messages.value.find((m) => m.id === msgId);
    if (msg) msg.content = content;
  }

  function appendMessageHtml(msgId: number, html: string) {
    const msg = messages.value.find((m) => m.id === msgId);
    if (msg) msg.htmlContent = (msg.htmlContent ?? '') + html;
  }

  function appendMessageBlocks(msgId: number, blocks: RenderableBlock[]) {
    const msg = messages.value.find((m) => m.id === msgId);
    if (msg) msg.blocks = blocks;
  }

  function setSending(val: boolean) {
    isSending.value = val;
  }

  function clearMessages() {
    messages.value = [];
  }

  return {
    // state
    sessions,
    currentSession,
    messages,
    isSending,
    sessionsLoaded,
    // computed
    hasMessages,
    // session actions
    loadSessions,
    createSession,
    selectSession,
    renameSession,
    removeSession,
    setCurrentSession,
    // message actions
    addMessage,
    addUserMessage,
    addAssistantMessage,
    setMessageStatus,
    setMessageContent,
    appendMessageHtml,
    appendMessageBlocks,
    setSending,
    clearMessages,
  };
});
