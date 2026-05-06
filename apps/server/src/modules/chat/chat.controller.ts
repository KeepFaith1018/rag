import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeUIMessageStreamToResponse } from 'ai';
import { AuthGuard } from '@common/guards/auth.guard';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { SkipResponseTransform } from '@common/decorators/skip-response-transform.decorator';
import { StreamRateLimitGuard } from '@common/guards/rate-limit.guard';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { ChatStreamService } from './services/chat-stream.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { ListChatSessionsDto } from './dto/list-chat-sessions.dto';
import { StreamChatDto } from './dto/stream-chat.dto';
import { RenameChatSessionDto } from './dto/rename-chat-session.dto';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly chatMessageService: ChatMessageService,
    private readonly chatStreamService: ChatStreamService,
  ) {}

  /** 创建新会话 */
  @Post('sessions')
  @UseGuards(AuthGuard)
  @Auth()
  createSession(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateChatSessionDto,
  ) {
    return this.chatSessionService.create(Number(userId), dto);
  }

  /** 获取会话列表 */
  @Get('sessions')
  @UseGuards(AuthGuard)
  @Auth()
  listSessions(
    @CurrentUser('sub') userId: string,
    @Query() query: ListChatSessionsDto,
  ) {
    return this.chatSessionService.list(Number(userId), query);
  }

  /** 获取会话详情 */
  @Get('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @Auth()
  getSessionDetail(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.chatSessionService.getDetail(Number(userId), sessionId);
  }

  /** 重命名会话 */
  @Patch('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @Auth()
  renameSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: RenameChatSessionDto,
  ) {
    return this.chatSessionService.rename(Number(userId), sessionId, dto);
  }

  /** 删除会话 */
  @Delete('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @Auth()
  async deleteSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    await this.chatSessionService.remove(Number(userId), sessionId);
  }

  /** 查询会话消息列表 */
  @Get('sessions/:sessionId/messages')
  @UseGuards(AuthGuard)
  @Auth()
  listMessages(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.chatSessionService
      .assertSessionOwnership(Number(userId), sessionId)
      .then(() =>
        this.chatMessageService.listMessages(sessionId, {
          page: page ? Number(page) : undefined,
          pageSize: pageSize ? Number(pageSize) : undefined,
        }),
      );
  }

  /**
   * 流式对话（SSE）
   *
   * 使用 @ai-sdk/langchain + AI SDK data stream 协议，
   * 由 pipeUIMessageStreamToResponse 自动处理响应头、
   * 流式内容编码与连接关闭。
   */
  @Post('stream')
  @UseGuards(AuthGuard, StreamRateLimitGuard)
  @Auth()
  @SkipResponseTransform()
  async streamChat(
    @CurrentUser('sub') userId: string,
    @Body() dto: StreamChatDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const stream = await this.chatStreamService.streamChat(
      Number(userId),
      dto,
    );
    pipeUIMessageStreamToResponse({ response: res, stream });
  }
}
