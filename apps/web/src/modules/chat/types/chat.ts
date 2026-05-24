/**
 * 聊天消息类型定义
 */

import type { ParsedBlock } from '@incremark/core'
import type { AguiStepRecord, AguiToolCallRecord, Citation } from './stream';

/** 可渲染的块类型（兼容 DisplayBlock 的 displayNode 字段） */
export interface RenderableBlock {
  id: string;
  node: ParsedBlock['node'];
  status: string;
  displayNode?: ParsedBlock['node'];
  progress?: number;
  isDisplayComplete?: boolean;
}

/** 消息角色 */
export type MessageRole = 'ai' | 'user' | 'assistant';

/** 聊天模式 */
export type ChatMode = 'chat' | 'rag';

/** 模型来源 */
export type ModelSource = 'system' | 'user';

/** 会话摘要 */
export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  summaryText?: string;
  lastSelectedKbIds?: string[];
  lastChatMode?: ChatMode;
  lastMessageAt?: string;
}

/** 消息项 */
export interface ChatMessageItem {
  id: string | number;
  role: MessageRole;
  name: string;
  content: string;
  createdAt: string;
  messageStatus?: MessageStatus;
  chatMode?: ChatMode;
  modelSource?: ModelSource;
  modelConfigId?: string;
  modelName?: string;
  selectedKbIds?: string[];
  traceId?: string;
  /** HTML 内容（流式渲染时累积） */
  htmlContent?: string;
  /** AG-UI 步骤记录（流式完成时从 store 快照到消息） */
  aguiSteps?: AguiStepRecord[];
  /** AG-UI 工具调用记录 */
  aguiToolCalls?: AguiToolCallRecord[];
  /** 增量 Markdown 解析块（Incremark AST），支持 ParsedBlock 和 DisplayBlock */
  blocks?: ParsedBlock[] | RenderableBlock[]
  /** RAG 模式引用来源列表 */
  citations?: Citation[]
  /** 后端 b_chat_messages.references JSON 字段 */
  references?: Citation[]
}

/** 消息状态 */
export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'validating'     // 回答生成完毕，正在校验
  | 'supplementing'  // 正在补充内容
  | 'completed'
  | 'aborted'
  | 'error';

/** 创建会话请求 */
export interface CreateChatSessionRequest {
  title?: string;
}

/** 流式聊天请求 */
export interface StreamChatRequest {
  sessionId: string;
  chatMode: ChatMode;
  message: string;
  modelSource?: ModelSource;
  modelConfigId?: string;
  selectedKbIds?: string[];
  agentMode?: 'multi-agent';
  enableWebSearch?: boolean;
  metadata?: Record<string, unknown>;
}

/** 知识库选项 */
export interface KbOption {
  kbId: string;
  kbName: string;
  permission: 'owner' | 'manager' | 'collaborator' | 'member' | 'publicVisitor';
  visibility?: 'private' | 'shared';
  isPublic?: boolean;
}

/** 模型配置选项 */
export interface ModelOption {
  configId: string;
  modelName: string;
  provider: string;
  source: ModelSource;
}
