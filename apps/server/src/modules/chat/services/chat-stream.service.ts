import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { toUIMessageStream } from '@ai-sdk/langchain';
import type { UIMessageChunk } from 'ai';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessageService } from './chat-message.service';
import { KbPermissionService } from '../../knowledge-base/permission/kb-permission.service';
import { CitationService } from '../../rag/retrieval/citation.service';
import { MultiAgentOrchestratorService } from './multi-agent-orchestrator.service';
import type { StreamChatDto } from '../dto/stream-chat.dto';

/** 普通对话系统提示词 */
const SYSTEM_PROMPT = `你是 Linsor AI（灵索智能）的智能助手，基于知识库为用户提供专业、准确的问答服务。

对话规则：
- 回答应准确、完整，基于上下文给出有用信息
- 若问题涉及特定知识库内容但当前未检索到上下文，如实告知用户
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
  ) {}

  /**
   * 处理流式对话请求。
   *
   * 普通对话模式：系统提示 + 用户消息 → LLM 流式输出。
   * RAG 模式：权限校验 → MultiAgentOrchestrator 执行完整 Agentic RAG
   *   工作流（Route → Rewrite → Decompose → Retrieve → Relevance →
   *   Draft → Fact Check → Completeness Check → Finalize），
   *   最终结果通过 AI SDK data stream 格式返回。
   */
  async streamChat(
    userId: number,
    dto: StreamChatDto,
  ): Promise<ReadableStream<UIMessageChunk>> {
    // 1. 校验会话归属
    await this.chatSessionService.assertSessionOwnership(userId, dto.sessionId);

    const modelName = this.chatModelService.getDefaultModelName();
    const traceId = randomUUID();

    // ── RAG 模式：多 Agent 工作流 ──
    if (dto.chatMode === 'rag' && dto.selectedKbIds?.length) {
      return this.streamRagMode(userId, dto, modelName, traceId);
    }

    // ── 普通对话模式 ──
    return this.streamChatMode(userId, dto, modelName, traceId);
  }

  /**
   * RAG 模式流式处理：
   * 权限校验 → Agent 工作流 → 流式返回最终答案。
   */
  private async streamRagMode(
    userId: number,
    dto: StreamChatDto,
    modelName: string,
    traceId: string,
  ): Promise<ReadableStream<UIMessageChunk>> {
    // 批量鉴权
    const permContexts = await this.kbPermissionService.authorizeMany(
      userId,
      dto.selectedKbIds!,
      'ask',
    );
    const resolvedKbIds = permContexts.map((c) => c.kbId);

    // 持久化用户消息
    const userMsg = await this.chatMessageService.createUserMessage({
      sessionId: dto.sessionId,
      content: dto.message,
      chatMode: dto.chatMode,
      selectedKbIds: dto.selectedKbIds,
      resolvedKbIds,
      modelName,
    });

    // 创建助手占位消息
    const assistantMessage =
      await this.chatMessageService.createAssistantPlaceholder({
        sessionId: dto.sessionId,
        chatMode: dto.chatMode,
        traceId,
        modelName,
      });

    // 执行流式 Agentic RAG 工作流，直接返回 AI SDK data stream
    return this.orchestrator.streamRun(
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
      {
        onFinish: async (result) => {
          // 持久化引用
          if (result.citations && result.citations.length > 0) {
            await this.citationService.createCitations({
              messageId: assistantMessage.id,
              hits: result.citations,
            });
          }
          // 持久化回答
          await this.chatMessageService.finalizeAssistantMessage(
            assistantMessage.id,
            { content: result.content, finishReason: 'stop' },
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
   * 普通对话模式流式处理。
   */
  private async streamChatMode(
    _userId: number,
    dto: StreamChatDto,
    modelName: string,
    traceId: string,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const model = this.chatModelService.createModel({
      temperature: 0.7,
      streaming: true,
    });

    // 持久化用户消息
    await this.chatMessageService.createUserMessage({
      sessionId: dto.sessionId,
      content: dto.message,
      chatMode: dto.chatMode,
      modelName,
    });

    // 创建助手占位
    const assistantMessage =
      await this.chatMessageService.createAssistantPlaceholder({
        sessionId: dto.sessionId,
        chatMode: dto.chatMode,
        traceId,
        modelName,
      });

    // 构建消息
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(dto.message),
    ];

    // LLM 流式输出
    const lcStream = await model.stream(messages);

    let fullContent = '';

    async function* accumulateStream(
      source: AsyncIterable<AIMessageChunk>,
    ): AsyncIterable<AIMessageChunk> {
      for await (const chunk of source) {
        const text =
          typeof chunk.content === 'string'
            ? chunk.content
            : Array.isArray(chunk.content)
              ? chunk.content
                  .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                  .map((c) => c.text)
                  .join('')
              : '';
        fullContent += text;
        yield chunk;
      }
    }

    return toUIMessageStream(accumulateStream(lcStream), {
      onFinish: async () => {
        await this.chatMessageService.finalizeAssistantMessage(
          assistantMessage.id,
          { content: fullContent, finishReason: 'stop' },
        );
      },
      onError: async () => {
        await this.chatMessageService.markAssistantMessageAborted(
          assistantMessage.id,
        );
      },
      onAbort: async () => {
        await this.chatMessageService.markAssistantMessageAborted(
          assistantMessage.id,
        );
      },
    });
  }
}
