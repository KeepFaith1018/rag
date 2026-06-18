import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessageService } from './chat-message.service';
import { ContextManagerService } from './context-manager.service';
import { KbPermissionService } from '../../knowledge-base/permission/kb-permission.service';
import { CitationService } from '../../rag/retrieval/citation.service';
import { MultiAgentOrchestratorService } from './multi-agent-orchestrator.service';
import { WebSearchService } from '../../rag/web-search/web-search.service';
import { ModelConfigResolutionService, type ResolvedModelParams } from './model-config-resolution.service';
import { SseWriter, type ModelFallbackInfo, type ToolCallName } from '../types/agui-events';
import { extractMessageContent } from '@common/utils/message.utils';
import { z } from 'zod';
import type { StreamChatDto } from '../dto/stream-chat.dto';

/** 普通对话系统提示词 */
const SYSTEM_PROMPT = `你是 Linsor AI（灵索智能）的智能助手，一个通用的 AI 对话助手，可以与用户进行各类话题的交流。

对话规则：
- 回答应准确、完整，尽你所能为用户提供有用信息
- 你可以使用联网搜索工具获取最新信息。对于时效性问题或需要最新数据的问题，主动调用工具搜索
- 如果问题超出了你的知识范围且联网搜索也未找到相关信息，如实告知用户，不要编造
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
    private readonly webSearchService: WebSearchService,
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
      } catch (err) {
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
        enableWebSearch: dto.enableWebSearch ?? false,
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
   *
   * 当用户开启联网搜索且服务可用时，模型可自主决策是否调用 web_search 工具：
   * Phase 1 — 非流式 Agent Loop（bindTools + invoke），执行工具调用并发出 TOOL_CALL 事件；
   * Phase 2 — 流式生成最终回答。
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

    const enableToolCalling = dto.enableWebSearch && this.webSearchService.isAvailable();
    let fullContent = '';

    try {
      if (enableToolCalling) {
        const webSearchTool = tool(
          async ({ query }) => {
            const results = await this.webSearchService.search(query, 5);
            return JSON.stringify(results);
          },
          {
            name: 'web_search',
            description:
              '搜索互联网获取最新信息。当需要实时数据、新闻或用户询问的问题需要联网才能回答时使用此工具。',
            schema: z.object({
              query: z.string().describe('搜索查询关键词'),
            }),
          },
        );

        const modelWithTools = this.chatModelService
          .createModel({
            model: resolvedModel?.modelName,
            apiKey: resolvedModel?.apiKey,
            baseURL: resolvedModel?.baseURL,
            temperature: 0.7,
            streaming: false,
          })
          .bindTools([webSearchTool]);

        const agentMessages = [...messages];
        let maxIterations = 3;

        while (maxIterations-- > 0) {
          if (signal?.aborted) break;

          const aiMsg = await modelWithTools.invoke(agentMessages);

          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            agentMessages.push(aiMsg);

            for (const tc of aiMsg.tool_calls) {
              // 非流式 invoke 返回的 tool_call 必有 id，类型标注为可选，此处给兜底
              const toolCallId = tc.id!;
              const startedAt = Date.now();
              writer.write({
                type: 'TOOL_CALL_START',
                toolCallId,
                toolCallName: 'web_search' as ToolCallName,
                input: tc.args as Record<string, unknown>,
              });

              const args = tc.args as { query: string };
              const results = await this.webSearchService.search(args.query, 5);

              writer.write({
                type: 'TOOL_CALL_RESULT',
                toolCallId,
                toolCallName: 'web_search' as ToolCallName,
                output: { resultCount: results.length },
                durationMs: Date.now() - startedAt,
              });

              agentMessages.push(
                new ToolMessage({
                  content: JSON.stringify(results),
                  tool_call_id: toolCallId,
                }),
              );
            }
          } else {
            // 模型产出文本回答，不需要继续循环
            break;
          }
        }

        // Phase 2: 用流式模型基于完整对话历史生成最终回答
        const msgId = `msg_${Date.now()}`;
        writer.write({ type: 'TEXT_MESSAGE_START', messageId: msgId });

        const streamingModel = this.chatModelService.createModel({
          model: resolvedModel?.modelName,
          apiKey: resolvedModel?.apiKey,
          baseURL: resolvedModel?.baseURL,
          temperature: 0.7,
          streaming: true,
        });

        const lcStream = await streamingModel.stream(agentMessages);
        for await (const chunk of lcStream) {
          if (signal?.aborted) break;
          const text = extractMessageContent(chunk);
          if (text) {
            fullContent += text;
            writer.write({ type: 'TEXT_MESSAGE_CONTENT', messageId: msgId, delta: text });
          }
        }

        writer.write({ type: 'TEXT_MESSAGE_END', messageId: msgId });
      } else {
        // 未开启联网搜索：直接流式输出
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
      }

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
