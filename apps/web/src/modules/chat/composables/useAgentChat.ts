/**
 * Agent Chat Composable
 *
 * 核心流式对话逻辑：
 * 1. 调用 fetchChatStream() 发起流式请求
 * 2. 解析 AG-UI 协议 SSE 事件
 * 3. 通过 useStreamingMarkdown 渲染文本增量
 * 4. 更新 chatStore 中的 Agent 状态
 */
import { ref, shallowRef, onUnmounted } from 'vue';
import { fetchChatStream } from '@/api/chat';
import type { StreamChatRequest } from '@/modules/chat/types/chat';
import { useStreamingMarkdown } from './useStreamingMarkdown';
import { useAguiEventReducer } from './useAguiEventReducer';
import { parseSSELine, splitSSEBuffer } from '@/modules/chat/utils/agui-parser';
import { useChatStore } from '@/stores/chat';
import type { AguiEvent } from '@/modules/chat/types/stream';
import type { ChatMessageItem, RenderableBlock } from '@/modules/chat/types/chat';

interface UseAgentChatOptions {
  onMessageStart?: (messageId: number) => void;
  onMessageFinish?: (messageId: number) => void;
  onError?: (error: Error) => void;
}

export function useAgentChat(options?: UseAgentChatOptions) {
  const { onMessageStart, onMessageFinish, onError } = options || {};

  const isStreaming = ref(false);
  const abortController = shallowRef<AbortController | null>(null);
  const currentAssistantMsgId = ref<number | null>(null);
  const currentSkipTypewriter = ref<(() => void) | null>(null);
  const chatStore = useChatStore();
  let activeStreamToken = 0;

  async function ensureTargetSessionId(): Promise<string> {
    if (!chatStore.currentSession?.id) {
      await chatStore.createSession();
    }
    return chatStore.currentSession!.id;
  }

  function buildStreamRequest(
    sessionId: string,
    message: string,
  ): StreamChatRequest {
    return {
      sessionId,
      chatMode: chatStore.chatMode,
      message,
      modelSource: chatStore.selectedModel?.source,
      modelConfigId: chatStore.selectedModel?.source === 'user'
        ? chatStore.selectedModel?.configId.replace('user-', '')
        : chatStore.selectedModel?.configId,
      selectedKbIds: chatStore.chatMode === 'rag' ? chatStore.selectedKbIds : undefined,
      agentMode: 'multi-agent',
    };
  }

  function addLocalUserMessage(message: string): void {
    const userMsg: ChatMessageItem = {
      id: Date.now(),
      role: 'user',
      name: '用户',
      content: message,
      createdAt: new Date().toISOString(),
      chatMode: chatStore.chatMode,
      selectedKbIds: chatStore.chatMode === 'rag' ? chatStore.selectedKbIds : undefined,
      modelConfigId: chatStore.selectedModel?.configId,
      modelName: chatStore.selectedModel?.modelName,
    };
    chatStore.addUserMessage(userMsg);
  }

  function createAssistantPlaceholder(): number {
    const assistantMsgId = Date.now() + 1;
    const assistantMsg: ChatMessageItem = {
      id: assistantMsgId,
      role: 'ai',
      name: 'AI 助手',
      content: '',
      createdAt: new Date().toISOString(),
      messageStatus: 'streaming',
      chatMode: chatStore.chatMode,
    };
    chatStore.addAssistantMessage(assistantMsg);
    chatStore.setMessageStatus(assistantMsgId, 'streaming');
    onMessageStart?.(assistantMsgId);
    return assistantMsgId;
  }

  function createBlockScheduler(assistantMsgId: number) {
    let pendingBlocks: RenderableBlock[] | null = null;
    let pendingBlocksFrame: number | null = null;

    function commit() {
      if (pendingBlocksFrame !== null) {
        cancelAnimationFrame(pendingBlocksFrame);
        pendingBlocksFrame = null;
      }
      if (!pendingBlocks) return;

      chatStore.appendMessageBlocks(assistantMsgId, pendingBlocks);
      pendingBlocks = null;
    }

    function schedule(blocks: RenderableBlock[]) {
      pendingBlocks = blocks;
      if (pendingBlocksFrame !== null) return;

      pendingBlocksFrame = requestAnimationFrame(() => {
        pendingBlocksFrame = null;
        if (!pendingBlocks) return;

        chatStore.appendMessageBlocks(assistantMsgId, pendingBlocks);
        pendingBlocks = null;
      });
    }

    return { commit, schedule };
  }

  async function consumeStream(
    response: Response,
    handleEvent: (event: AguiEvent) => void,
  ): Promise<void> {
    if (!response.ok) {
      throw new Error(`请求失败（状态码 ${response.status}）`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('响应数据不可读');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const { lines, rest } = splitSSEBuffer(buffer);
      buffer = rest;

      try {
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = parseSSELine(trimmed);
          if (event) handleEvent(event);
        }
      } catch (eventError) {
        console.error('[useAgentChat] 事件处理异常', eventError);
        break;
      }
    }

    // 处理剩余 buffer
    try {
      if (buffer.trim()) {
        const event = parseSSELine(buffer.trim());
        if (event) handleEvent(event);
      }
    } catch (eventError) {
      console.error('[useAgentChat] 剩余 buffer 事件处理异常', eventError);
    }
  }

  /**
   * 发送消息并处理流式响应。
   */
  async function sendMessage(message: string): Promise<void> {
    if (isStreaming.value) {
      console.warn('[useAgentChat] 已有流正在进行，先中止');
      abort();
    }

    const targetSessionId = await ensureTargetSessionId();
    const request = buildStreamRequest(targetSessionId, message);

    addLocalUserMessage(message);
    const assistantMsgId = createAssistantPlaceholder();

    // 重置状态
    chatStore.resetAgentState();
    chatStore.setSending(true);
    isStreaming.value = true;

    const streamToken = ++activeStreamToken;
    currentAssistantMsgId.value = assistantMsgId;
    abortController.value = new AbortController();

    const blockScheduler = createBlockScheduler(assistantMsgId);

    // Markdown 渲染器（带打字机效果）
    const {
      pushDelta,
      flush,
      skip: skipTypewriter,
      reset: resetMarkdown,
    } = useStreamingMarkdown({
      onBlocks: (blocks) => {
        blockScheduler.schedule(blocks as RenderableBlock[])
      },
      onComplete: () => {
        // 打字机动画播放完毕 ≠ 消息整体完成（后端可能还在校验/补充）
        // 仅通知外部，不修改消息状态
        onMessageFinish?.(assistantMsgId)
      },
      onError: (err) => {
        console.error('[useAgentChat] Markdown 渲染错误:', err)
        onError?.(err)
      },
    })

    currentSkipTypewriter.value = skipTypewriter;

    const { handleEvent } = useAguiEventReducer({
      assistantMsgId,
      pushDelta,
      flush,
    });

    try {
      const response = await fetchChatStream(request, abortController.value.signal)
      await consumeStream(response, handleEvent);
      flush();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (error.name === 'AbortError' || error.message.includes('abort')) {
        chatStore.setMessageStatus(assistantMsgId, 'aborted');
      } else {
        chatStore.setMessageStatus(assistantMsgId, 'error');
        onError?.(error);
      }
    } finally {
      blockScheduler.commit();
      if (activeStreamToken === streamToken) {
        // 仅重置 parser，不重置 transformer（否则会 emit 空 blocks 导致已显示内容消失）
        resetMarkdown();
        chatStore.setSending(false);
        isStreaming.value = false;
        abortController.value = null;
        currentAssistantMsgId.value = null;
        currentSkipTypewriter.value = null;
      }
    }
  }

  /**
   * 中止当前流式请求，并跳过打字机动画。
   */
  function markCurrentMessageAborted(): void {
    const msgId = currentAssistantMsgId.value;
    if (msgId === null) return;

    const msg = chatStore.messages.find((item) => item.id === msgId);
    if (msg?.messageStatus === 'streaming') {
      chatStore.setMessageStatus(msgId, 'aborted');
    }
  }

  function abort(): void {
    markCurrentMessageAborted();
    currentSkipTypewriter.value?.();
    if (abortController.value) {
      abortController.value.abort()
    }
  }

  // 组件卸载时自动中断进行中的流，避免后台资源泄漏
  onUnmounted(() => {
    abort();
  });

  return {
    sendMessage,
    abort,
    isStreaming,
  };
}
