/**
 * Agent Chat Composable
 *
 * 核心流式对话逻辑：
 * 1. 调用 fetchChatStream() 发起流式请求
 * 2. 解析 AG-UI 协议 SSE 事件
 * 3. 通过 useStreamingMarkdown 渲染文本增量
 * 4. 更新 chatStore 中的 Agent 状态
 */
import { ref, shallowRef } from 'vue';
import { fetchChatStream } from '@/api/chat';
import type { StreamChatRequest } from '@/modules/chat/types/chat';
import {
  type AguiEvent,
  type StepName,
  type ToolCallName,
} from '@/modules/chat/types/stream';
import { useStreamingMarkdown } from './useStreamingMarkdown';
import { useChatStore } from '@/stores/chat';
import type { ChatMessageItem } from '@/modules/chat/types/chat';

interface UseAgentChatOptions {
  onMessageStart?: (messageId: number) => void;
  onMessageFinish?: (messageId: number) => void;
  onError?: (error: Error) => void;
}

export function useAgentChat(options?: UseAgentChatOptions) {
  const { onMessageStart, onMessageFinish, onError } = options || {};

  const isStreaming = ref(false);
  const abortController = shallowRef<AbortController | null>(null);
  const chatStore = useChatStore();

  /**
   * 解析 SSE data 行，返回 AG-UI 事件。
   */
  function parseSSELine(line: string): AguiEvent | null {
    if (!line.startsWith('data: ')) return null;

    const json = line.slice(6);
    if (json === '[DONE]') return null;

    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      if (obj && typeof obj === 'object' && 'type' in obj) {
        return obj as unknown as AguiEvent;
      }
      return null;
    } catch {
      return null;
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

    const sessionId = chatStore.currentSession?.id;
    if (!sessionId) {
      await chatStore.createSession();
    }

    const targetSessionId = chatStore.currentSession!.id;

    const request: StreamChatRequest = {
      sessionId: targetSessionId,
      chatMode: chatStore.chatMode,
      message,
      modelSource: chatStore.selectedModel?.source,
      modelConfigId: chatStore.selectedModel?.configId,
      selectedKbIds: chatStore.chatMode === 'rag' ? chatStore.selectedKbIds : undefined,
      agentMode: 'multi-agent',
      enableWebSearch: chatStore.enableWebSearch,
    };

    // 乐观添加用户消息
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

    // 创建助手消息占位
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

    // 重置状态
    chatStore.resetAgentState();
    chatStore.setSending(true);
    isStreaming.value = true;

    abortController.value = new AbortController();

    // 获取当前助手消息引用（用于持久化步骤数据）
    const getCurrentAssistantMsg = () =>
      chatStore.messages.find((m: ChatMessageItem) => m.id === assistantMsgId) as
        | ChatMessageItem
        | undefined;

    // Markdown 渲染器
    const {
      pushDelta,
      flush,
      reset: resetMarkdown,
    } = useStreamingMarkdown({
      onFlush: (html) => {
        chatStore.updateAssistantMessageHtml(assistantMsgId, html, 'append');
      },
      onComplete: () => {
        chatStore.setMessageStatus(assistantMsgId, 'completed');
        onMessageFinish?.(assistantMsgId);
      },
      onError: (err) => {
        console.error('[useAgentChat] Markdown 渲染错误:', err);
        onError?.(err);
      },
    });

    try {
      const response = await fetchChatStream(request, abortController.value.signal);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = parseSSELine(trimmed);
          if (!event) continue;

          switch (event.type) {
            case 'RUN_STARTED':
              chatStore.setRunStarted(event.runId);
              break;

            case 'RUN_FINISHED':
              chatStore.setRunFinished();
              // 将步骤数据快照到消息对象
              {
                const msg = getCurrentAssistantMsg();
                if (msg) {
                  msg.aguiSteps = [...chatStore.aguiSteps];
                  msg.aguiToolCalls = [...chatStore.aguiToolCalls];
                }
              }
              break;

            case 'RUN_ERROR':
              chatStore.setMessageStatus(assistantMsgId, 'error');
              break;

            case 'STEP_STARTED':
              chatStore.upsertStep({
                stepName: event.stepName as StepName,
                status: 'running',
              });
              break;

            case 'STEP_FINISHED':
              chatStore.upsertStep({
                stepName: event.stepName as StepName,
                status: 'completed',
                input: event.input,
                output: event.output,
                durationMs: event.durationMs,
              });
              break;

            case 'TOOL_CALL_START':
              chatStore.upsertToolCall({
                toolCallId: event.toolCallId,
                toolCallName: event.toolCallName as ToolCallName,
                input: event.input,
                status: 'running',
              });
              break;

            case 'TOOL_CALL_RESULT':
              chatStore.upsertToolCall({
                toolCallId: event.toolCallId,
                toolCallName: event.toolCallName as ToolCallName,
                output: event.output,
                durationMs: event.durationMs,
                status: 'completed',
              });
              break;

            case 'TEXT_MESSAGE_START':
              // 文本流开始，无需额外处理
              break;

            case 'TEXT_MESSAGE_CONTENT':
              pushDelta(event.delta);
              break;

            case 'TEXT_MESSAGE_END':
              flush();
              break;
          }
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) {
        const event = parseSSELine(buffer.trim());
        if (event && event.type === 'TEXT_MESSAGE_CONTENT') {
          pushDelta(event.delta);
        }
      }

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
      resetMarkdown();
      chatStore.setSending(false);
      isStreaming.value = false;
      abortController.value = null;
    }
  }

  /**
   * 中止当前流式请求。
   */
  function abort(): void {
    if (abortController.value) {
      abortController.value.abort();
    }
  }

  return {
    sendMessage,
    abort,
    isStreaming,
  };
}
