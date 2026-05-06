/**
 * 流式事件协议类型定义
 *
 * 遵循 AI SDK UI Message Stream 协议 + 自定义 data parts。
 * @see https://sdk.vercel.ai/docs/reference/ai-sdk-ui/stream-protocol
 */

/** Agent 工作流阶段 */
export type AgentPhase =
  | 'planning'
  | 'retrieving'
  | 'reranking'
  | 'verifying'
  | 'writing'
  | 'done';

/** Agent 状态事件 */
export interface AgentStatusPart {
  type: 'agent-status';
  phase: AgentPhase;
  label: string;
  detail?: string;
}

/** 检索进度事件
 * 后端发送: { type: 'retrieval-progress', denseCount, sparseCount, fusedCount }
 */
export interface RetrievalProgressPart {
  type: 'retrieval-progress';
  kbId?: string;
  kbName?: string;
  query?: string;
  hitCount?: number;
  channel?: 'dense' | 'sparse' | 'hybrid';
  denseCount?: number;
  sparseCount?: number;
  fusedCount?: number;
}

/** 引用快照事件 */
export interface CitationSnapshotPart {
  type: 'citation-snapshot';
  citations: Citation[];
}

/** 引用项 */
export interface Citation {
  citationId: string;
  kbId: string;
  kbName: string;
  docId: string;
  docTitle: string;
  chunkId: string;
  quote: string;
}

/** Agent 警告事件 */
export interface AgentWarningPart {
  type: 'agent-warning';
  code: 'LOW_CONFIDENCE' | 'PARTIAL_ANSWER' | 'WEB_SEARCH_CANDIDATE' | 'INSUFFICIENT_CONTEXT' | 'USER_CANCELLED';
  message: string;
}

/** 节点执行记录 */
export interface AgentStepPart {
  type: 'agent-step';
  stepType: string;
  agentName: string;
  status: 'started' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}

/** 工具调用记录 */
export interface ToolCallPart {
  type: 'tool-call';
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}

/** 自定义 data part 联合类型 */
export type CustomPart =
  | AgentStatusPart
  | RetrievalProgressPart
  | CitationSnapshotPart
  | AgentWarningPart
  | AgentStepPart
  | ToolCallPart;

/** 流式消息块（AI SDK 格式） */
export interface UIMessageChunk {
  type: 'message';
  messageId: string;
  delta: string;
  role?: 'user' | 'assistant';
}

/** 解析后的流式事件 */
export interface StreamEvent {
  text?: string;
  agentStatus?: AgentStatusPart;
  retrievalProgress?: RetrievalProgressPart;
  citationSnapshot?: CitationSnapshotPart;
  agentWarning?: AgentWarningPart;
  finish?: {
    reason: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
    };
  };
  error?: string;
}

/**
 * 解析 AI SDK data stream 格式的行。
 * 协议格式：
 * - `0:` 文本块
 * - `2:` tool call
 * - `8:` data event (自定义 part)
 * - `a:` additions
 * - `d:` done
 */
export function parseStreamLine(line: string): {
  type: string;
  value: string;
} | null {
  if (!line || line.length < 2) return null;

  const type = line[0];
  const value = line.slice(1);

  return { type, value };
}

/**
 * 解析自定义 data part JSON。
 */
export function parseCustomPart(jsonStr: string): CustomPart | null {
  try {
    const part = JSON.parse(jsonStr) as Record<string, unknown>;
    if (part && typeof part === 'object' && 'type' in part) {
      return part as unknown as CustomPart;
    }
    return null;
  } catch {
    return null;
  }
}
