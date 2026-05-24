/**
 * LangGraph Studio Entry — Multi-Agent Orchestrator
 *
 * 从 MultiAgentOrchestratorService 提取 StateGraph 定义，
 * 提供 Mock 依赖（ChatModel/Retrieval/WebSearch），
 * 导出编译后的 graph 供 LangGraph Studio 可视化调试。
 *
 * 用法: cd apps/server && npx @langchain/langgraph-cli dev
 *
 * ============================================================
 * @required 环境变量 (在 apps/server/.env 中配置):
 *   BAILIAN_API_KEY          百炼/OpenAI API 密钥 (必需)
 *   BAILIAN_BASE_URL         百炼 API Base URL
 *   BAILIAN_LLM_MODEL        默认模型名 (默认: qwen-turbo)
 *   BAILIAN_LLM_LIGHT_MODEL  轻量模型名 (默认: qwen-turbo)
 *   TAVILY_API_KEY           Tavily 搜索 API 密钥 (可选，用于联网搜索)
 *   OPENAI_API_KEY           OpenAI API 密钥 (可选，若使用 OpenAI 模型)
 * ============================================================
 */

import { StateGraph, Annotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { extractMessageContent, getErrorMessage } from './common/utils/message.utils';

// ── Schemas ──
import { RoutedQueryPlanSchema } from './modules/chat/schemas/routed-query-plan.schema';
import type { RoutedQueryPlan } from './modules/chat/schemas/routed-query-plan.schema';
import { RewriteOutputSchema } from './modules/chat/schemas/rewritten-query.schema';
import type { RewriteOutput } from './modules/chat/schemas/rewritten-query.schema';
import { DecomposeOutputSchema } from './modules/chat/schemas/decomposed-query.schema';
import type { DecomposeOutput } from './modules/chat/schemas/decomposed-query.schema';
import { AuditResultSchema } from './modules/chat/schemas/audit-result.schema';
import type { AuditResult } from './modules/chat/schemas/audit-result.schema';
import { FactCheckResultSchema } from './modules/chat/schemas/fact-check-result.schema';
import type { FactCheckResult } from './modules/chat/schemas/fact-check-result.schema';
import { CompletenessCheckResultSchema } from './modules/chat/schemas/completeness-check-result.schema';
import type { CompletenessCheckResult } from './modules/chat/schemas/completeness-check-result.schema';

// ── Prompts ──
import { ROUTER_SYSTEM_PROMPT } from './modules/chat/prompts/router.prompt';
import { REWRITE_SYSTEM_PROMPT } from './modules/chat/prompts/rewrite.prompt';
import { WRITER_SYSTEM_PROMPT } from './modules/chat/prompts/writer.prompt';
import { AUDIT_SYSTEM_PROMPT } from './modules/chat/prompts/audit.prompt';
import { DECOMPOSE_SYSTEM_PROMPT } from './modules/chat/prompts/decompose.prompt';
import { RELEVANCE_CHECK_SYSTEM_PROMPT } from './modules/chat/prompts/relevance-check.prompt';
import { FACT_CHECK_SYSTEM_PROMPT } from './modules/chat/prompts/fact-check.prompt';
import { COMPLETENESS_CHECK_SYSTEM_PROMPT } from './modules/chat/prompts/completeness-check.prompt';

// ── Types ──
import type { RerankedHit } from './modules/rag/retrieval/interfaces/reranked-hit.interface';
import type { WebSearchResult } from './modules/rag/web-search/web-search.service';

/** ═══════════════════════════════════════════
 * AgentState (与 Service 中保持严格一致)
 * ═══════════════════════════════════════════ */

const AgentStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  userId: Annotation<number>(),
  originalQuery: Annotation<string>(),
  selectedKbIds: Annotation<string[]>(),
  resolvedKbIds: Annotation<string[]>(),
  routedPlan: Annotation<RoutedQueryPlan | null>(),
  decomposedQueries: Annotation<string[]>(),
  decomposedKeywords: Annotation<string[]>(),
  rewrittenQueries: Annotation<string[]>(),
  rewrittenKeywords: Annotation<string[]>(),
  rerankedHits: Annotation<RerankedHit[]>(),
  webSearchResults: Annotation<WebSearchResult[]>(),
  draftAnswer: Annotation<string>(),
  currentPhase: Annotation<string>(),
  auditVerdict: Annotation<string | null>(),
  relevanceVerdict: Annotation<string | null>(),
  retrievalRetryCount: Annotation<number>(),
  factCheckResult: Annotation<FactCheckResult | null>(),
  factCheckRounds: Annotation<number>(),
  completenessResult: Annotation<CompletenessCheckResult | null>(),
  supplementAnswer: Annotation<string>(),
});

type AgentState = typeof AgentStateAnnotation.State;

/** ═══════════════════════════════════════════
 * Mock 模型选项
 * ═══════════════════════════════════════════ */

interface ChatModelOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  timeout?: number;
}

/** ═══════════════════════════════════════════
 * Mock 服务工厂
 *
 * 与原始服务行为一致但无 NestJS 依赖：
 * - ChatModelService → 直接从环境变量创建 ChatOpenAI
 * - RetrievalService  → 返回空结果（无法连接 Qdrant/ES/Reranker）
 * - AgentTraceService → 无操作，仅控制台日志
 * - WebSearchService  → 若配了 TAVILY_API_KEY 则调用真实 API
 * - EvalQueueService  → 无操作
 * ═══════════════════════════════════════════ */

class MockChatModelService {
  createModel(options: ChatModelOptions = {}): ChatOpenAI {
    const modelName = options.model || this.getLightModelName();
    const apiKey =
      options.apiKey ||
      process.env.BAILIAN_API_KEY ||
      process.env.OPENAI_API_KEY;
    const baseURL =
      options.baseURL || process.env.BAILIAN_BASE_URL || undefined;

    return new ChatOpenAI({
      model: modelName,
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
      streaming: options.streaming ?? true,
      timeout: options.timeout ?? 60000,
    });
  }

  getDefaultModelName(): string {
    return process.env.BAILIAN_LLM_MODEL || 'qwen-turbo';
  }

  getLightModelName(): string {
    return process.env.BAILIAN_LLM_LIGHT_MODEL || 'qwen-turbo';
  }
}

class MockRetrievalService {
  // eslint-disable-next-line @typescript-eslint/require-await
  async retrieve(_params: {
    queries: string[];
    kbIds: string[];
    questionType?: string;
  }) {
    console.log(
      `[MockRetrieval] 检索调用 (返回空结果): queries=${_params.queries.join('; ')}, kbIds=${_params.kbIds.join(', ')}`,
    );
    return {
      denseHits: [] as any[],
      sparseHits: [] as any[],
      fusedHits: [] as any[],
      rerankedHits: [] as RerankedHit[],
      totalDurationMs: 0,
    };
  }
}

class MockAgentTraceService {
  // eslint-disable-next-line @typescript-eslint/require-await
  async createRun(ctx: Record<string, unknown>) {
    const runId = `studio-run-${Date.now()}`;
    console.log(`[MockTrace] createRun: ${runId}`, {
      sessionId: ctx.sessionId,
      query: ctx.originalQuery,
    });
    return runId;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async recordStep(runId: string, step: Record<string, unknown>) {
    console.log(
      `[MockTrace] recordStep: ${runId} | ${String(step.agentName)}/${String(step.stepType)} → ${String(step.status)}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async completeRun(runId: string, _summary: unknown) {
    console.log(`[MockTrace] completeRun: ${runId}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async failRun(runId: string) {
    console.log(`[MockTrace] failRun: ${runId}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async saveEvaluationData(runId: string, _data: unknown) {
    console.log(`[MockTrace] saveEvaluationData: ${runId}`);
  }
}

class MockWebSearchService {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.TAVILY_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
     
    if (!this.isAvailable()) {
      console.log(`[MockWebSearch] TAVILY_API_KEY 未配置，返回空结果`);
      return [];
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
        }),
      });

      if (!response.ok) {
        console.error(`[MockWebSearch] Tavily API 错误: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as { results?: WebSearchResult[] };
      console.log(
        `[MockWebSearch] 搜索 "${query}" → ${data.results?.length ?? 0} 条结果`,
      );
      return data.results ?? [];
    } catch (error) {
      console.error(`[MockWebSearch] 异常: ${getErrorMessage(error)}`);
      return [];
    }
  }
}


/** ═══════════════════════════════════════════
 * Zod Schema (本地定义，与 Service 中严格一致)
 * ═══════════════════════════════════════════ */

const RelevanceCheckSchema = z.object({
  verdict: z
    .enum(['relevant', 'partial', 'not_relevant'])
    .describe('检索结果是否与用户问题相关'),
  relevantCount: z.number().int().describe('相关的分片数量'),
  totalCount: z.number().int().describe('总分片数量'),
  reason: z.string().describe('简要评估理由'),
});

/** ═══════════════════════════════════════════
 * 工具工厂
 * ═══════════════════════════════════════════ */

interface ToolOutput {
  hits: RerankedHit[];
  hitCount: number;
  denseCount: number;
  sparseCount: number;
  durationMs: number;
}

function createSearchTool(
  retrievalService: MockRetrievalService,
  traceService: MockAgentTraceService,
  runId: string,
) {
  return tool(
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
      description:
        '执行知识库混合检索（稠密向量+关键词），返回相关文档分块。',
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
}

/** ═══════════════════════════════════════════
 * 纯节点函数
 *
 * 提取自 MultiAgentOrchestratorService.streamRun()，
 * 去除 SSE 发射逻辑，保留核心编排逻辑。
 * 控制台日志用于 LangGraph Studio 中观察节点执行。
 * ═══════════════════════════════════════════ */

async function routeNode(
  state: AgentState,
  chatModelService: MockChatModelService,
  runId: string,
  traceService: MockAgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Node:route] 开始路由...');
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
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
  console.log(
    `[Node:route] intent=${plan.intent}, questionType=${plan.questionType}, needDecomposition=${plan.needDecomposition}`,
  );

  await traceService.recordStep(runId, {
    agentName: 'router',
    stepType: 'route_query',
    status: 'completed',
    input: { query: state.originalQuery },
    output: { intent: plan.intent, questionType: plan.questionType },
  });

  return { routedPlan: plan, currentPhase: 'planning' };
}

async function decomposeNode(
  state: AgentState,
  chatModelService: MockChatModelService,
  runId: string,
  traceService: MockAgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Node:decompose] 开始拆解查询...');
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
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
    console.log(
      `[Node:decompose] 拆解出 ${queries.length} 个子查询: ${queries.join(' | ')}`,
    );

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
    return {
      decomposedQueries: queries,
      decomposedKeywords: keywords,
      currentPhase: 'planning',
    };
  } catch (error) {
    console.warn(`[Node:decompose] 拆解失败: ${getErrorMessage(error)}`);
    return {
      decomposedQueries: [],
      decomposedKeywords: [],
      currentPhase: 'planning',
    };
  }
}

async function rewriteNode(
  state: AgentState,
  chatModelService: MockChatModelService,
  runId: string,
  traceService: MockAgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Node:rewrite] 开始改写查询...');
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
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
    console.log(
      `[Node:rewrite] 改写出 ${queries.length} 个查询: ${queries.join(' | ')}`,
    );

    await traceService.recordStep(runId, {
      agentName: 'rewriter',
      stepType: 'rewrite_query',
      status: 'completed',
      input: { originalQuery: state.originalQuery },
      output: { queries },
    });

    const rewriteKw = (output.queries as Array<{ keywords?: string }>)
      .flatMap((q) => q.keywords?.split(/[\s,，]+/).filter(Boolean) ?? []);
    return {
      rewrittenQueries: queries,
      rewrittenKeywords: rewriteKw,
      currentPhase: 'planning',
    };
  } catch (error) {
    console.warn(`[Node:rewrite] 改写失败，回退: ${getErrorMessage(error)}`);
    return {
      rewrittenQueries: [state.originalQuery],
      rewrittenKeywords: [],
      currentPhase: 'planning',
    };
  }
}

async function rewriteFallbackNode(
  state: AgentState,
  chatModelService: MockChatModelService,
  runId: string,
  traceService: MockAgentTraceService,
): Promise<Partial<AgentState>> {
  console.log('[Node:rewrite_fallback] 执行更激进的改写...');
  const model = chatModelService.createModel({
    model: chatModelService.getLightModelName(),
    temperature: 0.5,
    streaming: false,
    timeout: 15000,
  });

  const FALLBACK_PROMPT = `${REWRITE_SYSTEM_PROMPT}\n\n【重要】上轮检索结果不够充分，请尝试完全不同的改写角度：换用同义术语、去掉可能限制结果的约束词、从更宽泛的角度切入。`;

  try {
    const structured = model.withStructuredOutput(RewriteOutputSchema, {
      method: 'jsonMode',
    });
    const result = await structured.invoke([
      new SystemMessage(`${FALLBACK_PROMPT}\n\n请以 JSON 格式回复。`),
      new HumanMessage(
        `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}\n上次改写后的查询: ${state.rewrittenQueries.join('; ')}`,
      ),
    ]);

    const output = result as RewriteOutput;
    const queries = output.queries.map((q) => q.rewritten);
    console.log(
      `[Node:rewrite_fallback] 改写出 ${queries.length} 个查询: ${queries.join(' | ')}`,
    );

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
  } catch (error) {
    console.warn(
      `[Node:rewrite_fallback] 改写失败: ${getErrorMessage(error)}`,
    );
    return {
      rewrittenQueries: [state.originalQuery],
      retrievalRetryCount: (state.retrievalRetryCount ?? 0) + 1,
      currentPhase: 'retrieving',
    };
  }
}

async function relevanceCheckNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:relevance_check] 检查检索相关性...');

  if (state.rerankedHits.length === 0) {
    console.log(
      '[Node:relevance_check] 0 条命中 → verdict=not_relevant (shortcut)',
    );
    return { relevanceVerdict: 'not_relevant' as const };
  }

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

  try {
    const structured = model.withStructuredOutput(RelevanceCheckSchema, {
      method: 'jsonMode',
    });
    const result = await structured.invoke([
      new SystemMessage(
        `${RELEVANCE_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`,
      ),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n\n检索结果:\n${snippets || '（无检索结果）'}`,
      ),
    ]);

    const output = result as z.infer<typeof RelevanceCheckSchema>;
    console.log(
      `[Node:relevance_check] verdict=${output.verdict}, relevant=${output.relevantCount}/${output.totalCount}`,
    );
    return { relevanceVerdict: output.verdict };
  } catch (error) {
    console.warn(
      `[Node:relevance_check] 校验失败，降级: ${getErrorMessage(error)}`,
    );
    return {
      relevanceVerdict:
        state.rerankedHits.length > 0 ? 'relevant' : 'not_relevant',
    };
  }
}

async function auditNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:audit] 审计检索充分性...');
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

  try {
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
    console.log(
      `[Node:audit] verdict=${audit.verdict}`,
    );
    return { auditVerdict: audit.verdict };
  } catch (error) {
    console.warn(`[Node:audit] 审计失败，降级: ${getErrorMessage(error)}`);
    const verdict =
      state.rerankedHits.length > 0 ? 'sufficient' : 'insufficient';
    return { auditVerdict: verdict };
  }
}

async function webSearchNode(
  state: AgentState,
  webSearchService: MockWebSearchService,
): Promise<Partial<AgentState>> {
  console.log(`[Node:web_search] 联网搜索: "${state.originalQuery}"`);
  const results = await webSearchService.search(state.originalQuery, 5);
  console.log(`[Node:web_search] 返回 ${results.length} 条结果`);
  return {
    webSearchResults: results,
    retrievalRetryCount: (state.retrievalRetryCount ?? 0) + 1,
    currentPhase: 'retrieving',
  };
}

async function writerNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:writer] 生成回答...');
  const context = buildContextText(state.rerankedHits, state.webSearchResults);
  const prompt = WRITER_SYSTEM_PROMPT.replace('{context}', context);

  const isInsufficient =
    state.auditVerdict === 'insufficient' &&
    (state.retrievalRetryCount ?? 0) >= 2;
  const finalPrompt = isInsufficient
    ? prompt +
      '\n\n⚠️ 注意：当前知识库检索结果可能不足以完整回答该问题，请诚实告知用户当前资料的局限性。'
    : prompt;

  const draftModel = chatModelService.createModel({
    temperature: 0.5,
    streaming: true,
  });

  const lcStream = await draftModel.stream([
    new SystemMessage(finalPrompt),
    new HumanMessage(state.originalQuery),
  ]);

  let answer = '';
  for await (const chunk of lcStream) {
    const text = extractMessageContent(chunk);
    if (text) {
      answer += text;
    }
  }

  console.log(`[Node:writer] 生成完成，${answer.length} 字符`);
  return { draftAnswer: answer, currentPhase: 'writing' };
}

async function factCheckNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:fact_check] 开始事实校验...');
  let factResult: FactCheckResult | null = null;

  try {
    const model = chatModelService.createModel({
      model: chatModelService.getLightModelName(),
      temperature: 0.1,
      streaming: false,
      timeout: 15000,
    });

    const snippets = state.rerankedHits
      .slice(0, 5)
      .map((h, i) => `[来源${i + 1}] ${h.content.slice(0, 500)}`)
      .join('\n---\n');

    const structured = model.withStructuredOutput(FactCheckResultSchema, {
      method: 'jsonMode',
    });
    const result = await structured.invoke([
      new SystemMessage(
        `${FACT_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`,
      ),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n\n检索上下文:\n${snippets}\n\n待审核回答:\n${state.draftAnswer}`,
      ),
    ]);
    factResult = result as FactCheckResult;
    console.log(
      `[Node:fact_check] risk=${factResult.overallRisk}, needRevise=${factResult.needRevise}, items=${factResult.items.length}`,
    );
  } catch (error) {
    console.warn(`[Node:fact_check] 失败，跳过: ${getErrorMessage(error)}`);
    factResult = null;
  }

  return {
    factCheckResult: factResult,
    factCheckRounds: (state.factCheckRounds ?? 0) + 1,
    currentPhase: 'verifying',
  };
}

async function completenessCheckNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:completeness_check] 检查回答完整性...');
  let compResult: CompletenessCheckResult | null = null;

  try {
    const model = chatModelService.createModel({
      model: chatModelService.getLightModelName(),
      temperature: 0.1,
      streaming: false,
      timeout: 15000,
    });

    const structured = model.withStructuredOutput(
      CompletenessCheckResultSchema,
      { method: 'jsonMode' },
    );
    const result = await structured.invoke([
      new SystemMessage(
        `${COMPLETENESS_CHECK_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`,
      ),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n子问题列表: ${(state.decomposedQueries ?? []).join('; ') || '（未拆解）'}\n当前回答: ${state.draftAnswer}`,
      ),
    ]);
    compResult = result as CompletenessCheckResult;
    console.log(
      `[Node:completeness_check] coverage=${compResult.overallCoverage}, missingAspects=${compResult.missingAspects.length}, needSupplement=${compResult.needSupplement}`,
    );
  } catch (error) {
    console.warn(
      `[Node:completeness_check] 失败，跳过: ${getErrorMessage(error)}`,
    );
    compResult = null;
  }

  return {
    completenessResult: compResult,
    currentPhase: 'verifying',
  };
}

async function supplementRetrieveNode(
  state: AgentState,
  retrievalService: MockRetrievalService,
  traceService: MockAgentTraceService,
  runId: string,
): Promise<Partial<AgentState>> {
  console.log('[Node:supplement_retrieve] 补充检索...');
  const missingQueries = (state.completenessResult?.missingAspects ?? [])
    .filter((a) => a.retrievable)
    .map((a) => a.aspect);

  if (missingQueries.length === 0) {
    console.log('[Node:supplement_retrieve] 无可检索的缺失维度，跳过');
    return { currentPhase: 'verifying' };
  }

  console.log(
    `[Node:supplement_retrieve] 补充查询: ${missingQueries.join(' | ')}`,
  );

  const searchTool = createSearchTool(retrievalService, traceService, runId);
  const result = await searchTool.invoke({
    queries: missingQueries,
    kbIds: state.resolvedKbIds,
    questionType: state.routedPlan?.questionType,
  });

  const existingIds = new Set(state.rerankedHits.map((h) => h.chunkId));
  const newHits = result.hits.filter((h) => !existingIds.has(h.chunkId));

  console.log(
    `[Node:supplement_retrieve] 新增 ${newHits.length} 条结果`,
  );
  return {
    rerankedHits: [...state.rerankedHits, ...newHits],
    currentPhase: 'verifying',
  };
}

async function writerSupplementNode(
  state: AgentState,
  chatModelService: MockChatModelService,
): Promise<Partial<AgentState>> {
  console.log('[Node:writer_supplement] 生成补充回答...');
  const missingAspects =
    state.completenessResult?.missingAspects
      .filter((a) => a.retrievable)
      .map((a) => a.aspect)
      .join('、') ?? '';

  const context = buildContextText(
    state.rerankedHits,
    state.webSearchResults,
  );
  const supplementPrompt = `你是 Linsor AI 的智能助手。请基于知识库内容，补充回答以下缺失的维度：${missingAspects}\n\n原始问题: ${state.originalQuery}\n已有回答: ${state.draftAnswer}\n\n请只输出补充内容，不需要重复已有回答。\n\n知识库内容：\n${context}`;

  const suppModel = chatModelService.createModel({
    temperature: 0.5,
    streaming: true,
  });

  const lcStream = await suppModel.stream([
    new SystemMessage(supplementPrompt),
    new HumanMessage(`请补充以下维度的信息：${missingAspects}`),
  ]);

  let supplement = '';
  for await (const chunk of lcStream) {
    const text = extractMessageContent(chunk);
    if (text) {
      supplement += text;
    }
  }

  console.log(`[Node:writer_supplement] 补充 ${supplement.length} 字符`);
  return {
    supplementAnswer: supplement,
    currentPhase: 'writing',
  };
}

/** ═══════════════════════════════════════════
 * 条件边 (与生产环境 Service 中完全一致)
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

  if (enableWebSearch) return 'web_search';
  if (retryCount < 1) return 'rewrite_fallback';
  return 'writer';
}

function completenessEdge(
  state: AgentState,
): '__end__' | 'supplement_retrieve' {
  const result = state.completenessResult;
  if (!result) return '__end__';
  if (
    result.overallCoverage < 0.8 &&
    result.missingAspects.some((a) => a.retrievable)
  ) {
    return 'supplement_retrieve';
  }
  return '__end__';
}

/** ═══════════════════════════════════════════
 * 辅助函数 (与生产环境 Service 中一致)
 * ═══════════════════════════════════════════ */

function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  if (state.decomposedKeywords && state.decomposedKeywords.length > 0)
    queries.push(...state.decomposedKeywords);
  if (state.decomposedQueries.length > 0)
    queries.push(...state.decomposedQueries);
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
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
        (hit.payload['title'] as string) || hit.title || `文档 ${hit.docId}`;
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
 * 图构建工厂
 *
 * 封装所有 Mock 依赖，构建与生产环境拓扑完全一致的
 * StateGraph。图中每个节点输出 console.log，方便在
 * LangGraph Studio 控制台中观察执行路径。
 * ═══════════════════════════════════════════ */

function buildGraph() {
  const chatModelService = new MockChatModelService();
  const retrievalService = new MockRetrievalService();
  const traceService = new MockAgentTraceService();
  const webSearchService = new MockWebSearchService();
  const runId = `studio-${Date.now()}`;

  const enableWebSearch = webSearchService.isAvailable();
  console.log(
    `[StudioGraph] WebSearch ${enableWebSearch ? '已启用' : '未启用 (TAVILY_API_KEY 未配置)'}`,
  );

  const searchTool = createSearchTool(retrievalService, traceService, runId);

  const graph = new StateGraph(AgentStateAnnotation)
    // ── 规划阶段 ──
    .addNode('route', (s) =>
      routeNode(s, chatModelService, runId, traceService),
    )
    .addNode('decompose', (s) =>
      decomposeNode(s, chatModelService, runId, traceService),
    )
    .addNode('rewrite', (s) =>
      rewriteNode(s, chatModelService, runId, traceService),
    )

    // ── 检索阶段 ──
    .addNode('retrieve_prep', () => ({ currentPhase: 'retrieving' }))
    .addNode('tools', async (s) => {
      const queries = buildRetrieveQueries(s);
      console.log(`[Node:tools] 检索查询: ${queries.join(' | ')}`);
      const result = await searchTool.invoke({
        queries,
        kbIds: s.resolvedKbIds,
        questionType: s.routedPlan?.questionType,
      });
      console.log(`[Node:tools] 命中 ${result.hitCount} 条`);
      return {
        rerankedHits: result.hits,
        currentPhase: 'retrieving',
      };
    })

    // ── 检索质量评估 ──
    .addNode('relevance_check', (s) =>
      relevanceCheckNode(s, chatModelService),
    )
    .addNode('audit', (s) => auditNode(s, chatModelService))

    // ── 检索重试 ──
    .addNode('rewrite_fallback', (s) =>
      rewriteFallbackNode(s, chatModelService, runId, traceService),
    )

    // ── 联网搜索 ──
    .addNode('web_search', (s) => webSearchNode(s, webSearchService))

    // ── 生成阶段 ──
    .addNode('writer', (s) => writerNode(s, chatModelService))

    // ── 质量校验 ──
    .addNode('fact_check', (s) => factCheckNode(s, chatModelService))
    .addNode('completeness_check', (s) =>
      completenessCheckNode(s, chatModelService),
    )

    // ── 补充检索 & 补充回答 ──
    .addNode('supplement_retrieve', (s) =>
      supplementRetrieveNode(s, retrievalService, traceService, runId),
    )
    .addNode('writer_supplement', (s) =>
      writerSupplementNode(s, chatModelService),
    )

    // ══════ 边 (拓扑与生产环境完全一致) ══════
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
    .addEdge('writer', 'fact_check')
    .addEdge('fact_check', 'completeness_check')
    .addConditionalEdges('completeness_check', completenessEdge, {
      supplement_retrieve: 'supplement_retrieve',
      __end__: '__end__',
    })
    .addEdge('supplement_retrieve', 'writer_supplement')
    .addEdge('writer_supplement', '__end__')
    .compile();

  return graph;
}

/** ═══════════════════════════════════════════
 * 导出
 * ═══════════════════════════════════════════ */

/** 编译后的 StateGraph，供 LangGraph Studio 可视化/调试 */
export const compiledGraph = buildGraph();

/**
 * 以默认初始状态执行一次完整编排（便捷测试入口）。
 *
 * ```ts
 * import { runWithDefaults } from './studio-entry'
 * const state = await runWithDefaults("量子计算的最新进展")
 * console.log(state.draftAnswer)
 * ```
 */
export async function runWithDefaults(query: string): Promise<AgentState> {
  const graph = buildGraph();
  const result = await graph.invoke({
    sessionId: 'studio-session',
    userId: 1,
    originalQuery: query,
    selectedKbIds: [],
    resolvedKbIds: [],
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
    factCheckResult: null,
    factCheckRounds: 0,
    completenessResult: null,
    supplementAnswer: '',
  } satisfies AgentState);
  return result;
}

export { AgentStateAnnotation, buildGraph };
export type { AgentState };
