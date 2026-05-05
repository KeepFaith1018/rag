/**
 * Agent Chat Composable
 *
 * 核心流式对话逻辑：
 * 1. 调用 fetchChatStream() 发起流式请求
 * 2. 解析 AI SDK data stream 协议
 * 3. 通过 useStreamingMarkdown 渲染文本增量
 * 4. 更新 chatStore 中的 Agent 状态
 */
import { ref, shallowRef } from 'vue';
import { fetchChatStream } from '@/api/chat';
import type { StreamChatRequest } from '@/modules/chat/types/chat';
import type {
  AgentPhase,
  RetrievalProgressPart,
  CitationSnapshotPart,
  AgentWarningPart,
} from '@/modules/chat/types/stream';
import { useStreamingMarkdown } from './useStreamingMarkdown';
import { useChatStore } from '@/stores/chat';
import type { ChatMessageItem } from '@/modules/chat/types/chat';

interface UseAgentChatOptions {
  /** 消息开始回调 */
  onMessageStart?: (messageId: number) => void;
  /** 消息完成回调 */
  onMessageFinish?: (messageId: number) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

export function useAgentChat(options?: UseAgentChatOptions) {
  const { onMessageStart, onMessageFinish, onError } = options || {};

  /** 是否正在流式传输 */
  const isStreaming = ref(false);

  /** AbortController 用于取消请求 */
  const abortController = shallowRef<AbortController | null>(null);

  /** chatStore 实例 */
  const chatStore = useChatStore();

  /**
 * 解析 SSE data 行
 * SSE 格式: data: {"type": "...", ...}\n\n
 * @returns 解析后的对象，包含 type 和 data 字段
 */
function parseSSEData(line: string): { type: string; data: Record<string, unknown> } | null {
  // SSE 行的格式: "data: {...}" 或 "data: [DONE]"
  if (!line.startsWith('data: ')) {
    return null;
  }

  const json = line.slice(6); // 去掉 "data: " 前缀

  // SSE 结束标记
  if (json === '[DONE]') {
    return { type: '[DONE]', data: {} };
  }

  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : '';
    return { type, data: obj };
  } catch {
    return null;
  }
}

  /**
   * 发送消息并处理流式响应
   */
  async function sendMessage(message: string): Promise<void> {
    if (isStreaming.value) {
      console.warn('[useAgentChat] 已有流正在进行，先中止');
      abort();
    }

    // 获取当前会话 ID
    const sessionId = chatStore.currentSession?.id;
    if (!sessionId) {
      // 自动创建会话
      await chatStore.createSession();
    }

    const targetSessionId = chatStore.currentSession!.id;

    // 构建请求
    const request: StreamChatRequest = {
      sessionId: targetSessionId,
      chatMode: chatStore.chatMode,
      message,
      modelSource: chatStore.selectedModel?.source,
      modelConfigId: chatStore.selectedModel?.configId,
      selectedKbIds: chatStore.chatMode === 'rag' ? chatStore.selectedKbIds : undefined,
      agentMode: 'multi-agent',
    };

    // 乐观地添加用户消息
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

    // 重置 Agent 状态
    chatStore.resetAgentState();
    chatStore.setSending(true);
    isStreaming.value = true;

    // 创建 AbortController
    abortController.value = new AbortController();

    // 创建 Markdown 渲染器
    const { pushDelta, flush, reset: resetMarkdown } = useStreamingMarkdown({
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
      // 发起流式请求
      const response = await fetchChatStream(request);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 获取 reader
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // 流式读取
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按行分割处理
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = parseSSEData(trimmed);
          if (!parsed) continue;

          const { type, data } = parsed;

          if (type === 'text-delta') {
            // 文本增量: {"type": "text-delta", "id": "...", "delta": "..."}
            const delta = data.delta;
            if (typeof delta === 'string') {
              pushDelta(delta);
            }
          } else if (type === 'finish') {
            // 流结束: {"type": "finish", "finishReason": "stop"}
            flush();
          } else if (type.startsWith('data-')) {
            // 自定义 data 事件: {"type": "data-xxx", "data": {...}}
            const innerData = data.data as Record<string, unknown>;
            if (!innerData || typeof innerData !== 'object') continue;

            const innerType = typeof innerData.type === 'string' ? innerData.type : '';

            switch (innerType) {
              case 'agent-status': {
                const phase = innerData.phase as AgentPhase | undefined;
                const label = innerData.label as string | undefined;
                const detail = innerData.detail as string | undefined;
                if (phase) {
                  chatStore.setAgentPhase(phase, label || '', detail || '');
                }
                break;
              }
              case 'retrieval-progress': {
                // 后端发送: { denseCount, sparseCount, fusedCount } 在 data 里
                const progress: RetrievalProgressPart = {
                  type: 'retrieval-progress',
                  denseCount: data.denseCount as number | undefined,
                  sparseCount: data.sparseCount as number | undefined,
                  fusedCount: data.fusedCount as number | undefined,
                };
                chatStore.addRetrievalProgress(progress);
                break;
              }
              case 'citation-snapshot': {
                const citations = data as unknown as CitationSnapshotPart;
                if (Array.isArray(citations.citations)) {
                  chatStore.setCitations(citations.citations);
                }
                break;
              }
              case 'agent-warning': {
                const warning = data as unknown as AgentWarningPart;
                chatStore.addWarning(warning);
                break;
              }
            }
          }
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) {
        const parsed = parseSSEData(buffer.trim());
        if (parsed && parsed.type === 'text-delta') {
          const delta = parsed.data.delta;
          if (typeof delta === 'string') {
            pushDelta(delta);
          }
        }
      }

      // 最终 flush
      flush();

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // 处理 AbortError
      if (error.name === 'AbortError' || error.message.includes('abort')) {
        chatStore.setMessageStatus(assistantMsgId, 'aborted');
      } else {
        chatStore.setMessageStatus(assistantMsgId, 'error');
        onError?.(error);
      }
    } finally {
      // 清理
      resetMarkdown();
      chatStore.setSending(false);
      isStreaming.value = false;
      abortController.value = null;
    }
  }

  /**
   * 中止当前流式请求
   */
  function abort(): void {
    if (abortController.value) {
      abortController.value.abort();
      // 添加取消提示
      chatStore.addWarning({
        type: 'agent-warning',
        code: 'USER_CANCELLED',
        message: '用户取消了请求',
      });
    }
  }

  return {
    sendMessage,
    abort,
    isStreaming,
  };
}
