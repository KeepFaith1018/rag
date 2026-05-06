import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessageService } from './chat-message.service';
import { KbPermissionService } from '../../knowledge-base/permission/kb-permission.service';
import { CitationService } from '../../rag/retrieval/citation.service';
import { MultiAgentOrchestratorService } from './multi-agent-orchestrator.service';
import { SseWriter } from '../types/agui-events';
import type { StreamChatDto } from '../dto/stream-chat.dto';

/** 普通对话系统提示词 */
const SYSTEM_PROMPT = `你是 Linsor AI（灵索智能）的智能助手，基于知识库为用户提供专业、准确的问答服务。

对话规则：
- 回答应准确、完整，基于上下文给出有用信息
- 若问题涉及特定知识库内容但当前未检索到上下文，如实告知用户
- 使用中文回答`;

function extractChunkText(chunk: AIMessageChunk): string {
  if (typeof chunk.content === 'string') return chunk.content;
  if (Array.isArray(chunk.content)) {
    return chunk.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  }
  return '';
}

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly chatMessageService: ChatMessageService,
    private readonly chatModelService: ChatModelService,
    private readonly kbPermissionService: KbPermissionService,
    private readonly citationService: CitationService,
    private readonly orchestrator: MultiAgentOrchestratorService,
  ) {}

  /**
   * 处理流式对话请求，通过 SseWriter 推送 AG-UI 事件。
   *
   * 普通对话模式：系统提示 + 用户消息 → LLM 流式输出。
   * RAG 模式：权限校验 → MultiAgentOrchestrator 执行完整 Agentic RAG
   *   工作流（Route → Rewrite → Retrieve → Writer），
   *   中间步骤和工具调用通过 AG-UI 事件实时推送。
   */
  async streamChat(
    userId: number,
    dto: StreamChatDto,
    writer: SseWriter,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.chatSessionService.assertSessionOwnership(userId, dto.sessionId);

    const modelName = this.chatModelService.getDefaultModelName();
    const traceId = randomUUID();

    if (dto.chatMode === 'rag' && dto.selectedKbIds?.length) {
      return this.streamRagMode(userId, dto, modelName, traceId, writer, signal);
    }

    return this.streamChatMode(userId, dto, modelName, traceId, writer);
  }

  /**
   * RAG 模式：权限校验 → Agent 工作流 → AG-UI 事件流推送。
   */
  private async streamRagMode(
    userId: number,
    dto: StreamChatDto,
    modelName: string,
    traceId: string,
    writer: SseWriter,
    signal?: AbortSignal,
  ): Promise<void> {
    const permContexts = await this.kbPermissionService.authorizeMany(
      userId,
      dto.selectedKbIds!,
      'ask',
    );
    const resolvedKbIds = permContexts.map((c) => c.kbId);

    const userMsg = await this.chatMessageService.createUserMessage({
      sessionId: dto.sessionId,
      content: dto.message,
      chatMode: dto.chatMode,
      selectedKbIds: dto.selectedKbIds,
      resolvedKbIds,
      modelName,
    });

    const assistantMessage =
      await this.chatMessageService.createAssistantPlaceholder({
        sessionId: dto.sessionId,
        chatMode: dto.chatMode,
        traceId,
        modelName,
      });

    await this.orchestrator.streamRun(
      {
        sessionId: dto.sessionId,
        userId,
        userMessageId: String(userMsg.id),
        assistantMessageId: String(assistantMessage.id),
        chatMode: dto.chatMode,
        selectedKbIds: dto.selectedKbIds!,
        resolvedKbIds,
        originalQuery: dto.message,
      },
      writer,
      {
        enableWebSearch: dto.enableWebSearch ?? false,
        signal,
        onFinish: async (result) => {
          if (result.citations && result.citations.length > 0) {
            await this.citationService.createCitations({
              messageId: assistantMessage.id,
              hits: result.citations,
            });
          }
          await this.chatMessageService.finalizeAssistantMessage(
            assistantMessage.id,
            { content: result.content, finishReason: 'stop' },
          );
          await this.chatSessionService.summarizeTitleIfNeeded(
            dto.sessionId,
            dto.message,
            result.content,
          );
        },
        onError: async () => {
          await this.chatMessageService.markAssistantMessageAborted(
            assistantMessage.id,
          );
        },
      },
    );
  }

  /**
   * 普通对话模式：LLM 流式输出，封装为 AG-UI 文本事件。
   */
  private async streamChatMode(
    _userId: number,
    dto: StreamChatDto,
    modelName: string,
    traceId: string,
    writer: SseWriter,
  ): Promise<void> {
    const model = this.chatModelService.createModel({
      temperature: 0.7,
      streaming: true,
    });

    await this.chatMessageService.createUserMessage({
      sessionId: dto.sessionId,
      content: dto.message,
      chatMode: dto.chatMode,
      modelName,
    });

    const assistantMessage =
      await this.chatMessageService.createAssistantPlaceholder({
        sessionId: dto.sessionId,
        chatMode: dto.chatMode,
        traceId,
        modelName,
      });

    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(dto.message),
    ];

    writer.write({ type: 'RUN_STARTED', runId: traceId, timestamp: Date.now() });
    const msgId = `msg_${Date.now()}`;
    writer.write({ type: 'TEXT_MESSAGE_START', messageId: msgId });

    const lcStream = await model.stream(messages);
    let fullContent = '';

    try {
      for await (const chunk of lcStream) {
        const text = extractChunkText(chunk);
        if (text) {
          fullContent += text;
          writer.write({ type: 'TEXT_MESSAGE_CONTENT', messageId: msgId, delta: text });
        }
      }

      writer.write({ type: 'TEXT_MESSAGE_END', messageId: msgId });
      writer.write({ type: 'RUN_FINISHED', runId: traceId });

      await this.chatMessageService.finalizeAssistantMessage(
        assistantMessage.id,
        { content: fullContent, finishReason: 'stop' },
      );
      await this.chatSessionService.summarizeTitleIfNeeded(
        dto.sessionId,
        dto.message,
        fullContent,
      );
    } catch (error) {
      writer.write({
        type: 'RUN_ERROR',
        runId: traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.chatMessageService.markAssistantMessageAborted(
        assistantMessage.id,
      );
    } finally {
      writer.end();
    }
  }
}
