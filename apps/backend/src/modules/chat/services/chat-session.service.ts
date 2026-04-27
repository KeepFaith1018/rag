import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CreateChatSessionDto } from '../dto/create-chat-session.dto';
import { ListChatSessionsDto } from '../dto/list-chat-sessions.dto';
import { RenameChatSessionDto } from '../dto/rename-chat-session.dto';
import type { ChatSessionSummary } from '../interfaces/chat-session-summary.interface';

@Injectable()
export class ChatSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建新会话，返回会话摘要信息。
   */
  async create(
    userId: number,
    dto: CreateChatSessionDto,
  ): Promise<ChatSessionSummary> {
    try {
      const session = await this.prisma.b_chat_sessions.create({
        data: {
          id: randomUUID(),
          user_id: BigInt(userId),
          title: dto.title?.trim() || '新会话',
        },
      });

      return this.toSummary(session);
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatSessionService',
          action: 'create',
          userId,
        },
      });
    }
  }

  /**
   * 获取当前用户的会话列表，按最近更新时间倒序。
   */
  async list(
    userId: number,
    query: ListChatSessionsDto,
  ): Promise<{ list: ChatSessionSummary[]; total: number }> {
    try {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const skip = (page - 1) * pageSize;

      const [sessions, total] = await this.prisma.$transaction([
        this.prisma.b_chat_sessions.findMany({
          where: { user_id: BigInt(userId) },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          skip,
          take: pageSize,
        }),
        this.prisma.b_chat_sessions.count({
          where: { user_id: BigInt(userId) },
        }),
      ]);

      return {
        list: sessions.map((s) => this.toSummary(s)),
        total,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatSessionService',
          action: 'list',
          userId,
        },
      });
    }
  }

  /**
   * 获取会话详情，含归属校验。
   */
  async getDetail(userId: number, sessionId: string) {
    try {
      const session = await this.prisma.b_chat_sessions.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND);
      }

      if (session.user_id !== BigInt(userId)) {
        throw new BusinessException(ErrorCode.CONVERSATION_UNAUTHORIZED);
      }

      return {
        ...this.toSummary(session),
        kbId: session.kb_id?.toString() ?? null,
        summaryText: session.summary_text,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatSessionService',
          action: 'getDetail',
          userId,
          sessionId,
        },
      });
    }
  }

  /**
   * 重命名会话。
   */
  async rename(
    userId: number,
    sessionId: string,
    dto: RenameChatSessionDto,
  ): Promise<void> {
    try {
      const session = await this.prisma.b_chat_sessions.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND);
      }

      if (session.user_id !== BigInt(userId)) {
        throw new BusinessException(ErrorCode.CONVERSATION_UNAUTHORIZED);
      }

      await this.prisma.b_chat_sessions.update({
        where: { id: sessionId },
        data: {
          title: dto.title.trim(),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'ChatSessionService',
          action: 'rename',
          userId,
          sessionId,
        },
      });
    }
  }

  /**
   * 验证会话归属权，会话不存在或不属于当前用户时抛出异常。
   */
  async assertSessionOwnership(
    userId: number,
    sessionId: string,
  ): Promise<void> {
    const session = await this.prisma.b_chat_sessions.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND);
    }

    if (session.user_id !== BigInt(userId)) {
      throw new BusinessException(ErrorCode.CONVERSATION_UNAUTHORIZED);
    }
  }

  private toSummary(session: {
    id: string;
    title: string;
    last_chat_mode: string | null;
    last_message_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): ChatSessionSummary {
    return {
      id: session.id,
      title: session.title,
      lastChatMode: session.last_chat_mode,
      lastMessageAt: session.last_message_at?.toISOString() ?? null,
      createdAt: session.created_at.toISOString(),
      updatedAt: session.updated_at.toISOString(),
    };
  }
}
