/**
 * AG-UI 协议事件类型定义
 *
 * 参考 AG-UI (Agent-User Interaction Protocol) 标准事件语义，
 * 用于前后端 SSE 流式通信。
 * @see https://docs.ag-ui.com/sdk/js/core/events
 */

import type { Response } from 'express';

/** 基础事件 */
interface BaseEvent {
  type: string;
  timestamp?: number;
}

export interface ModelFallbackInfo {
  used: true;
  reason: 'MODEL_CONFIG_RESOLVE_FAILED';
  requestedModelConfigId?: string;
  requestedModelSource?: string;
  fallbackModelName?: string;
  message: string;
}

// ── 运行生命周期 ──

export interface RunStartedEvent extends BaseEvent {
  type: 'RUN_STARTED';
  runId: string;
  /** 用户选择的模型配置不可用时，后端已回退到系统默认模型 */
  modelFallback?: ModelFallbackInfo;
}

export interface RunFinishedEvent extends BaseEvent {
  type: 'RUN_FINISHED';
  runId: string;
  /** RAG 模式下的引用来源列表（DB 解析后） */
  citations?: CitationData[];
}

export interface RunErrorEvent extends BaseEvent {
  type: 'RUN_ERROR';
  runId: string;
  error: string;
}

// ── 步骤生命周期 ──

export type StepName =
  | 'route'
  | 'decompose'
  | 'rewrite'
  | 'rewrite_fallback'
  | 'relevance_check'
  | 'audit'
  | 'writer';

export interface StepStartedEvent extends BaseEvent {
  type: 'STEP_STARTED';
  stepName: StepName;
}

export interface StepFinishedEvent extends BaseEvent {
  type: 'STEP_FINISHED';
  stepName: StepName;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}

// ── 工具调用 ──

export type ToolCallName = 'search_knowledge_base' | 'web_search';

export interface ToolCallStartEvent extends BaseEvent {
  type: 'TOOL_CALL_START';
  toolCallId: string;
  toolCallName: ToolCallName;
  input?: Record<string, unknown>;
}

export interface ToolCallResultEvent extends BaseEvent {
  type: 'TOOL_CALL_RESULT';
  toolCallId: string;
  toolCallName: ToolCallName;
  output?: Record<string, unknown>;
  durationMs?: number;
}

// ── 文本消息 ──

export interface TextMessageStartEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
}

export interface TextMessageContentEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends BaseEvent {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
}

// ── 校验生命周期 ──

export interface ValidationStartedEvent extends BaseEvent {
  type: 'VALIDATION_STARTED';
}

export interface ValidationCompletedEvent extends BaseEvent {
  type: 'VALIDATION_COMPLETED';
  factCheckRisk?: 'low' | 'medium' | 'high';
  completenessCoverage?: number;
  supplementAdded: boolean;
}

// ── 引用数据 ──

export interface CitationData {
  index: number;
  kbId: string;
  kbName: string;
  docId: string;
  docTitle: string;
  chunkId: string;
  quote: string;
  score: number;
  fileType?: string;
  fileName?: string;
}

/** 所有 AG-UI 事件联合类型 */
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
  | TextMessageEndEvent
  | ValidationStartedEvent
  | ValidationCompletedEvent;

/**
 * SSE 流写入器。
 * 封装原生 Express Response，按 SSE 格式逐条写入 AG-UI 事件。
 */
export class SseWriter {
  private writer: Response;

  constructor(res: Response) {
    this.writer = res;
  }

  write(event: AguiEvent): void {
    this.writer.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    this.writer.end();
  }
}
