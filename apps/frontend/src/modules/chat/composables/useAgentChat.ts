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
  AgentStatusPart,
  RetrievalProgressPart,
  CitationSnapshotPart,
  AgentWarningPart,
  CustomPart,
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
   * 解析 AI SDK data stream 协议的行
   * 协议格式：
   * - `0:` 文本块 {"delta": "..."}
   * - `8:` 自定义 data event JSON
   * - `d:` 流结束 {"reason": "stop"}
   */
  function parseStreamLine(line: string): { type: string; value: string } | null {
    if (!line || line.length < 2) return null;
    const type = line[0];
    const value = line.slice(1);
    return { type, value };
  }

  /**
   * 解析自定义 data part JSON
   */
  function parseCustomPart(jsonStr: string): CustomPart | null {
    try {
      const part = JSON.parse(jsonStr);
      if (part && typeof part === 'object' && 'type' in part) {
        return part as CustomPart;
      }
      return null;
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

          const parsed = parseStreamLine(trimmed);
          if (!parsed) continue;

          const { type, value: rawValue } = parsed;

          if (type === '0') {
            // 文本增量
            try {
              const data = JSON.parse(rawValue);
              if (data.delta) {
                pushDelta(data.delta);
              }
            } catch {
              // ignore parse error
            }
          } else if (type === '8') {
            // 自定义 data event
            const part = parseCustomPart(rawValue);
            if (!part) continue;

            switch (part.type) {
              case 'agent-status': {
                const status = part as AgentStatusPart;
                chatStore.setAgentPhase(status.phase, status.label, status.detail);
                break;
              }
              case 'retrieval-progress': {
                const progress = part as RetrievalProgressPart;
                chatStore.addRetrievalProgress(progress);
                break;
              }
              case 'citation-snapshot': {
                const citations = part as CitationSnapshotPart;
                chatStore.setCitations(citations.citations);
                break;
              }
              case 'agent-warning': {
                const warning = part as AgentWarningPart;
                chatStore.addWarning(warning);
                break;
              }
            }
          } else if (type === 'd') {
            // 流结束
            try {
              const data = JSON.parse(rawValue);
              if (data.reason === 'stop' || data.reason === 'complete') {
                // 正常结束
              }
            } catch {
              // ignore
            }
          }
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) {
        const parsed = parseStreamLine(buffer.trim());
        if (parsed && parsed.type === '0') {
          try {
            const data = JSON.parse(parsed.value);
            if (data.delta) {
              pushDelta(data.delta);
            }
          } catch {
            // ignore
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
    }
  }

  return {
    sendMessage,
    abort,
    isStreaming,
  };
}
