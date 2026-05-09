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
  Headers,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@common/guards/auth.guard';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { SkipResponseTransform } from '@common/decorators/skip-response-transform.decorator';
import { StreamRateLimitGuard } from '@common/guards/rate-limit.guard';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { ChatStreamService } from './services/chat-stream.service';
import { SseWriter } from './types/agui-events';
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
   * 使用 AG-UI 协议通过原生 SSE 推送事件。
   * 事件序列: RUN_STARTED → STEP/TEXT/TOOL 事件 → RUN_FINISHED
   */
  @Post('stream')
  @UseGuards(AuthGuard, StreamRateLimitGuard)
  @Auth()
  @SkipResponseTransform()
  // eslint-disable-next-line @typescript-eslint/require-await
  async streamChat(
    @CurrentUser('sub') userId: string,
    @Body() dto: StreamChatDto,
    @Res({ passthrough: false }) res: Response,
    @Headers('x-user-api-key') userApiKey?: string,
    @Headers('x-user-model') userModel?: string,
    @Headers('x-user-base-url') userBaseUrl?: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 客户端断开连接时取消服务端处理
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const writer = new SseWriter(res);
    void this.chatStreamService
      .streamChat(Number(userId), dto, writer, abortController.signal, {
        userApiKey,
        userModel,
        userBaseUrl,
      })
      .catch((err) => {
        writer.write({
          type: 'RUN_ERROR',
          runId: 'unknown',
          error: err instanceof Error ? err.message : String(err),
        });
        writer.end();
      });
  }
}
