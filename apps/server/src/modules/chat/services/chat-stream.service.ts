import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessageService } from './chat-message.service';
import { ContextManagerService } from './context-manager.service';
import { KbPermissionService } from '../../knowledge-base/permission/kb-permission.service';
import { CitationService } from '../../rag/retrieval/citation.service';
import { MultiAgentOrchestratorService } from './multi-agent-orchestrator.service';
import { ModelConfigResolutionService, type ResolvedModelParams } from './model-config-resolution.service';
import { SseWriter, type ModelFallbackInfo } from '../types/agui-events';
import { extractMessageContent } from '@common/utils/message.utils';
import type { StreamChatDto } from '../dto/stream-chat.dto';

/** 普通对话系统提示词 */
const SYSTEM_PROMPT = `你是 Linsor AI（灵索智能）的智能助手，一个通用的 AI 对话助手，可以与用户进行各类话题的交流。

对话规则：
- 回答应准确、完整，尽你所能为用户提供有用信息
- 如果问题超出了你的知识范围，如实告知用户，不要编造
- 使用中文回答`;

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly chatMessageService: ChatMessageService,
    private readonly chatModelService: ChatModelService,
    private readonly kbPermissionService: KbPermissionService,
    private readonly citationService: CitationService,
    private readonly orchestrator: MultiAgentOrchestratorService,
    private readonly modelResolutionService: ModelConfigResolutionService,
    private readonly contextManager: ContextManagerService,
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
    resolvedModel?: ResolvedModelParams,
    modelFallback?: ModelFallbackInfo,
  ): Promise<void> {
    await this.chatSessionService.assertSessionOwnership(userId, dto.sessionId);

    // 若前端传了 modelConfigId 但上方未预解析，在此自行解析
    if (!resolvedModel && dto.modelConfigId && dto.modelSource && !modelFallback) {
      try {
        resolvedModel = await this.modelResolutionService.resolve(
          userId,
          dto.modelConfigId,
          dto.modelSource as 'system' | 'user',
        );
      } catch {
        modelFallback = {
          used: true,
          reason: 'MODEL_CONFIG_RESOLVE_FAILED',
          requestedModelConfigId: dto.modelConfigId,
          requestedModelSource: dto.modelSource,
          message: '所选模型配置不可用，已切换为系统默认模型。',
        };
      }
    }

    const modelName = resolvedModel?.modelName || this.chatModelService.getDefaultModelName();
    if (modelFallback && !modelFallback.fallbackModelName) {
      modelFallback = { ...modelFallback, fallbackModelName: modelName };
    }
    const traceId = randomUUID();

    if (dto.chatMode === 'rag' && dto.selectedKbIds?.length) {
      return this.streamRagMode(
        userId,
        dto,
        modelName,
        traceId,
        writer,
        signal,
        resolvedModel,
        modelFallback,
      );
    }

    return this.streamChatMode(
      userId,
      dto,
      modelName,
      traceId,
      writer,
      signal,
      resolvedModel,
      modelFallback,
    );
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
    resolvedModel?: ResolvedModelParams,
    modelFallback?: ModelFallbackInfo,
  ): Promise<void> {
    const permContexts = await this.kbPermissionService.authorizeMany(
      userId,
      dto.selectedKbIds!,
      'ask',
    );
    const resolvedKbIds = permContexts.map((c) => c.kbId);

    const chatHistory = await this.contextManager.buildContext(dto.sessionId);

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
        chatHistory,
      },
      writer,
      {
        signal,
        modelOptions: resolvedModel,
        modelFallback,
        onFinish: async (result) => {
          const tasks: Promise<unknown>[] = [];
          let citationRecords: import('../../rag/retrieval/citation.service').CitationRecord[] = [];

          if (result.citations && result.citations.length > 0) {
            citationRecords = await this.citationService.createCitations({
              messageId: assistantMessage.id,
              hits: result.citations,
            });
          }

          tasks.push(
            this.chatMessageService.finalizeAssistantMessage(
              assistantMessage.id,
              {
                content: result.content,
                finishReason: 'stop',
                references: citationRecords.length > 0 ? citationRecords : undefined,
              },
            ),
          );

          // 摘要失败不影响主流程，独立 catch
          tasks.push(
            this.chatSessionService
              .summarizeTitleIfNeeded(
                dto.sessionId,
                dto.message,
                result.content,
              )
              .catch(() => {
                /* 摘要生成失败不影响主流程 */
              }),
          );

          await Promise.all(tasks);

          return {
            citations: citationRecords.map((c) => ({
              index: c.index,
              citationId: c.citationId,
              kbId: c.kbId,
              kbName: c.kbName ?? '',
              docId: c.docId,
              docTitle: c.docTitle ?? '',
              chunkId: c.chunkId,
              quote: c.quote,
              score: c.score,
              fileType: c.fileType,
              fileName: c.fileName,
            })),
          };
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
    signal?: AbortSignal,
    resolvedModel?: ResolvedModelParams,
    modelFallback?: ModelFallbackInfo,
  ): Promise<void> {
    const model = this.chatModelService.createModel({
      model: resolvedModel?.modelName,
      apiKey: resolvedModel?.apiKey,
      baseURL: resolvedModel?.baseURL,
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

    const chatHistory = await this.contextManager.buildContext(dto.sessionId);

    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      ...chatHistory,
      new HumanMessage(dto.message),
    ];

    writer.write({
      type: 'RUN_STARTED',
      runId: traceId,
      timestamp: Date.now(),
      modelFallback,
    });

    let fullContent = '';

    try {
      const msgId = `msg_${Date.now()}`;
      writer.write({ type: 'TEXT_MESSAGE_START', messageId: msgId });

      const lcStream = await model.stream(messages);
      for await (const chunk of lcStream) {
        if (signal?.aborted) break;
        const text = extractMessageContent(chunk);
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
