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
import { EvalQueueService } from './eval-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { parseBigInt } from '@common/utils/bigint.utils';
import type { AgentRunContext } from './agent-trace.service';
import type { WebSearchResult } from '../../rag/web-search/web-search.service';
import type { ResolvedModelParams } from './model-config-resolution.service';
import { SseWriter } from '../types/agui-events';
import { extractMessageContent, getErrorMessage } from '@common/utils/message.utils';

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
import { RELEVANCE_CHECK_SYSTEM_PROMPT } from '../prompts/relevance-check.prompt';
import { FACT_CHECK_SYSTEM_PROMPT } from '../prompts/fact-check.prompt';
import { FactCheckResultSchema } from '../schemas/fact-check-result.schema';
import type { FactCheckResult } from '../schemas/fact-check-result.schema';
import { COMPLETENESS_CHECK_SYSTEM_PROMPT } from '../prompts/completeness-check.prompt';
import { CompletenessCheckResultSchema } from '../schemas/completeness-check-result.schema';
import type { CompletenessCheckResult } from '../schemas/completeness-check-result.schema';

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
  /** decompose 节点提取的关键词（用于稀疏检索） */
  decomposedKeywords: Annotation<string[]>(),
  rewrittenQueries: Annotation<string[]>(),
  /** rewrite 节点提取的关键词（用于稀疏检索） */
  rewrittenKeywords: Annotation<string[]>(),
  rerankedHits: Annotation<RerankedHit[]>(),
  webSearchResults: Annotation<WebSearchResult[]>(),
  draftAnswer: Annotation<string>(),
  currentPhase: Annotation<string>(),
  auditVerdict: Annotation<string | null>(),
  /** relevance_check 输出 */
  relevanceVerdict: Annotation<string | null>(),
  /** 检索重试计数，最大 1 */
  retrievalRetryCount: Annotation<number>(),
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
 * Zod Schemas（未独立成文件的轻量 schema）
 * ═══════════════════════════════════════════ */

const RelevanceCheckSchema = z.object({
  verdict: z
    .enum(['relevant', 'partial', 'not_relevant'])
    .describe('检索结果是否与用户问题相关'),
  relevantCount: z.number().int().describe('相关的分片数量'),
  totalCount: z.number().int().describe('总分片数量'),
});

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
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.2,
    streaming: false,
    timeout: 15000,
  });

  const structured = model.withStructuredOutput(RoutedQueryPlanSchema, {
    method: 'jsonMode',
  });
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
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.3,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(RewriteOutputSchema, {
      method: 'jsonMode',
    });
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

    // 提取改写查询附带的关键词（用于稀疏检索）
    const rewriteKw = (output.queries as Array<{ keywords?: string }>)
      .flatMap(q => q.keywords?.split(/[\s,，]+/).filter(Boolean) ?? []);
    return { rewrittenQueries: queries, rewrittenKeywords: rewriteKw, currentPhase: 'planning' };
  } catch {
    return {
      rewrittenQueries: [state.originalQuery],
      rewrittenKeywords: [],
      currentPhase: 'planning',
    };
  }
}

/** 改写回退 — 更激进的改写策略 */
const REWRITE_FALLBACK_PROMPT = `${REWRITE_SYSTEM_PROMPT}\n\n【重要】上轮检索结果不够充分，请尝试完全不同的改写角度：换用同义术语、去掉可能限制结果的约束词、从更宽泛的角度切入。`;

async function rewriteFallbackNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.5,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(RewriteOutputSchema, {
      method: 'jsonMode',
    });
    const result = await structured.invoke([
      new SystemMessage(`${REWRITE_FALLBACK_PROMPT}\n\n请以 JSON 格式回复。`),
      new HumanMessage(
        `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}\n上次改写后的查询: ${state.rewrittenQueries.join('; ')}`,
      ),
    ]);

    const output = result as RewriteOutput;
    const queries = output.queries.map((q) => q.rewritten);

    await traceService.recordStep(runId, {
      agentName: 'rewriter_fallback',
      stepType: 'rewrite_query',
      status: 'completed',
      input: {
        originalQuery: state.originalQuery,
        previousQueries: state.rewrittenQueries,
      },
      output: { queries },
    });

    return {
      rewrittenQueries: queries,
      retrievalRetryCount: (state.retrievalRetryCount ?? 0) + 1,
      currentPhase: 'retrieving',
    };
  } catch {
    return {
      rewrittenQueries: [state.originalQuery],
      retrievalRetryCount: (state.retrievalRetryCount ?? 0) + 1,
      currentPhase: 'retrieving',
    };
  }
}

async function decomposeQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.2,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(DecomposeOutputSchema, {
      method: 'jsonMode',
    });
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
      output: {
        subQueries: output.subQueries.map((sq) => ({
          question: sq.question,
          keywords: sq.keywords,
        })),
      },
    });

    const keywords = output.subQueries.flatMap((sq) => sq.keywords || []);
    return { decomposedQueries: queries, decomposedKeywords: keywords, currentPhase: 'planning' };
  } catch {
    return { decomposedQueries: [], decomposedKeywords: [], currentPhase: 'planning' };
  }
}

async function relevanceCheckNode(
  state: AgentState,
  chatModelService: ChatModelService,
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.1,
    streaming: false,
    timeout: 10000,
  });

  const snippets = state.rerankedHits
    .slice(0, 5)
    .map((h, i) => `[${i + 1}] ${h.content.slice(0, 300)}`)
    .join('\n---\n');

  try {
    const structured = model.withStructuredOutput(RelevanceCheckSchema, {
      method: 'jsonMode',
    });
    const result = await structured.invoke([
      new SystemMessage(`${RELEVANCE_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n\n检索结果:\n${snippets || '（无检索结果）'}`,
      ),
    ]);

    const output = result as z.infer<typeof RelevanceCheckSchema>;
    return { relevanceVerdict: output.verdict };
  } catch {
    // 降级：有结果就认为相关
    return {
      relevanceVerdict: state.rerankedHits.length > 0 ? 'relevant' : 'not_relevant',
    };
  }
}

async function auditRetrievalNode(
  state: AgentState,
  chatModelService: ChatModelService,
  mo?: ResolvedModelParams,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: mo?.modelName || chatModelService.getLightModelName(),
    apiKey: mo?.apiKey,
    baseURL: mo?.baseURL,
    temperature: 0.1,
    streaming: false,
    timeout: 10000,
  });

  const snippets = state.rerankedHits
    .slice(0, 5)
    .map((h, i) => `[${i + 1}] ${h.content.slice(0, 300)}`)
    .join('\n---\n');

  const structured = model.withStructuredOutput(AuditResultSchema, {
    method: 'jsonMode',
  });
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
 * 条件边
 * ═══════════════════════════════════════════ */

function routeNextEdge(
  state: AgentState,
): 'decompose' | 'rewrite' | 'writer' {
  if (state.routedPlan?.intent === 'greeting') return 'writer';
  if (state.routedPlan?.needDecomposition === true) return 'decompose';
  return 'rewrite';
}

function relevanceEdge(state: AgentState): 'audit' | 'rewrite_fallback' {
  if (state.relevanceVerdict === 'not_relevant') {
    const retryCount = state.retrievalRetryCount ?? 0;
    // 重试耗尽 → 放行到 audit（由 audit 判定 insufficient → writer）
    if (retryCount >= 1) return 'audit';
    return 'rewrite_fallback';
  }
  return 'audit';
}

function auditEdge(
  state: AgentState,
  enableWebSearch: boolean,
): 'writer' | 'web_search' | 'rewrite_fallback' {
  const retryCount = state.retrievalRetryCount ?? 0;

  if (state.auditVerdict === 'sufficient') return 'writer';

  // 检索不充分 → 优先网络搜索兜底
  if (enableWebSearch) return 'web_search';
  // 无网络搜索能力 → 改写重试
  if (retryCount < 1) return 'rewrite_fallback';
  // 重试次数用尽，直接生成（告知用户检索不充分）
  return 'writer';
}

/** ═══════════════════════════════════════════
 * 辅助
 * ═══════════════════════════════════════════ */

function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  // decompose 关键词（如有）优先 — 短关键词适合稀疏检索
  if (state.decomposedKeywords && state.decomposedKeywords.length > 0)
    queries.push(...state.decomposedKeywords);
  if (state.decomposedQueries.length > 0)
    queries.push(...state.decomposedQueries);
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
  // rewrite 关键词（如有）
  if (state.rewrittenKeywords && state.rewrittenKeywords.length > 0)
    queries.push(...state.rewrittenKeywords);
  return [...new Set(queries)].slice(0, 10);
}

function buildContextText(
  hits: RerankedHit[],
  webResults: WebSearchResult[],
): string {
  const MAX_CONTEXT_CHARS = 12000;
  const parts: string[] = [];
  let charBudget = MAX_CONTEXT_CHARS;

  if (hits.length > 0) {
    parts.push('【知识库检索结果】');
    for (let i = 0; i < hits.length; i++) {
      if (charBudget <= 0) break;
      const hit = hits[i];
      const docTitle =
        (hit.payload['title'] as string) ||
        hit.title ||
        `文档 ${hit.docId}`;
      const header = `[KB-${i + 1}] 文档: ${docTitle}\n`;
      const maxContentLen = charBudget - header.length;
      const content =
        hit.content.length > maxContentLen
          ? hit.content.slice(0, maxContentLen) + '...[截断]'
          : hit.content;
      parts.push(header + content);
      charBudget -= header.length + content.length;
    }
    parts.push('');
  }

  if (webResults.length > 0 && charBudget > 500) {
    parts.push('【联网搜索结果】');
    for (let i = 0; i < webResults.length; i++) {
      if (charBudget <= 0) break;
      const r = webResults[i];
      const header = `[Web-${i + 1}] ${r.title}\nURL: ${r.url}\n`;
      const maxContentLen = charBudget - header.length;
      const content =
        r.content.length > maxContentLen
          ? r.content.slice(0, maxContentLen) + '...[截断]'
          : r.content;
      parts.push(header + content);
      charBudget -= header.length + content.length;
    }
    parts.push('');
  }

  if (parts.length === 1) return '（未检索到相关上下文）';
  return parts.join('\n---\n');
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
    private readonly evalQueueService: EvalQueueService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 流式执行多智能体编排，通过 SseWriter 推送 AG-UI 事件。
   *
   * 图结构: __start__ → route → [greeting? → writer → __end__]
   *    → decompose → rewrite → retrieve_prep → tools → relevance_check
   *    → [not_relevant? → rewrite] → audit
   *    → [sufficient? → writer] / [insufficient+web → web_search → writer]
   *    / [insufficient+retry<1 → rewrite_fallback → tools → audit]
   *    → writer → __end__
   *
   * 事实核查和完整性检查已离线异步执行（runAsyncValidation），不再阻塞主响应流。
   */
  async streamRun(
    runCtx: AgentRunContext,
    writer: SseWriter,
    options?: {
      enableWebSearch?: boolean;
      signal?: AbortSignal;
      modelOptions?: ResolvedModelParams;
      onFinish?: (result: {
        content: string;
        citations: RerankedHit[];
      }) => Promise<{ citations: import('../types/agui-events').CitationData[] } | void>;
      onError?: () => Promise<void>;
    },
  ): Promise<void> {
    const {
      enableWebSearch = false,
      signal,
      modelOptions,
      onFinish,
      onError,
    } = options ?? {};
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    function checkAborted(): void {
      if (signal?.aborted) {
        throw new Error('客户端连接已断开');
      }
    }

    const runId = await self.agentTraceService.createRun(runCtx);
    const startedAt = Date.now();

    const searchTool = createSearchTool(
      self.retrievalService,
      self.agentTraceService,
      runId,
    );

    writer.write({ type: 'RUN_STARTED', runId, timestamp: Date.now() });

    try {
      // ══════ 构建图 ══════
      const graph = new StateGraph(AgentStateAnnotation)
        // ── 规划阶段 ──
        .addNode('route', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'route',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();
          const result = await routeQueryNode(
            s,
            self.chatModelService,
            runId,
            self.agentTraceService,
            modelOptions,
          );
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
        .addNode('decompose', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'decompose',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();
          const result = await decomposeQueryNode(
            s,
            self.chatModelService,
            runId,
            self.agentTraceService,
            modelOptions,
          );
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'decompose',
            output: { subQueries: result.decomposedQueries },
            durationMs: Date.now() - stepStart,
          });
          return result;
        })
        .addNode('rewrite', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'rewrite',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();
          const result = await rewriteQueryNode(
            s,
            self.chatModelService,
            runId,
            self.agentTraceService,
            modelOptions,
          );
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'rewrite',
            output: { queries: result.rewrittenQueries },
            durationMs: Date.now() - stepStart,
          });
          return result;
        })
        // ── 检索阶段 ──
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
          // 查询知识库名称
          const kbIds = [...new Set(result.hits.map((h) => h.kbId))];
          let kbNameMap = new Map<string, string>();
          try {
            const kbList = await self.prisma.b_knowledge_bases.findMany({
              where: { id: { in: kbIds.map((id) => parseBigInt(id)) } },
              select: { id: true, name: true },
            });
            kbNameMap = new Map(
              kbList.map((kb) => [String(kb.id), kb.name]),
            );
          } catch {
            // 查询失败不影响检索流程
          }

          writer.write({
            type: 'TOOL_CALL_RESULT',
            toolCallId: tcId,
            toolCallName: 'search_knowledge_base',
            output: {
              hitCount: result.hitCount,
              denseCount: result.denseCount,
              sparseCount: result.sparseCount,
              documents: result.hits.map((hit, i) => ({
                index: i + 1,
                citationId: `${tcId}-${i}`,
                kbId: hit.kbId,
                kbName: kbNameMap.get(hit.kbId) || '',
                docId: hit.docId,
                docTitle:
                  (hit.payload['title'] as string) ||
                  hit.title ||
                  `文档 ${hit.docId}`,
                chunkId: hit.chunkId,
                quote: hit.content
                  .replace(/^\[文档段落路径:.*?\]\n?/, '')
                  .slice(0, 200),
                score: hit.rerankScore,
              })),
              append: false,
            },
            durationMs: Date.now() - toolStart,
          });
          return {
            rerankedHits: result.hits,
            currentPhase: 'retrieving',
          };
        })
        // ── 检索质量评估 ──
        .addNode('relevance_check', async (s) => {
          checkAborted();
          const stepStart = Date.now();
          let relevanceResult: Partial<AgentState>;

          // 0 条命中 → 必然不相关，跳过 LLM 调用
          if (s.rerankedHits.length === 0) {
            writer.write({
              type: 'STEP_STARTED',
              stepName: 'relevance_check',
              timestamp: Date.now(),
            });
            writer.write({
              type: 'STEP_FINISHED',
              stepName: 'relevance_check',
              output: { verdict: 'not_relevant', shortcut: true },
              durationMs: Date.now() - stepStart,
            });
            return { relevanceVerdict: 'not_relevant' as const };
          }

          writer.write({
            type: 'STEP_STARTED',
            stepName: 'relevance_check',
            timestamp: Date.now(),
          });
          try {
            relevanceResult = await relevanceCheckNode(
              s,
              self.chatModelService,
              modelOptions,
            );
          } catch (error) {
            self.logger.warn(
              `[Orchestrator] 相关性校验失败，降级: ${
                getErrorMessage(error)
              }`,
            );
            relevanceResult = {
              relevanceVerdict:
                s.rerankedHits.length > 0 ? 'relevant' : 'not_relevant',
            };
          }
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'relevance_check',
            output: { verdict: relevanceResult.relevanceVerdict },
            durationMs: Date.now() - stepStart,
          });
          return relevanceResult;
        })
        .addNode('audit', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'audit',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();
          let auditResult: Partial<AgentState>;
          try {
            auditResult = await auditRetrievalNode(s, self.chatModelService, modelOptions);
          } catch (error) {
            self.logger.warn(
              `[Orchestrator] 审计节点 LLM 调用失败，降级: ${
                getErrorMessage(error)
              }`,
            );
            const verdict =
              s.rerankedHits.length > 0 ? 'sufficient' : 'insufficient';
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
        // ── 检索重试 ──
        .addNode('rewrite_fallback', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'rewrite_fallback',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();
          const result = await rewriteFallbackNode(
            s,
            self.chatModelService,
            runId,
            self.agentTraceService,
            modelOptions,
          );
          writer.write({
            type: 'STEP_FINISHED',
            stepName: 'rewrite_fallback',
            output: { queries: result.rewrittenQueries },
            durationMs: Date.now() - stepStart,
          });
          return result;
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
          const results = await self.webSearchService.search(
            s.originalQuery,
            5,
          );
          writer.write({
            type: 'TOOL_CALL_RESULT',
            toolCallId: tcId,
            toolCallName: 'web_search',
            output: { resultCount: results.length },
            durationMs: Date.now() - wsStart,
          });
          return {
            webSearchResults: results,
            retrievalRetryCount: (s.retrievalRetryCount ?? 0) + 1,
            currentPhase: 'retrieving',
          };
        })
        // ── 生成阶段 ──
        .addNode('writer', async (s) => {
          checkAborted();
          writer.write({
            type: 'STEP_STARTED',
            stepName: 'writer',
            timestamp: Date.now(),
          });
          const stepStart = Date.now();

          const context = buildContextText(
            s.rerankedHits,
            s.webSearchResults,
          );
          const prompt = WRITER_SYSTEM_PROMPT.replace('{context}', context);

          // 若检索不充分，提示 LLM 诚实告知
          const isInsufficient =
            s.auditVerdict === 'insufficient' &&
            (s.retrievalRetryCount ?? 0) >= 2;
          const finalPrompt = isInsufficient
            ? prompt +
                '\n\n⚠️ 注意：当前知识库检索结果可能不足以完整回答该问题，请诚实告知用户当前资料的局限性。'
            : prompt;

          const draftModel = self.chatModelService.createModel({
            model: modelOptions?.modelName,
            apiKey: modelOptions?.apiKey,
            baseURL: modelOptions?.baseURL,
            temperature: 0.5,
            streaming: true,
          });

          const lcStream = await draftModel.stream([
            new SystemMessage(finalPrompt),
            new HumanMessage(s.originalQuery),
          ]);

          const msgId = `msg_${Date.now()}`;
          writer.write({ type: 'TEXT_MESSAGE_START', messageId: msgId });

          let answer = '';
          for await (const chunk of lcStream) {
            if (signal?.aborted) break;
            const text = extractMessageContent(chunk);
            if (text) {
              answer += text;
              writer.write({
                type: 'TEXT_MESSAGE_CONTENT',
                messageId: msgId,
                delta: text,
              });
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

        // ══════ 边 ══════
        .addEdge('__start__', 'route')
        .addConditionalEdges('route', routeNextEdge, {
          decompose: 'decompose',
          rewrite: 'rewrite',
          writer: 'writer',
        })
        .addEdge('decompose', 'rewrite')
        .addEdge('rewrite', 'retrieve_prep')
        .addEdge('retrieve_prep', 'tools')
        .addEdge('tools', 'relevance_check')
        .addConditionalEdges('relevance_check', relevanceEdge, {
          audit: 'audit',
          rewrite_fallback: 'rewrite_fallback',
        })
        .addConditionalEdges(
          'audit',
          (s) => auditEdge(s, enableWebSearch),
          {
            writer: 'writer',
            web_search: 'web_search',
            rewrite_fallback: 'rewrite_fallback',
          },
        )
        .addEdge('web_search', 'writer')
        .addEdge('rewrite_fallback', 'tools')
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
        decomposedKeywords: [],
        rewrittenQueries: [],
        rewrittenKeywords: [],
        rerankedHits: [],
        webSearchResults: [],
        draftAnswer: '',
        currentPhase: 'planning',
        auditVerdict: null,
        relevanceVerdict: null,
        retrievalRetryCount: 0,
      } satisfies AgentState);

      // 持久化核心评估数据到 b_agent_runs.metadata_json（eval 流水线依赖 originalQuery/draftAnswer/rerankedHits）
      const evalState = finalState as unknown as AgentState;
      self.agentTraceService
        .saveEvaluationData(runId, {
          originalQuery: evalState.originalQuery,
          draftAnswer: evalState.draftAnswer,
          rewrittenQueries: evalState.rewrittenQueries,
          rewrittenKeywords: evalState.rewrittenKeywords ?? [],
          decomposedQueries: evalState.decomposedQueries,
          rerankedHits: (evalState.rerankedHits ?? []).map((h) => ({
            chunkId: h.chunkId,
            docId: h.docId,
            kbId: h.kbId,
            content: h.content,
            title: h.title,
            fusionScore: h.fusionScore,
            rerankScore: h.rerankScore,
          })),
          auditVerdict: evalState.auditVerdict,
          relevanceVerdict: evalState.relevanceVerdict,
          retrievalRetryCount: evalState.retrievalRetryCount ?? 0,
        })
        .catch((err: unknown) =>
          self.logger.warn('[Orchestrator] 评估数据持久化失败', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );

      // 标记 Agent Run 完成
      self.agentTraceService
        .completeRun(runId, {
          totalTokens: 0,
          totalDurationMs: Date.now() - startedAt,
        })
        .catch((err) =>
          self.logger.warn('[Orchestrator] completeRun 失败', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );

      if (onFinish) {
        try {
          const state = finalState as unknown as AgentState;
          const fullContent = state.draftAnswer ?? '';
          const finishResult = await onFinish({
            content: fullContent,
            citations: state.rerankedHits ?? [],
          });

          writer.write({
            type: 'RUN_FINISHED',
            runId,
            citations: finishResult?.citations,
          });

          self.evalQueueService
            .enqueueEvaluation(runId)
            .catch((err: unknown) =>
              self.logger.warn('[Orchestrator] 评估入队失败', {
                error: err instanceof Error ? err.message : String(err),
              }),
            );

          // 异步校验：fact_check + completeness_check（不阻塞主流程，追加写入 metadata_json）
          self.runAsyncValidation({
            runId,
            originalQuery: state.originalQuery,
            draftAnswer: state.draftAnswer,
            rerankedHits: state.rerankedHits ?? [],
            modelOptions,
          }).catch((err) =>
            self.logger.warn('[Orchestrator] 异步校验失败', {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        } catch (finishError) {
          self.logger.error('[Orchestrator] onFinish 回调失败', {
            error:
              finishError instanceof Error
                ? finishError.message
                : String(finishError),
          });
          writer.write({ type: 'RUN_FINISHED', runId });
        }
      } else {
        writer.write({ type: 'RUN_FINISHED', runId });
      }
    } catch (error: unknown) {
      const errMsg =
        getErrorMessage(error);
      self.logger.error(`[Orchestrator] 流式编排失败: ${errMsg}`);
      writer.write({ type: 'RUN_ERROR', runId, error: errMsg });
      self.agentTraceService
        .failRun(runId)
        .catch((err) =>
          self.logger.warn('[Orchestrator] failRun 失败', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      if (onError) await onError();
    } finally {
      writer.end();
    }
  }

  /** 离线异步执行事实核查和完整性检查，完成后追加写入 metadata_json */
  private async runAsyncValidation(params: {
    runId: string;
    originalQuery: string;
    draftAnswer: string;
    rerankedHits: RerankedHit[];
    modelOptions?: ResolvedModelParams;
  }): Promise<void> {
    try {
      const model = this.chatModelService.createModel({
        model: params.modelOptions?.modelName || this.chatModelService.getLightModelName(),
        temperature: 0.1,
        streaming: false,
        timeout: 15000,
      });

      const snippets = params.rerankedHits
        .slice(0, 5)
        .map((h, i) => `[来源${i + 1}] ${h.content.slice(0, 500)}`)
        .join('\n---\n');

      const factModel = model.withStructuredOutput(FactCheckResultSchema, { method: 'jsonMode' });
      const factResult = await factModel.invoke([
        new SystemMessage(FACT_CHECK_SYSTEM_PROMPT),
        new HumanMessage(
          `用户问题: ${params.originalQuery}\n\n检索上下文:\n${snippets}\n\n待审核回答:\n${params.draftAnswer}`,
        ),
      ]);

      const compModel = model.withStructuredOutput(CompletenessCheckResultSchema, { method: 'jsonMode' });
      const compResult = await compModel.invoke([
        new SystemMessage(COMPLETENESS_CHECK_SYSTEM_PROMPT),
        new HumanMessage(
          `用户问题: ${params.originalQuery}\n\n回答:\n${params.draftAnswer}`,
        ),
      ]);

      await this.agentTraceService.mergeEvaluationData(params.runId, {
        factCheckResult: factResult as FactCheckResult,
        completenessResult: compResult as CompletenessCheckResult,
      });
    } catch (err) {
      this.logger.warn('[Orchestrator] 异步校验失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
