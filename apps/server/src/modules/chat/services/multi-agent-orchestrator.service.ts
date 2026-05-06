import { Injectable, Inject } from '@nestjs/common';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RetrievalService } from '../../rag/retrieval/retrieval.service';
import { WebSearchService } from '../../rag/web-search/web-search.service';
import { AgentTraceService } from './agent-trace.service';
import type { AgentRunContext } from './agent-trace.service';
import type { WebSearchResult } from '../../rag/web-search/web-search.service';
import { SseWriter } from '../types/agui-events';

import type { RerankedHit } from '../../rag/retrieval/interfaces/reranked-hit.interface';
import { RoutedQueryPlanSchema } from '../schemas/routed-query-plan.schema';
import type { RoutedQueryPlan } from '../schemas/routed-query-plan.schema';
import { RewriteOutputSchema } from '../schemas/rewritten-query.schema';
import type { RewriteOutput } from '../schemas/rewritten-query.schema';
import { ROUTER_SYSTEM_PROMPT } from '../prompts/router.prompt';
import { REWRITE_SYSTEM_PROMPT } from '../prompts/rewrite.prompt';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';
import { AUDIT_SYSTEM_PROMPT } from '../prompts/audit.prompt';
import { DECOMPOSE_SYSTEM_PROMPT } from '../prompts/decompose.prompt';
import { AuditResultSchema } from '../schemas/audit-result.schema';
import type { AuditResult } from '../schemas/audit-result.schema';
import { DecomposeOutputSchema } from '../schemas/decomposed-query.schema';
import type { DecomposeOutput } from '../schemas/decomposed-query.schema';

/** ═══════════════════════════════════════════
 * Agent State
 * ═══════════════════════════════════════════ */

const AgentStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  userId: Annotation<number>(),
  originalQuery: Annotation<string>(),
  selectedKbIds: Annotation<string[]>(),
  resolvedKbIds: Annotation<string[]>(),
  routedPlan: Annotation<RoutedQueryPlan | null>(),
  /** Decompose 节点拆解出的子问题查询文本（仅对比/研究类） */
  decomposedQueries: Annotation<string[]>(),
  rewrittenQueries: Annotation<string[]>(),
  rerankedHits: Annotation<RerankedHit[]>(),
  webSearchResults: Annotation<WebSearchResult[]>(),
  draftAnswer: Annotation<string>(),
  currentPhase: Annotation<string>(),
  auditVerdict: Annotation<string | null>(),
});

type AgentState = typeof AgentStateAnnotation.State;

interface ToolOutput {
  hits: RerankedHit[];
  hitCount: number;
  denseCount: number;
  sparseCount: number;
  durationMs: number;
}

/** ═══════════════════════════════════════════
 * Tool
 * ═══════════════════════════════════════════ */

const createSearchTool = (
  retrievalService: RetrievalService,
  traceService: AgentTraceService,
  runId: string,
) =>
  tool(
    async (input: {
      queries: string[];
      kbIds: string[];
      questionType?: string;
    }): Promise<ToolOutput> => {
      const result = await retrievalService.retrieve({
        queries: input.queries,
        kbIds: input.kbIds,
        questionType:
          (input.questionType as
            | 'fact_lookup'
            | 'compare_analysis'
            | 'research_or_open_world') || 'fact_lookup',
      });

      await traceService.recordStep(runId, {
        agentName: 'retriever',
        stepType: 'hybrid_retrieve',
        status: 'completed',
        input: { queries: input.queries, kbIds: input.kbIds },
        output: {
          denseCount: result.denseHits.length,
          sparseCount: result.sparseHits.length,
          fusedCount: result.fusedHits.length,
          rerankedCount: result.rerankedHits.length,
        },
        durationMs: result.totalDurationMs,
      });

      return {
        hits: result.rerankedHits,
        hitCount: result.rerankedHits.length,
        denseCount: result.denseHits.length,
        sparseCount: result.sparseHits.length,
        durationMs: result.totalDurationMs,
      };
    },
    {
      name: 'search_knowledge_base',
      description: '执行知识库混合检索（稠密向量+关键词），返回相关文档分块。',
      schema: z.object({
        queries: z.array(z.string()).describe('检索查询列表'),
        kbIds: z.array(z.string()).describe('知识库 ID 列表'),
        questionType: z
          .enum(['fact_lookup', 'compare_analysis', 'research_or_open_world'])
          .optional()
          .describe('问题类型'),
      }),
    },
  );

/** ═══════════════════════════════════════════
 * Node 函数（纯逻辑，不涉及 SSE 发射）
 * ═══════════════════════════════════════════ */

async function routeQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
    temperature: 0.2,
    streaming: false,
    timeout: 15000,
  });

  const structured = model.withStructuredOutput(RoutedQueryPlanSchema, { method: 'jsonMode' });
  const result = await structured.invoke([
    new SystemMessage(`${ROUTER_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
    new HumanMessage(state.originalQuery),
  ]);

  const plan = result as RoutedQueryPlan;

  await traceService.recordStep(runId, {
    agentName: 'router',
    stepType: 'route_query',
    status: 'completed',
    input: { query: state.originalQuery },
    output: { intent: plan.intent, questionType: plan.questionType },
  });

  return { routedPlan: plan, currentPhase: 'planning' };
}

async function rewriteQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
    temperature: 0.3,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(RewriteOutputSchema, { method: 'jsonMode' });
    const result = await structured.invoke([
      new SystemMessage(`${REWRITE_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
      new HumanMessage(
        `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}`,
      ),
    ]);

    const output = result as RewriteOutput;
    const queries = output.queries.map((q) => q.rewritten);

    await traceService.recordStep(runId, {
      agentName: 'rewriter',
      stepType: 'rewrite_query',
      status: 'completed',
      input: { originalQuery: state.originalQuery },
      output: { queries },
    });

    return { rewrittenQueries: queries, currentPhase: 'planning' };
  } catch {
    return { rewrittenQueries: [state.originalQuery], currentPhase: 'planning' };
  }
}

async function decomposeQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
    temperature: 0.2,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(DecomposeOutputSchema, { method: 'jsonMode' });
    const result = await structured.invoke([
      new SystemMessage(`${DECOMPOSE_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
      new HumanMessage(
        `原始问题: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}`,
      ),
    ]);

    const output = result as DecomposeOutput;
    const queries = output.subQueries.map((sq) => sq.question);

    await traceService.recordStep(runId, {
      agentName: 'decomposer',
      stepType: 'decompose_query',
      status: 'completed',
      input: { originalQuery: state.originalQuery },
      output: { subQueries: output.subQueries.map((sq) => ({ question: sq.question, keywords: sq.keywords })) },
    });

    return { decomposedQueries: queries, currentPhase: 'planning' };
  } catch {
    // 降级：拆解失败时不阻塞管道，跳过拆解直接走 rewrite
    return { decomposedQueries: [], currentPhase: 'planning' };
  }
}

/** ═══════════════════════════════════════════
 * 条件边
 * ═══════════════════════════════════════════ */

/**
 * route 节点的条件边：greeting → writer，需要拆解 → decompose，否则 → rewrite
 */
function routeNextEdge(state: AgentState): 'decompose' | 'rewrite' | 'writer' {
  if (state.routedPlan?.intent === 'greeting') return 'writer';
  if (state.routedPlan?.needDecomposition === true) return 'decompose';
  return 'rewrite';
}

async function auditRetrievalNode(
  state: AgentState,
  chatModelService: ChatModelService,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
    temperature: 0.1,
    streaming: false,
    timeout: 10000,
  });

  const snippets = state.rerankedHits
    .slice(0, 5)
    .map((h, i) => `[${i + 1}] ${h.content.slice(0, 300)}`)
    .join('\n---\n');

  const structured = model.withStructuredOutput(AuditResultSchema, { method: 'jsonMode' });
  const result = await structured.invoke([
    new SystemMessage(`${AUDIT_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
    new HumanMessage(
      `用户问题: ${state.originalQuery}\n\n检索结果:\n${snippets || '（无检索结果）'}\n\n请评估检索结果是否足够回答问题，严格按照 {"verdict":"...","reason":"..."} 格式返回 JSON。`,
    ),
  ]);

  const audit = result as AuditResult;
  return { auditVerdict: audit.verdict };
}

/** ═══════════════════════════════════════════
 * 辅助
 * ═══════════════════════════════════════════ */

function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  // 拆解的子问题优先加入（结构化拆解质量更高）
  if (state.decomposedQueries.length > 0)
    queries.push(...state.decomposedQueries);
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
  return [...new Set(queries)].slice(0, 8);
}

function buildContextText(hits: RerankedHit[], webResults: WebSearchResult[]): string {
  const parts: string[] = [];

  if (hits.length > 0) {
    parts.push('【知识库检索结果】');
    hits.forEach((hit, index) => {
      const docTitle =
        (hit.payload['title'] as string) || hit.title || `文档 ${hit.docId}`;
      parts.push(`[KB-${index + 1}] 文档: ${docTitle}\n${hit.content}`);
    });
    parts.push('');
  }

  if (webResults.length > 0) {
    parts.push('【联网搜索结果】');
    webResults.forEach((r, index) => {
      parts.push(`[Web-${index + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`);
    });
    parts.push('');
  }

  if (parts.length === 0) return '（未检索到相关上下文）';
  return parts.join('\n---\n');
}

function extractContent(msg: { content?: unknown }): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter(
        (x): x is { type: string; text: string } =>
          typeof x === 'object' && x !== null && 'type' in x,
      )
      .filter((x) => x.type === 'text' && typeof x.text === 'string')
      .map((x) => x.text)
      .join('');
  }
  return '';
}

/** ═══════════════════════════════════════════
 * Orchestrator
 * ═══════════════════════════════════════════ */

@Injectable()
export class MultiAgentOrchestratorService {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger!: Logger;

  constructor(
    private readonly chatModelService: ChatModelService,
    private readonly retrievalService: RetrievalService,
    private readonly agentTraceService: AgentTraceService,
    private readonly webSearchService: WebSearchService,
  ) {}

  /**
   * 流式执行多智能体编排，通过 SseWriter 推送 AG-UI 事件。
   *
   * 图结构: __start__ → route → [greeting? → writer] → rewrite → retrieve_prep
   *    → tools → [shouldSearchWeb? → web_search] → writer → __end__
   *
   * 每个节点前后发射 STEP_STARTED / STEP_FINISHED，
   * 工具调用发射 TOOL_CALL_START / TOOL_CALL_RESULT，
   * writer 节点内发射 TEXT_MESSAGE_START / CONTENT / END。
   */
  async streamRun(
    runCtx: AgentRunContext,
    writer: SseWriter,
    options?: {
      enableWebSearch?: boolean;
      signal?: AbortSignal;
      onFinish?: (result: { content: string; citations: RerankedHit[] }) => Promise<void>;
      onError?: () => Promise<void>;
    },
  ): Promise<void> {
    const { enableWebSearch = false, signal, onFinish, onError } = options ?? {};
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    /** 检查取消信号，若已取消则跳过后续处理 */
    function checkAborted(): void {
      if (signal?.aborted) {
        throw new Error('Client disconnected');
      }
    }

    const runId = await self.agentTraceService.createRun(runCtx);

    const searchTool = createSearchTool(
      self.retrievalService,
      self.agentTraceService,
      runId,
    );

    writer.write({ type: 'RUN_STARTED', runId, timestamp: Date.now() });

    try {
      // ══════ 构建图 ══════
      const graph = new StateGraph(AgentStateAnnotation)
        .addNode('route', async (s) => {
          checkAborted();
          writer.write({ type: 'STEP_STARTED', stepName: 'route', timestamp: Date.now() });
          const stepStart = Date.now();
          const result = await routeQueryNode(s, self.chatModelService, runId, self.agentTraceService);
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'route',
            output: {
              intent: result.routedPlan?.intent,
              questionType: result.routedPlan?.questionType,
            },
            durationMs: Date.now() - stepStart,
          });
          return result;
        })
        .addNode('rewrite', async (s) => {
          checkAborted();
          writer.write({ type: 'STEP_STARTED', stepName: 'rewrite', timestamp: Date.now() });
          const stepStart = Date.now();
          const result = await rewriteQueryNode(s, self.chatModelService, runId, self.agentTraceService);
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'rewrite',
            output: { queries: result.rewrittenQueries },
            durationMs: Date.now() - stepStart,
          });
          return result;
        })
        .addNode('retrieve_prep', () => ({ currentPhase: 'retrieving' }))
        .addNode('tools', async (s) => {
          checkAborted();
          const queries = buildRetrieveQueries(s);
          const tcId = `tc_search_${Date.now()}`;
          writer.write({
            type: 'TOOL_CALL_START',
            toolCallId: tcId,
            toolCallName: 'search_knowledge_base',
            input: { queries, kbIds: s.resolvedKbIds },
          });
          const toolStart = Date.now();
          const result = await searchTool.invoke({
            queries,
            kbIds: s.resolvedKbIds,
            questionType: s.routedPlan?.questionType,
          });
          writer.write({
            type: 'TOOL_CALL_RESULT',
            toolCallId: tcId,
            toolCallName: 'search_knowledge_base',
            output: {
              hitCount: result.hitCount,
              denseCount: result.denseCount,
              sparseCount: result.sparseCount,
            },
            durationMs: Date.now() - toolStart,
          });
          return { rerankedHits: result.hits, currentPhase: 'retrieving' };
        })
        .addNode('audit', async (s) => {
          checkAborted();
          writer.write({ type: 'STEP_STARTED', stepName: 'audit', timestamp: Date.now() });
          const stepStart = Date.now();
          let auditResult: Partial<AgentState>;
          try {
            auditResult = await auditRetrievalNode(s, self.chatModelService);
          } catch (error) {
            self.logger.warn(
              `[Orchestrator] 审计节点 LLM 调用失败，降级: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            // 降级：有结果就继续回答，没结果且开了联网就触达搜索
            const verdict = s.rerankedHits.length > 0 ? 'sufficient' : 'insufficient';
            auditResult = { auditVerdict: verdict };
          }
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'audit',
            output: { verdict: auditResult.auditVerdict },
            durationMs: Date.now() - stepStart,
          });
          return auditResult;
        })
        .addNode('web_search', async (s) => {
          checkAborted();
          const tcId = `tc_web_${Date.now()}`;
          writer.write({
            type: 'TOOL_CALL_START',
            toolCallId: tcId,
            toolCallName: 'web_search',
            input: { query: s.originalQuery, maxResults: 5 },
          });
          const wsStart = Date.now();
          const results = await self.webSearchService.search(s.originalQuery, 5);
          writer.write({
            type: 'TOOL_CALL_RESULT',
            toolCallId: tcId,
            toolCallName: 'web_search',
            output: { resultCount: results.length },
            durationMs: Date.now() - wsStart,
          });
          return { webSearchResults: results, currentPhase: 'retrieving' };
        })
        .addNode('writer', async (s) => {
          checkAborted();
          writer.write({ type: 'STEP_STARTED', stepName: 'writer', timestamp: Date.now() });
          const stepStart = Date.now();

          const context = buildContextText(s.rerankedHits, s.webSearchResults);
          const prompt = WRITER_SYSTEM_PROMPT.replace('{context}', context);
          const draftModel = self.chatModelService.createModel({
            temperature: 0.5,
            streaming: true,
          });

          const lcStream = await draftModel.stream([
            new SystemMessage(prompt),
            new HumanMessage(s.originalQuery),
          ]);

          const msgId = `msg_${Date.now()}`;
          writer.write({ type: 'TEXT_MESSAGE_START', messageId: msgId });

          let answer = '';
          for await (const chunk of lcStream) {
            if (signal?.aborted) break;
            const text = extractContent(chunk);
            if (text) {
              answer += text;
              writer.write({ type: 'TEXT_MESSAGE_CONTENT', messageId: msgId, delta: text });
            }
          }

          writer.write({ type: 'TEXT_MESSAGE_END', messageId: msgId });
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'writer',
            output: { answerLength: answer.length },
            durationMs: Date.now() - stepStart,
          });

          return { draftAnswer: answer, currentPhase: 'writing' };
        })

        // --- decompose 节点（须在 route 条件边之前声明，满足 LangGraph 类型推断）---
        .addNode('decompose', async (s) => {
          checkAborted();
          writer.write({ type: 'STEP_STARTED', stepName: 'decompose', timestamp: Date.now() });
          const stepStart = Date.now();
          const result = await decomposeQueryNode(s, self.chatModelService, runId, self.agentTraceService);
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'decompose',
            output: { subQueries: result.decomposedQueries },
            durationMs: Date.now() - stepStart,
          });
          return result;
        })
        // --- 边 ---
        .addEdge('__start__', 'route')
        .addConditionalEdges('route', routeNextEdge, {
          decompose: 'decompose',
          rewrite: 'rewrite',
          writer: 'writer',
        })
        .addEdge('decompose', 'rewrite')
        .addEdge('rewrite', 'retrieve_prep')
        .addEdge('retrieve_prep', 'tools')
        .addEdge('tools', 'audit')
        .addConditionalEdges('audit', (s) => {
          if (s.auditVerdict === 'insufficient' && enableWebSearch) return 'web_search';
          return 'writer';
        }, {
          web_search: 'web_search',
          writer: 'writer',
        })
        .addEdge('web_search', 'writer')
        .addEdge('writer', '__end__')
        .compile();

      // ══════ 执行 ══════
      const finalState = await graph.invoke({
        sessionId: runCtx.sessionId,
        userId: runCtx.userId,
        originalQuery: runCtx.originalQuery,
        selectedKbIds: runCtx.selectedKbIds,
        resolvedKbIds: runCtx.resolvedKbIds,
        routedPlan: null,
        decomposedQueries: [],
        rewrittenQueries: [],
        rerankedHits: [],
        webSearchResults: [],
        draftAnswer: '',
        currentPhase: 'planning',
        auditVerdict: null,
      } satisfies AgentState);

      writer.write({ type: 'RUN_FINISHED', runId });

      if (onFinish) {
        const state = finalState as unknown as AgentState;
        await onFinish({
          content: state.draftAnswer ?? '',
          citations: state.rerankedHits?.slice(0, 5) ?? [],
        });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      self.logger.error(`[Orchestrator] 流式编排失败: ${errMsg}`);
      writer.write({ type: 'RUN_ERROR', runId, error: errMsg });
      if (onError) await onError();
    } finally {
      writer.end();
    }
  }
}
