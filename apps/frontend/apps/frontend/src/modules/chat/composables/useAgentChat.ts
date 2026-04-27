/**
 * useAgentChat Composable
 *
 * 基于原生 fetch + ReadableStream 的流式聊天封装，
 * 解析 AI SDK data stream 格式，自定义 data parts，
 * 并与 Pinia chatStore 集成。
 */
import { ref, computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import { fetchChatStream } from '@/api/chat';
import type { ChatMessageItem } from '@/modules/chat/types/chat';
import type {
  AgentPhase,
  AgentStatusPart,
  RetrievalProgressPart,
  CitationSnapshotPart,
  AgentWarningPart,
  UIMessageChunk,
} from '@/modules/chat/types/stream';
import { parseStreamLine, parseCustomPart } from '@/modules/chat/types/stream';

/** AI SDK data stream 协议标识 */
const STREAM_TEXT_PREFIX = '0:';
const STREAM_DATA_PREFIX = '8:';
const STREAM_DONE = 'd:';

/**
 * 解析 AI SDK data stream 格式的响应。
 *
 * 协议格式：
 * - `0:` 文本块（JSON 字符串）
 * - `2:` tool call
 * - `8:` data event (自定义 part JSON)
 * - `a:` additions
 * - `d:` done
 */
async function parseStreamResponse(
  response: Response,
  callbacks: {
    onText?: (text: string) => void;
    onAgentStatus?: (status: AgentStatusPart) => void;
    onRetrievalProgress?: (progress: RetrievalProgressPart) => void;
    onCitationSnapshot?: (snapshot: CitationSnapshotPart) => void;
    onAgentWarning?: (warning: AgentWarningPart) => void;
    onFinish?: (reason: string) => void;
    onError?: (error: Error) => void;
  },
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let done = false;

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith(STREAM_TEXT_PREFIX)) {
            // 文本块
            const textJson = line.slice(STREAM_TEXT_PREFIX.length);
            try {
              const textData = JSON.parse(textJson);
              const delta = typeof textData === 'string'
                ? textData
                : textData.delta || textData.text || '';
              fullText += delta;
              callbacks.onText?.(delta);
            } catch {
              // 忽略解析错误
            }
          } else if (line.startsWith(STREAM_DATA_PREFIX)) {
            // 自定义 data event
            const dataJson = line.slice(STREAM_DATA_PREFIX.length);
            const customPart = parseCustomPart(dataJson);
            if (customPart) {
              switch (customPart.type) {
                case 'agent-status':
                  callbacks.onAgentStatus?.(customPart as AgentStatusPart);
                  break;
                case 'retrieval-progress':
                  callbacks.onRetrievalProgress?.(customPart as RetrievalProgressPart);
                  break;
                case 'citation-snapshot':
                  callbacks.onCitationSnapshot?.(customPart as CitationSnapshotPart);
                  break;
                case 'agent-warning':
                  callbacks.onAgentWarning?.(customPart as AgentWarningPart);
                  break;
              }
            }
          } else if (line.startsWith(STREAM_DONE)) {
            // 流结束
            const doneJson = line.slice(STREAM_DONE.length);
            try {
              const doneData = JSON.parse(doneJson);
              callbacks.onFinish?.(doneData.reason || 'stop');
            } catch {
              callbacks.onFinish?.('stop');
            }
          }
        }
      }
    }
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  return fullText;
}

export function useAgentChat() {
  const chatStore = useChatStore();

  /** 当前的文本内容（流式过程中逐步累积） */
  const currentText = ref('');

  /** 错误信息 */
  const error = ref<Error | null>(null);

  /** 当前请求的 abort controller */
  let abortController: AbortController | null = null;

  /**
   * 发送消息。
   *
   * @param text 消息文本
   * @param options 发送选项
   */
  async function sendMessage(
    text: string,
    options?: {
      sessionId?: string;
      chatMode?: 'chat' | 'rag';
      modelSource?: 'system' | 'user';
      modelConfigId?: string;
      selectedKbIds?: string[];
      agentMode?: 'multi-agent';
      metadata?: Record<string, unknown>;
    },
  ) {
    const {
      sessionId = chatStore.currentSession?.id,
      chatMode = chatStore.chatMode,
      modelSource = chatStore.selectedModel?.source,
      modelConfigId = chatStore.selectedModel?.configId,
      selectedKbIds = chatStore.selectedKbIds,
      agentMode = 'multi-agent',
      metadata,
    } = options || {};

    if (!sessionId) {
      error.value = new Error('No active session');
      return;
    }

    // 创建 abort controller
    abortController = new AbortController();

    // 设置 Agent 状态
    if (chatMode === 'rag') {
      chatStore.setAgentPhase('planning', '准备中');
    }
    chatStore.setSending(true);
    chatStore.clearWarnings();
    currentText.value = '';

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      sessionId,
      chatMode,
      message: text,
      agentMode,
    };

    if (modelSource) {
      requestBody.modelSource = modelSource;
    }
    if (modelConfigId) {
      requestBody.modelConfigId = modelConfigId;
    }
    if (chatMode === 'rag' && selectedKbIds?.length) {
      requestBody.selectedKbIds = selectedKbIds;
    }
    if (metadata) {
      requestBody.metadata = metadata;
    }

    // 乐观更新：添加用户消息到 store
    const userMessageId = Date.now();
    const userMessage: ChatMessageItem = {
      id: userMessageId,
      role: 'user',
      name: '用户',
      content: text,
      createdAt: new Date().toISOString(),
      chatMode,
      modelSource: modelSource as any,
      modelConfigId,
      selectedKbIds,
    };
    chatStore.addUserMessage(userMessage);

    // 乐观更新：添加助手消息占位
    const assistantMessageId = userMessageId + 1;
    const assistantMessage: ChatMessageItem = {
      id: assistantMessageId,
      role: 'ai',
      name: '灵索智能',
      content: '',
      createdAt: new Date().toISOString(),
      messageStatus: 'streaming',
      chatMode,
      modelSource: modelSource as any,
      modelConfigId,
      selectedKbIds,
    };
    chatStore.addAssistantMessage(assistantMessage);

    try {
      const response = await fetchChatStream(requestBody as any);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // 解析流式响应
      await parseStreamResponse(response, {
        onText: (delta) => {
          currentText.value += delta;
          // 更新助手消息内容
          chatStore.updateAssistantMessage(assistantMessageId, currentText.value);
        },
        onAgentStatus: (status) => {
          chatStore.setAgentPhase(status.phase, status.label, status.detail);
        },
        onRetrievalProgress: (progress) => {
          console.debug('[useAgentChat] retrieval-progress:', progress);
        },
        onCitationSnapshot: (snapshot) => {
          chatStore.setCitations(snapshot.citations);
        },
        onAgentWarning: (warning) => {
          chatStore.addWarning(warning);
        },
        onFinish: (reason) => {
          chatStore.updateMessageStatus(assistantMessageId, 'completed');
          chatStore.setAgentPhase('done', '完成');
          chatStore.setSending(false);
        },
        onError: (err) => {
          error.value = err;
          chatStore.updateMessageStatus(assistantMessageId, 'error');
          chatStore.setAgentPhase(null);
          chatStore.setSending(false);
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 用户主动取消
        chatStore.updateMessageStatus(assistantMessageId, 'aborted');
        chatStore.setAgentPhase(null);
        chatStore.setSending(false);
      } else {
        error.value = err instanceof Error ? err : new Error(String(err));
        chatStore.updateMessageStatus(assistantMessageId, 'error');
        chatStore.setAgentPhase(null);
        chatStore.setSending(false);
      }
    }
  }

  /**
   * 停止当前请求。
   */
  function stop() {
    abortController?.abort();
  }

  return {
    // 状态
    currentText,
    error,
    // 操作
    sendMessage,
    stop,
    // 状态映射
    messages: computed(() => chatStore.messages),
    isSending: computed(() => chatStore.isSending),
    agentPhase: computed(() => chatStore.agentPhase),
    agentPhaseLabel: computed(() => chatStore.agentPhaseLabel),
    agentPhaseDetail: computed(() => chatStore.agentPhaseDetail),
    citations: computed(() => chatStore.citations),
    agentWarnings: computed(() => chatStore.agentWarnings),
    chatMode: computed(() => chatStore.chatMode),
    selectedKbIds: computed(() => chatStore.selectedKbIds),
    selectedModel: computed(() => chatStore.selectedModel),
    // Store 引用
    chatStore,
  };
}
