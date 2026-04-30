import { Injectable, Inject } from '@nestjs/common';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createUIMessageStream, type UIMessageChunk } from 'ai';
import { ChatModelService } from '../../rag/chat-model.service';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RetrievalService } from '../../rag/retrieval-services/retrieval.service';
import { AgentTraceService } from './agent-trace.service';
import type { AgentRunContext } from './agent-trace.service';
import type { RerankedHit } from '../../rag/retrieval-interfaces/reranked-hit.interface';
import { RoutedQueryPlanSchema } from '../schemas/routed-query-plan.schema';
import type { RoutedQueryPlan } from '../schemas/routed-query-plan.schema';
import { RewriteOutputSchema } from '../schemas/rewritten-query.schema';
import type { RewriteOutput } from '../schemas/rewritten-query.schema';
import { DecomposeOutputSchema } from '../schemas/decomposed-question.schema';
import type { DecomposeOutput } from '../schemas/decomposed-question.schema';
import { FactCheckResultSchema } from '../schemas/fact-check-result.schema';
import type { FactCheckResult } from '../schemas/fact-check-result.schema';
import { CompletenessCheckResultSchema } from '../schemas/completeness-check-result.schema';
import type { CompletenessCheckResult } from '../schemas/completeness-check-result.schema';
import { ROUTER_SYSTEM_PROMPT } from '../prompts/router.prompt';
import { REWRITE_SYSTEM_PROMPT } from '../prompts/rewrite.prompt';
import { DECOMPOSE_SYSTEM_PROMPT } from '../prompts/decompose.prompt';
import { RELEVANCE_CHECK_SYSTEM_PROMPT } from '../prompts/relevance-check.prompt';
import { FACT_CHECK_SYSTEM_PROMPT } from '../prompts/fact-check.prompt';
import { COMPLETENESS_CHECK_SYSTEM_PROMPT } from '../prompts/completeness-check.prompt';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';

/** 回退上限 */
const MAX_FALLBACK = 2;

/** ═══════════════════════════════════════════
 * Agent State 定义
 * ═══════════════════════════════════════════ */

const AgentStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  userId: Annotation<number>(),
  originalQuery: Annotation<string>(),
  selectedKbIds: Annotation<string[]>(),
  resolvedKbIds: Annotation<string[]>(),
  routedPlan: Annotation<RoutedQueryPlan | null>(),
  rewrittenQueries: Annotation<string[]>(),
  decomposedQuestions: Annotation<DecomposeOutput | null>(),
  rerankedHits: Annotation<RerankedHit[]>(),
  draftAnswer: Annotation<string>(),
  factCheckResult: Annotation<FactCheckResult | null>(),
  completenessResult: Annotation<CompletenessCheckResult | null>(),
  fallbackCount: Annotation<number>(),
  currentPhase: Annotation<string>(),
  relevanceVerdict: Annotation<
    'relevant' | 'partial' | 'not_relevant' | null
  >(),
  pendingSupplement: Annotation<boolean>(),
  pendingRevise: Annotation<boolean>(),
});

type AgentState = typeof AgentStateAnnotation.State;
type PartialAgentState = Partial<AgentState>;

/** 工具节点输出类型 */
interface ToolOutput {
  hits: RerankedHit[];
  hitCount: number;
  denseCount: number;
  sparseCount: number;
  durationMs: number;
}

/** ═══════════════════════════════════════════
 * Tools — 使用 @langchain/core/tools 封装
 * ═══════════════════════════════════════════ */

/**
 * 知识库检索工具
 */
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
        queries: z.array(z.string()).describe('检索查询列表，支持多查询'),
        kbIds: z.array(z.string()).describe('知识库 ID 列表'),
        questionType: z
          .enum(['fact_lookup', 'compare_analysis', 'research_or_open_world'])
          .optional()
          .describe('问题类型'),
      }),
    },
  );

/**
 * 获取分块详情工具
 */
const _createGetChunkDetailTool = () =>
  tool(
    (input: { chunkId: string }) => {
      return { chunkId: input.chunkId, content: '（需从存储获取）' };
    },
    {
      name: 'get_chunk_detail',
      description: '根据 chunkId 获取完整分块内容',
      schema: z.object({ chunkId: z.string().describe('分块 ID') }),
    },
  );

/** ═══════════════════════════════════════════
 * Node 函数
 * ═══════════════════════════════════════════ */

async function routeQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Orchestrator] 🔀 路由分析中...');
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.2,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(RoutedQueryPlanSchema, { method: 'jsonMode' });

    const result = await structured.invoke([
      new SystemMessage(
        `${ROUTER_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`,
      ),
      new HumanMessage(state.originalQuery),
    ]);

    const plan = result as RoutedQueryPlan;
    console.log(
      `[Orchestrator] ✅ 路由完成 → 意图: ${plan.intent} | 需拆解: ${plan.needDecomposition} | 类型: ${plan.questionType}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'router',
      stepType: 'route_query',
      status: 'completed',
      input: { query: state.originalQuery },
      output: {
        intent: plan.intent,
        needDecomposition: plan.needDecomposition,
        questionType: plan.questionType,
      },
    });

    return { routedPlan: plan, currentPhase: 'planning' };
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 路由分析失败: ${error?.message || error}`,
    );
    throw error;
  }
}

async function rewriteQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  const round = state.fallbackCount + 1;
  console.log(`[Orchestrator] ✏️ 查询改写中... (第 ${round} 轮回退)`);
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.3,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(RewriteOutputSchema, { method: 'jsonMode' });

    const result = await structured.invoke([
      new SystemMessage(
        `${REWRITE_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`,
      ),
      new HumanMessage(
        `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}\n当前是第 ${round} 轮检索`,
      ),
    ]);

    const output = result as RewriteOutput;
    const queries = output.queries.map((q) => q.rewritten);
    console.log(
      `[Orchestrator] ✅ 查询改写完成 → ${queries.length} 个改写查询: ${queries.join(' | ')}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'rewriter',
      stepType: 'rewrite_query',
      status: 'completed',
      input: { originalQuery: state.originalQuery },
      output: { queries },
    });

    return {
      rewrittenQueries: queries,
      fallbackCount: state.fallbackCount + 1,
      currentPhase: 'planning',
    };
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 查询改写失败: ${error?.message || error}`,
    );
    // 回退：直接使用原始查询，跳过改写
    return {
      rewrittenQueries: [state.originalQuery],
      fallbackCount: state.fallbackCount + 1,
      currentPhase: 'planning',
    };
  }
}

async function decomposeNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Orchestrator] 🔍 问题拆解中...');
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.3,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(DecomposeOutputSchema, { method: 'jsonMode' });

    const result = await structured.invoke([
      new SystemMessage(
        `${DECOMPOSE_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`,
      ),
      new HumanMessage(
        `原始问题: ${state.originalQuery}\n改写查询: ${state.rewrittenQueries.join('；')}`,
      ),
    ]);

    const output = result as DecomposeOutput;
    console.log(
      `[Orchestrator] ✅ 拆解完成 → ${output.questions.length} 个子问题 | 依赖: ${output.dependency}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'decomposer',
      stepType: 'decompose_question',
      status: 'completed',
      input: { query: state.originalQuery },
      output: {
        questions: output.questions.map((q) => q.subQuestion),
        dependency: output.dependency,
      },
    });

    return { decomposedQuestions: output, currentPhase: 'planning' };
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 问题拆解失败: ${error?.message || error}`,
    );
    // 回退：跳过拆解，继续后续流程
    return { currentPhase: 'planning' };
  }
}

async function factCheckNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  if (!state.draftAnswer) return { currentPhase: 'verifying' };

  console.log('[Orchestrator] 🔎 事实校验中...');
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.1,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(FactCheckResultSchema, { method: 'jsonMode' });
    const context = buildContextText(state.rerankedHits);

    const result = await structured.invoke([
      new SystemMessage(
        `${FACT_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`,
      ),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n\n回答内容:\n${state.draftAnswer}\n\n检索到的知识库内容:\n${context}`,
      ),
    ]);

    const output = result as FactCheckResult;
    console.log(
      `[Orchestrator] ✅ 事实校验完成 → ${output.items.length} 条声明 | 风险: ${output.overallRisk} | 需修正: ${output.needRevise}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'verifier',
      stepType: 'fact_check',
      status: 'completed',
      input: { answerLength: state.draftAnswer.length },
      output: {
        itemCount: output.items.length,
        overallRisk: output.overallRisk,
        needRevise: output.needRevise,
      },
    });

    return {
      factCheckResult: output,
      currentPhase: 'verifying',
    };
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 事实校验失败: ${error?.message || error}`,
    );
    // 回退：跳过事实校验，标记低风险继续
    return { currentPhase: 'verifying' };
  }
}

async function completenessCheckNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  if (!state.draftAnswer) return { currentPhase: 'verifying' };

  // 如果是补充检索后的第一轮完整性校验，清除 needSupplement 标记并结束循环
  if (state.pendingSupplement) {
    console.log('[Orchestrator] 📋 补充检索后重新校验，跳过完整性检查直接结束');
    return {
      completenessResult: null,
      pendingSupplement: false,
      currentPhase: 'verifying',
    };
  }

  console.log('[Orchestrator] 📋 完整性校验中...');
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.1,
    streaming: false,
    timeout: 15000,
  });

  try {
    const structured = model.withStructuredOutput(CompletenessCheckResultSchema, { method: 'jsonMode' });

    const subQuestions =
      state.decomposedQuestions?.questions.map((q) => q.subQuestion).join('；') ??
      '未拆解';

    const result = await structured.invoke([
      new SystemMessage(
        `${COMPLETENESS_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`,
      ),
      new HumanMessage(
        `原始问题: ${state.originalQuery}\n子问题: ${subQuestions}\n\n回答内容:\n${state.draftAnswer}`,
      ),
    ]);

    const output = result as CompletenessCheckResult;
    console.log(
      `[Orchestrator] ✅ 完整性校验完成 → 覆盖: ${output.overallCoverage} | 缺失: ${output.missingAspects.length} 项 | 需补充: ${output.needSupplement}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'verifier',
      stepType: 'completeness_check',
      status: 'completed',
      input: {
        answerLength: state.draftAnswer.length,
        subQuestionCount: state.decomposedQuestions?.questions.length ?? 0,
      },
      output: {
        coverage: output.overallCoverage,
        missingCount: output.missingAspects.length,
        needSupplement: output.needSupplement,
      },
    });

    return {
      completenessResult: output,
      pendingSupplement: false,
      currentPhase: 'verifying',
    };
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 完整性校验失败: ${error?.message || error}`,
    );
    // 回退：跳过完整性校验
    return {
      pendingSupplement: false,
      currentPhase: 'verifying',
    };
  }
}

async function relevanceCheckNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  console.log(
    `[Orchestrator] 🎯 相关性检查中... (${state.rerankedHits.length} 条检索结果)`,
  );
  if (!state.rerankedHits.length) {
    console.log('[Orchestrator] ⚠️ 无检索结果，直接标记为 not_relevant');
    return {
      relevanceVerdict: 'not_relevant' as const,
      currentPhase: 'verifying',
    };
  }

  const model = chatModelService.createModel({
    model: 'qwen-turbo',
    temperature: 0.1,
    streaming: false,
    timeout: 20000,
  });

  try {
    const chunksSummary = state.rerankedHits
      .slice(0, 5)
      .map((h, i) => `[${i + 1}] ${h.content.slice(0, 300)}`)
      .join('\n');

    const llmStart = Date.now();
    const msg = await model.invoke([
      new SystemMessage(RELEVANCE_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `用户查询: ${state.originalQuery}\n\n检索到的分片内容:\n${chunksSummary}\n\n请用 JSON 格式回复：{"verdict":"relevant|partial|not_relevant","reason":"理由"}`,
      ),
    ]);
    const llmDuration = Date.now() - llmStart;

    const content = extractContent(msg);

    try {
      const json = JSON.parse(
        content.replace(/```json\s*/g, '').replace(/```\s*/g, ''),
      );
      const verdict = json.verdict as 'relevant' | 'partial' | 'not_relevant';
      console.log(
        `[Orchestrator] ✅ 相关性检查完成 → ${verdict} (${llmDuration}ms)`,
      );

      await traceService.recordStep(runId, {
        agentName: 'verifier',
        stepType: 'relevance_check',
        status: 'completed',
        input: {
          query: state.originalQuery,
          hitCount: state.rerankedHits.length,
        },
        output: json,
        durationMs: llmDuration,
      });

      return { relevanceVerdict: verdict, currentPhase: 'verifying' };
    } catch {
      console.log('[Orchestrator] ⚠️ 相关性解析失败，fallback 为 partial');
      return { relevanceVerdict: 'partial' as const, currentPhase: 'verifying' };
    }
  } catch (error: any) {
    console.error(
      `[Orchestrator] ❌ 相关性检查失败: ${error?.message || error}`,
    );
    return { relevanceVerdict: 'partial' as const, currentPhase: 'verifying' };
  }
}

/** ═══════════════════════════════════════════
 * 条件边函数 — 决定下一步流向
 * ═══════════════════════════════════════════ */

/**
 * 路由后决定是否需要改写查询。
 * 仅复杂查询（对比分析、研究）需要改写；简单事实查找和问候直接检索。
 */
function shouldRewrite(state: AgentState): 'rewrite' | 'skip_rewrite' {
  const intent = state.routedPlan?.intent;
  return (intent === 'fact_lookup' || intent === 'greeting' || !intent)
    ? 'skip_rewrite'
    : 'rewrite';
}

/**
 * 生成回答后决定是否需要质量校验。
 * 仅复杂查询需要事实校验+完整性校验；简单查询直接结束。
 */
function shouldVerify(state: AgentState): 'verify' | 'finalize' {
  const intent = state.routedPlan?.intent;
  return (intent === 'compare_analysis' || intent === 'research_or_open_world')
    ? 'verify'
    : 'finalize';
}

/**
 * 路由后决定是否需要拆解
 */
function shouldDecompose(state: AgentState): 'decompose' | 'skip_decompose' {
  return state.routedPlan?.needDecomposition ? 'decompose' : 'skip_decompose';
}

/**
 * 检索后决定是否需要回退（相关性不足）
 */
function shouldRetryOrContinue(state: AgentState): 'rewrite' | 'continue' {
  if (
    state.relevanceVerdict === 'not_relevant' &&
    state.fallbackCount < MAX_FALLBACK
  ) {
    return 'rewrite';
  }
  return 'continue';
}

/** ═══════════════════════════════════════════
 * 辅助函数
 * ═══════════════════════════════════════════ */

function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
  if (state.decomposedQuestions) {
    queries.push(
      ...state.decomposedQuestions.questions.map((q) => q.subQuestion),
    );
  }
  return [...new Set(queries)].slice(0, 8);
}

function buildContextText(hits: RerankedHit[]): string {
  if (!hits.length) return '（未检索到相关上下文）';
  return hits
    .map((hit, index) => {
      const docTitle =
        (hit.payload['title'] as string) || hit.title || `文档 ${hit.docId}`;
      return `[来源 ${index + 1}] 文档: ${docTitle}\n${hit.content}`;
    })
    .join('\n\n---\n\n');
}

function extractContent(msg: any): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (c: any): c is { type: 'text'; text: string } => c.type === 'text',
      )
      .map((c: any) => c.text)
      .join('');
  }
  return '';
}

@Injectable()
export class MultiAgentOrchestratorService {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger;

  constructor(
    private readonly chatModelService: ChatModelService,
    private readonly retrievalService: RetrievalService,
    private readonly agentTraceService: AgentTraceService,
  ) {}

  /**
   * 流式执行多智能体编排，实时推送各节点状态和最终回答 token 流。
   *
   * 与 run() 的区别：
   * - 使用 AI SDK data stream 协议，逐 token 流式输出回答
   * - 每个节点的执行状态通过 data 事件实时推送
   * - 不依赖 LangGraph（手动编排节点调用）
   */
  streamRun(
    runCtx: AgentRunContext,
    callbacks?: {
      onFinish?: (result: { content: string; citations: unknown[] }) => Promise<void>;
      onError?: () => Promise<void>;
    },
  ): ReadableStream<UIMessageChunk> {
    const { chatModelService, retrievalService, agentTraceService, logger } = this;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const msgId = 'rag-msg-1';
        const runId = await agentTraceService.createRun(runCtx);

        const searchTool = createSearchTool(
          retrievalService,
          agentTraceService,
          runId,
        );

        const emitStatus = (phase: string, detail: string) => {
          writer.write({
            type: 'data-agent-status',
            data: { type: 'agent-status', phase, detail },
          } as any);
        };

        const emitText = (text: string) => {
          writer.write({ type: 'text-delta', id: msgId, delta: text });
        };

        try {
          // ══════ 构建预生成图 ══════
          // 处理 route → rewrite → decompose → retrieve → relevance → retry loop
          const preGenGraph = new StateGraph(AgentStateAnnotation)
            .addNode('route', (s) =>
              routeQueryNode(s, chatModelService, runId, agentTraceService),
            )
            .addNode('rewrite', (s) =>
              rewriteQueryNode(s, chatModelService, runId, agentTraceService),
            )
            .addNode('decompose', (s) =>
              decomposeNode(s, chatModelService, runId, agentTraceService),
            )
            .addNode('retrieve_prep', () => ({ currentPhase: 'retrieving' }))
            .addNode('tools', async (s) => {
              const queries = buildRetrieveQueries(s);
              const result = await searchTool.invoke({
                queries,
                kbIds: s.resolvedKbIds,
                questionType: s.routedPlan?.questionType,
              });
              writer.write({
                type: 'data-retrieval-progress',
                data: {
                  type: 'retrieval-progress',
                  denseCount: result.denseCount,
                  sparseCount: result.sparseCount,
                  fusedCount: result.hitCount,
                },
              } as any);
              return { rerankedHits: result.hits, currentPhase: 'retrieving' };
            })
            .addNode('relevance_check', (s) =>
              relevanceCheckNode(s, chatModelService, runId, agentTraceService),
            )
            .addEdge('__start__', 'route')
            .addConditionalEdges('route', shouldRewrite, {
              rewrite: 'rewrite',
              skip_rewrite: 'retrieve_prep',
            })
            .addConditionalEdges('rewrite', shouldDecompose, {
              decompose: 'decompose',
              skip_decompose: 'retrieve_prep',
            })
            .addEdge('decompose', 'retrieve_prep')
            .addEdge('retrieve_prep', 'tools')
            .addEdge('tools', 'relevance_check')
            .addConditionalEdges('relevance_check', shouldRetryOrContinue, {
              rewrite: 'rewrite',
              continue: '__end__',
            })
            .compile();

          const initialState: AgentState = {
            sessionId: runCtx.sessionId,
            userId: runCtx.userId,
            originalQuery: runCtx.originalQuery,
            selectedKbIds: runCtx.selectedKbIds,
            resolvedKbIds: runCtx.resolvedKbIds,
            routedPlan: null,
            rewrittenQueries: [],
            decomposedQuestions: null,
            rerankedHits: [],
            draftAnswer: '',
            factCheckResult: null,
            completenessResult: null,
            fallbackCount: 0,
            currentPhase: 'planning',
            relevanceVerdict: null,
            pendingSupplement: false,
            pendingRevise: false,
          };

          // ══════ 执行预生成图，逐节点推送状态 ══════
          emitStatus('planning', '开始分析...');
          const graphStream = await preGenGraph.stream(initialState, {
            streamMode: 'updates',
          });

          // eslint-disable-next-line prefer-const
          let state = initialState;
          for await (const chunk of graphStream) {
            const [nodeName, nodeUpdate] = Object.entries(chunk)[0];
            Object.assign(state, nodeUpdate);

            // 每个节点完成后推送状态
            const phase = getPhaseForNode(nodeName);
            const detail = getDetailForNode(nodeName, state);
            emitStatus(phase, detail);
          }

          // ══════ 流式生成回答 ══════
          emitStatus('writing', '正在生成回答...');
          const context = buildContextText(state.rerankedHits);
          const draftPrompt = WRITER_SYSTEM_PROMPT.replace('{context}', context);
          const draftModel = chatModelService.createModel({
            temperature: 0.5,
            streaming: true,
          });

          const lcStream = await draftModel.stream([
            new SystemMessage(draftPrompt),
            new HumanMessage(state.originalQuery),
          ]);

          let fullAnswer = '';
          for await (const chunk of lcStream) {
            const text = extractContent(chunk);
            if (text) {
              fullAnswer += text;
              emitText(text);
            }
          }
          state.draftAnswer = fullAnswer;
          emitStatus('writing', `回答生成完成 → ${fullAnswer.length} 字`);

          // ══════ 质量校验（复杂查询） ══════
          const shouldSkipVerify =
            state.rerankedHits.length === 0 ||
            state.relevanceVerdict === 'not_relevant';

          if (shouldVerify(state) === 'verify' && !shouldSkipVerify) {
            emitStatus('verifying', '正在并行校验事实准确性和完整性...');
            const [factResult, completenessResult] = await Promise.all([
              factCheckNode(state, chatModelService, runId, agentTraceService),
              completenessCheckNode(state, chatModelService, runId, agentTraceService),
            ]);
            Object.assign(state, factResult, completenessResult);

            const factRisk = state.factCheckResult?.overallRisk ?? 'failed';
            const coverage =
              state.completenessResult?.overallCoverage ?? 'failed';
            emitStatus(
              'verifying',
              `校验完成 → 事实风险: ${factRisk} | 完整性: ${coverage}`,
            );
          } else if (shouldSkipVerify) {
            emitStatus(
              'verifying',
              `检索${state.rerankedHits.length === 0 ? '无结果' : '不相关'}，跳过质量校验`,
            );
          }

          // ══════ 引用 + 结束 ══════
          const citations = state.rerankedHits.slice(0, 5);
          if (citations.length > 0) {
            writer.write({
              type: 'data-citation-snapshot',
              data: {
                type: 'citation-snapshot',
                citations: citations.map((c) => ({
                  chunkId: c.chunkId,
                  docId: c.docId,
                  content: c.content.slice(0, 200),
                  title: c.title,
                })),
              },
            } as any);
          }

          emitStatus('done', '完成');

          if (callbacks?.onFinish) {
            await callbacks.onFinish({
              content: state.draftAnswer,
              citations: citations,
            });
          }

          writer.write({ type: 'finish', finishReason: 'stop' });
        } catch (error: any) {
          logger.error(
            `[Orchestrator] 流式编排失败: ${error?.message || error}`,
          );
          if (callbacks?.onError) {
            await callbacks.onError();
          }
          writer.write({ type: 'error', errorText: error?.message || '未知错误' });
          writer.write({ type: 'finish', finishReason: 'error' });
        }
      },
    });
  }
}

/** 节点名 → 阶段映射，供前端状态展示 */
function getPhaseForNode(nodeName: string): string {
  const map: Record<string, string> = {
    route: 'planning',
    rewrite: 'planning',
    decompose: 'planning',
    retrieve_prep: 'retrieving',
    tools: 'retrieving',
    relevance_check: 'verifying',
  };
  return map[nodeName] ?? 'planning';
}

function getDetailForNode(nodeName: string, state: AgentState): string {
  switch (nodeName) {
    case 'route':
      return `意图: ${state.routedPlan?.intent ?? 'unknown'} | 需拆解: ${state.routedPlan?.needDecomposition ?? false}`;
    case 'rewrite':
      return `改写完成 → ${state.rewrittenQueries.length} 条查询`;
    case 'decompose':
      return `拆解完成 → ${state.decomposedQuestions?.questions.length ?? 0} 个子问题`;
    case 'tools':
      return `检索完成 → ${state.rerankedHits.length} 条结果`;
    case 'relevance_check':
      return `相关性: ${state.relevanceVerdict ?? 'unknown'}`;
    default:
      return '';
  }
}
