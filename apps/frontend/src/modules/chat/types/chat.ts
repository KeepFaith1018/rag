/**
 * 聊天消息类型定义
 */

/** 消息角色 */
export type MessageRole = 'ai' | 'user';

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
  id: number;
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
}

/** 消息状态 */
export type MessageStatus =
  | 'pending'
  | 'streaming'
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
  metadata?: Record<string, unknown>;
}

/** 知识库选项 */
export interface KbOption {
  kbId: string;
  kbName: string;
  permission: 'owner' | 'manager' | 'collaborator' | 'member' | 'publicVisitor';
}

/** 模型配置选项 */
export interface ModelOption {
  configId: string;
  modelName: string;
  provider: string;
  source: ModelSource;
}
