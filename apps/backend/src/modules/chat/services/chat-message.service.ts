import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import type { ChatMessageItem } from '../interfaces/chat-message-item.interface';

export interface CreateUserMessageParams {
  sessionId: string;
  content: string;
  chatMode: string;
  selectedKbIds?: string[];
  resolvedKbIds?: string[];
  modelName?: string | null;
}

export interface CreateAssistantPlaceholderParams {
  sessionId: string;
  chatMode: string;
  traceId?: string;
  modelName?: string | null;
}

@Injectable()
export class ChatMessageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 持久化用户消息。
   */
  async createUserMessage(params: CreateUserMessageParams) {
    try {
      const message = await this.prisma.b_chat_messages.create({
        data: {
          session_id: params.sessionId,
          role: 'user',
          content: params.content,
          chat_mode: params.chatMode,
          selected_kb_ids_json: params.selectedKbIds ?? [],
          resolved_kb_ids_json: params.resolvedKbIds ?? [],
          model_name: params.modelName,
        },
      });

      // 更新会话最近消息时间与模式回显信息
      await this.prisma.b_chat_sessions.update({
        where: { id: params.sessionId },
        data: {
          last_chat_mode: params.chatMode,
          last_selected_kb_ids_json:
            params.selectedKbIds ?? [],
          last_message_at: new Date(),
          updated_at: new Date(),
        },
      });

      return message;
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatMessageService',
          action: 'createUserMessage',
          sessionId: params.sessionId,
        },
      });
    }
  }

  /**
   * 创建助手占位消息，流式输出开始前调用。
   */
  async createAssistantPlaceholder(params: CreateAssistantPlaceholderParams) {
    try {
      return await this.prisma.b_chat_messages.create({
        data: {
          session_id: params.sessionId,
          role: 'assistant',
          content: '',
          message_status: 'streaming',
          chat_mode: params.chatMode,
          model_name: params.modelName,
          trace_id: params.traceId,
          stream_started_at: new Date(),
        },
      });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatMessageService',
          action: 'createAssistantPlaceholder',
          sessionId: params.sessionId,
        },
      });
    }
  }

  /**
   * 流式输出完成后更新助手消息最终内容。
   */
  async finalizeAssistantMessage(
    messageId: bigint,
    data: {
      content: string;
      tokensUsed?: number;
      finishReason?: string;
    },
  ) {
    try {
      await this.prisma.b_chat_messages.update({
        where: { id: messageId },
        data: {
          content: data.content,
          tokens_used: data.tokensUsed ?? 0,
          finish_reason: data.finishReason ?? 'stop',
          message_status: 'completed',
          stream_finished_at: new Date(),
        },
      });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatMessageService',
          action: 'finalizeAssistantMessage',
          messageId: messageId.toString(),
        },
      });
    }
  }

  /**
   * 标记助手消息为中断状态。
   */
  async markAssistantMessageAborted(messageId: bigint) {
    try {
      await this.prisma.b_chat_messages.update({
        where: { id: messageId },
        data: {
          message_status: 'aborted',
          finish_reason: 'abort',
          stream_finished_at: new Date(),
        },
      });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatMessageService',
          action: 'markAssistantMessageAborted',
          messageId: messageId.toString(),
        },
      });
    }
  }

  /**
   * 查询会话消息历史。
   */
  async listMessages(
    sessionId: string,
    options?: { page?: number; pageSize?: number },
  ) {
    try {
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? 50;
      const skip = (page - 1) * pageSize;

      const [messages, total] = await this.prisma.$transaction([
        this.prisma.b_chat_messages.findMany({
          where: { session_id: sessionId },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          skip,
          take: pageSize,
        }),
        this.prisma.b_chat_messages.count({
          where: { session_id: sessionId },
        }),
      ]);

      return {
        list: messages.map((m) => this.toMessageItem(m)),
        total,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatMessageService',
          action: 'listMessages',
          sessionId,
        },
      });
    }
  }

  private toMessageItem(m: {
    id: bigint;
    role: string;
    content: string;
    references: unknown;
    tool_calls: unknown;
    tokens_used: number | null;
    message_status: string;
    model_name: string | null;
    finish_reason: string | null;
    chat_mode: string | null;
    selected_kb_ids_json: unknown;
    resolved_kb_ids_json: unknown;
    feedback_type: string | null;
    created_at: Date;
  }): ChatMessageItem {
    return {
      id: m.id.toString(),
      role: m.role as ChatMessageItem['role'],
      content: m.content,
      references: m.references,
      toolCalls: m.tool_calls,
      tokensUsed: m.tokens_used,
      messageStatus: m.message_status,
      modelName: m.model_name,
      finishReason: m.finish_reason,
      chatMode: m.chat_mode,
      selectedKbIds: m.selected_kb_ids_json,
      resolvedKbIds: m.resolved_kb_ids_json,
      feedbackType: m.feedback_type,
      createdAt: m.created_at.toISOString(),
    };
  }
}
