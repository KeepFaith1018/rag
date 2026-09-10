/**
 * AG-UI 协议事件类型定义
 *
 * 前后端使用统一的 AG-UI 事件语义进行 SSE 通信。
 * @see https://docs.ag-ui.com/sdk/js/core/events
 */

/** Step 名称 */
export type StepName =
  | 'route'
  | 'decompose'
  | 'rewrite'
  | 'rewrite_fallback'
  | 'relevance_check'
  | 'audit'
  | 'writer';

/** Tool 名称 */
export type ToolCallName = 'search_knowledge_base';

// ── 运行生命周期 ──

export interface RunStartedEvent {
  type: 'RUN_STARTED';
  runId: string;
  timestamp?: number;
}

export interface RunFinishedEvent {
  type: 'RUN_FINISHED';
  runId: string;
  timestamp?: number;
  /** RAG 模式下的引用来源列表（DB 解析后） */
  citations?: Citation[];
}

export interface RunErrorEvent {
  type: 'RUN_ERROR';
  runId: string;
  error: string;
}

// ── 步骤生命周期 ──

export interface StepStartedEvent {
  type: 'STEP_STARTED';
  stepName: StepName;
  timestamp?: number;
}

export interface StepFinishedEvent {
  type: 'STEP_FINISHED';
  stepName: StepName;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}

// ── 工具调用 ──

export interface ToolCallStartEvent {
  type: 'TOOL_CALL_START';
  toolCallId: string;
  toolCallName: ToolCallName;
  input?: Record<string, unknown>;
}

export interface ToolCallResultEvent {
  type: 'TOOL_CALL_RESULT';
  toolCallId: string;
  toolCallName: ToolCallName;
  output?: Record<string, unknown>;
  durationMs?: number;
}

// ── 文本消息 ──

export interface TextMessageStartEvent {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
}

export interface TextMessageContentEvent {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
}

// ── 联合类型 ──

export type AguiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent;

/** 聚合到消息上的步骤记录（STEP_FINISHED 的快照） */
export interface AguiStepRecord {
  stepName: StepName;
  status: 'running' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  /** 时序编号，用于合并步骤+工具为统一时间线 */
  order?: number;
}

/** 聚合到消息上的工具调用记录（TOOL_CALL_START → RESULT 的完整快照） */
export interface AguiToolCallRecord {
  toolCallId: string;
  toolCallName: ToolCallName;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  status: 'running' | 'completed';
  /** 时序编号，用于合并步骤+工具为统一时间线 */
  order?: number;
}

/** 统一时间线条目（步骤或工具调用） */
export interface TimelineEntry {
  kind: 'step' | 'tool';
  step?: AguiStepRecord;
  tool?: AguiToolCallRecord;
  order: number;
}

// ── 向后兼容类型 ──

/** Agent 工作流阶段（兼容旧组件） */
export type AgentPhase =
  | 'planning'
  | 'retrieving'
  | 'reranking'
  | 'verifying'
  | 'writing'
  | 'done';

/** 引用项 */
export interface Citation {
  /** 1-based 引用编号，对应文中 [来源 N] 的 N */
  index: number;
  citationId: string;
  kbId: string;
  kbName: string;
  docId: string;
  docTitle: string;
  chunkId: string;
  /** 分片内容前 200 字摘要 */
  quote: string;
  /** rerank 分数 */
  score?: number;
  /** 文档类型，用于预览渲染 (pdf / md / txt) */
  fileType?: string;
  /** 原始文件名 */
  fileName?: string;
}

/** Agent 警告（兼容旧组件） */
export interface AgentWarningPart {
  type: 'agent-warning';
  code: 'LOW_CONFIDENCE' | 'PARTIAL_ANSWER' | 'INSUFFICIENT_CONTEXT' | 'USER_CANCELLED';
  message: string;
}

/** 检索进度（兼容旧组件） */
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
