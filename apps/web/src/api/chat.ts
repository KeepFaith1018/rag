/**
 * 聊天模块 API
 */
import { apiRequest, apiRequestStream } from './api';
import type {
  ChatSessionSummary,
  ChatMessageItem,
  CreateChatSessionRequest,
  StreamChatRequest,
} from '@/modules/chat/types/chat';

/**
 * 创建会话
 */
export async function createChatSession(
  payload: CreateChatSessionRequest,
): Promise<ChatSessionSummary> {
  return apiRequest({
    url: '/chat/sessions',
    method: 'POST',
    body: payload,
  });
}

/**
 * 获取会话列表（分页）
 */
export async function listChatSessions(params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ list: ChatSessionSummary[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiRequest({
    url: `/chat/sessions${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
}

/**
 * 获取会话详情
 */
export async function getChatSession(
  sessionId: string,
): Promise<ChatSessionSummary> {
  return apiRequest({
    url: `/chat/sessions/${sessionId}`,
    method: 'GET',
  });
}

/**
 * 获取会话消息列表
 */
export async function listChatMessages(
  sessionId: string,
): Promise<{ list: ChatMessageItem[]; total: number }> {
  return apiRequest({
    url: `/chat/sessions/${sessionId}/messages`,
    method: 'GET',
  });
}

/**
 * 重命名会话
 */
export async function renameChatSession(
  sessionId: string,
  title: string,
): Promise<void> {
  return apiRequest({
    url: `/chat/sessions/${sessionId}`,
    method: 'PATCH',
    body: { title },
  });
}

/**
 * 删除会话
 */
export async function deleteChatSession(sessionId: string): Promise<void> {
  return apiRequest({
    url: `/chat/sessions/${sessionId}`,
    method: 'DELETE',
  });
}

/**
 * 获取当前用户可用的知识库列表（用于 RAG 模式选择）
 */
export async function listAvailableKbs(): Promise<
  Array<{
    kbId: string;
    kbName: string;
    permission: string;
    visibility?: 'private' | 'shared';
    isPublic?: boolean;
  }>
> {
  return apiRequest({
    url: '/knowledge-base/members/my-kbs',
    method: 'GET',
  });
}

/**
 * 获取当前用户可用的模型配置列表
 */
export async function listAvailableModels(): Promise<
  Array<{
    configId: string;
    modelName: string;
    provider: string;
    source: 'system' | 'user';
  }>
> {
  return apiRequest({
    url: '/ai/model-configs',
    method: 'GET',
  });
}

/**
 * 流式聊天请求（返回 ReadableStream）。
 * 该函数返回原始 fetch Response 对象，由 useAgentChat 负责解析。
 */
export async function fetchChatStream(
  request: StreamChatRequest,
  signal?: AbortSignal,
  options?: { headers?: Record<string, string> },
): Promise<Response> {
  return apiRequestStream({
    url: '/chat/stream',
    method: 'POST',
    body: request,
    signal,
    headers: options?.headers,
  });
}
