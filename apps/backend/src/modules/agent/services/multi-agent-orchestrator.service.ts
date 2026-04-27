import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatModelService } from '../../ai/chat-model.service';
import { RetrievalService } from '../../retrieval/services/retrieval.service';
import { CitationService } from '../../retrieval/services/citation.service';
import { AgentTraceService } from './agent-trace.service';
import type { AgentRunContext, AgentStepRecord } from './agent-trace.service';
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
import type { RerankedHit } from '../../retrieval/interfaces/reranked-hit.interface';

/** Agent 工作流状态 */
export interface AgentGraphState {
  sessionId: string;
  userId: number;
  originalQuery: string;
  selectedKbIds: string[];
  resolvedKbIds: string[];
  routedPlan: RoutedQueryPlan | null;
  rewrittenQueries: string[];
  decomposedQuestions: DecomposeOutput | null;
  rerankedHits: RerankedHit[];
  draftAnswer: string;
  factCheckResult: FactCheckResult | null;
  completenessResult: CompletenessCheckResult | null;
  fallbackCount: number;
}

/** 工作流阶段状态回调 */
export interface AgentStatusCallback {
  (phase: string, detail?: string): void;
}

/** 一次完整的 Agent Run 结果 */
export interface AgentRunResult {
  finalAnswer: string;
  citations: RerankedHit[];
  traceId: string;
  totalDurationMs: number;
  totalTokens: number;
}

/** 回退上限 */
const MAX_FALLBACK = 2;

@Injectable()
export class MultiAgentOrchestratorService {
  constructor(
    private readonly chatModelService: ChatModelService,
    private readonly retrievalService: RetrievalService,
    private readonly citationService: CitationService,
    private readonly agentTraceService: AgentTraceService,
  ) {}

  /**
   * 执行完整的 Agentic RAG 工作流。
   *
   * 流程：Route → Rewrite → Decompose(可选) → Retrieve → Rerank →
   *       Relevance Check ⇄ Rewrite(回退) → Draft → Fact Check ⇄
   *       Draft(修正) → Completeness Check ⇄ Retrieve(补充) → Finalize
   */
  async run(
    runCtx: AgentRunContext,
    onStatus?: AgentStatusCallback,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const runId = await this.agentTraceService.createRun(runCtx);
    let totalTokens = 0;

    // 初始化状态
    const state: AgentGraphState = {
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
    };

    // ─── 阶段 1: 规划 (Planning) ───
    onStatus?.('planning', '分析问题意图');

    // 1.1 路由
    state.routedPlan = await this.routeQuery(state, runId);
    totalTokens += 200; // 估算 token

    // 非 RAG 意图直接进入生成
    if (state.routedPlan.intent === 'greeting') {
      state.draftAnswer =
        '你好！我是 Linsor AI 智能助手，有什么可以帮助你的吗？';
      onStatus?.('done', '完成');
      await this.agentTraceService.completeRun(runId, {
        totalTokens,
        totalDurationMs: Date.now() - startedAt,
      });
      return {
        finalAnswer: state.draftAnswer,
        citations: [],
        traceId: runId,
        totalDurationMs: Date.now() - startedAt,
        totalTokens,
      };
    }

    // 1.2 改写查询
    onStatus?.('planning', '改写查询');
    state.rewrittenQueries = await this.rewriteQuery(state, runId);
    totalTokens += 200;

    // 1.3 拆解子问题（必要时）
    if (state.routedPlan.needDecomposition) {
      onStatus?.('planning', '拆解子问题');
      state.decomposedQuestions = await this.decomposeQuestion(state, runId);
      totalTokens += 300;
    }

    // ─── 阶段 2: 检索 (Retrieving) ───
    onStatus?.('retrieving', '执行混合检索');

    const retrieveQueries = this.buildRetrieveQueries(state);
    const retrieveResult = await this.retrievalService.retrieve({
      queries: retrieveQueries,
      kbIds: state.resolvedKbIds,
      questionType: state.routedPlan.questionType,
    });
    state.rerankedHits = retrieveResult.rerankedHits;
    totalTokens += 100;

    await this.recordAgentStep(runId, {
      agentName: 'retriever',
      stepType: 'hybrid_retrieve',
      status: 'completed',
      input: { queries: retrieveQueries, kbIds: state.resolvedKbIds },
      output: {
        denseCount: retrieveResult.denseHits.length,
        sparseCount: retrieveResult.sparseHits.length,
        fusedCount: retrieveResult.fusedHits.length,
        rerankedCount: retrieveResult.rerankedHits.length,
      },
      durationMs: retrieveResult.totalDurationMs,
    });

    // ─── 阶段 3: 校验 (Verifying) ───
    onStatus?.('verifying', '相关性校验');

    // 3.1 相关性检查（含回退）
    const relevanceResult = await this.checkRelevance(state, runId);
    totalTokens += 200;

    if (
      relevanceResult === 'not_relevant' &&
      state.fallbackCount < MAX_FALLBACK
    ) {
      state.fallbackCount++;
      onStatus?.('planning', `相关性不足，重新改写查询 (第 ${state.fallbackCount} 次)`);

      // 回退到 Rewrite
      state.rewrittenQueries = await this.rewriteQuery(state, runId);

      // 重新检索
      onStatus?.('retrieving', '重新检索');
      const retryResult = await this.retrievalService.retrieve({
        queries: state.rewrittenQueries,
        kbIds: state.resolvedKbIds,
      });
      state.rerankedHits = retryResult.rerankedHits;
    }

    // ─── 阶段 4: 生成 (Writing) ───
    onStatus?.('writing', '生成回答草稿');

    state.draftAnswer = await this.draftAnswer(state, runId);
    totalTokens += 500 + state.draftAnswer.length / 4;

    // ─── 阶段 5: 事实校验 ───
    onStatus?.('verifying', '事实校验');
    state.factCheckResult = await this.factCheck(state, runId);
    totalTokens += 400;

    // 高风险则修正
    if (
      state.factCheckResult.overallRisk === 'high' &&
      state.fallbackCount < MAX_FALLBACK
    ) {
      state.fallbackCount++;
      onStatus?.('writing', '修正事实错误');
      state.draftAnswer = await this.draftAnswer(state, runId, true);
      totalTokens += 500;
    }

    // ─── 阶段 6: 完整性校验 ───
    onStatus?.('verifying', '完整性校验');
    state.completenessResult = await this.checkCompleteness(state, runId);
    totalTokens += 300;

    // 不完整则尝试补充检索
    if (
      state.completenessResult.needSupplement &&
      state.fallbackCount < MAX_FALLBACK
    ) {
      state.fallbackCount++;
      const missingAspects = state.completenessResult.missingAspects
        .filter((m) => m.retrievable)
        .map((m) => m.aspect);

      if (missingAspects.length > 0) {
        onStatus?.('retrieving', '补充检索缺失维度');
        const supplementResult = await this.retrievalService.retrieve({
          queries: missingAspects,
          kbIds: state.resolvedKbIds,
        });

        // 合并补充结果
        const existing = new Set(state.rerankedHits.map((h) => h.chunkId));
        for (const hit of supplementResult.rerankedHits) {
          if (!existing.has(hit.chunkId)) {
            state.rerankedHits.push(hit);
            existing.add(hit.chunkId);
          }
        }
        state.rerankedHits.sort((a, b) => b.rerankScore - a.rerankScore);

        onStatus?.('writing', '补充回答');
        state.draftAnswer = await this.draftAnswer(state, runId);
        totalTokens += 500;
      }
    }

    // ─── 完成 ───
    onStatus?.('done', '完成');

    const totalDurationMs = Date.now() - startedAt;
    await this.agentTraceService.completeRun(runId, {
      totalTokens: Math.round(totalTokens),
      totalDurationMs,
    });

    return {
      finalAnswer: state.draftAnswer,
      citations: state.rerankedHits.slice(0, 5),
      traceId: runId,
      totalDurationMs,
      totalTokens: Math.round(totalTokens),
    };
  }

  // ═══════════════════════════════════════════════
  //  节点方法
  // ═══════════════════════════════════════════════

  /**
   * 路由节点：分析意图、是否需要拆解、是否需要联网搜索。
   */
  private async routeQuery(
    state: AgentGraphState,
    runId: string,
  ): Promise<RoutedQueryPlan> {
    const model = this.chatModelService.createModel({
      temperature: 0.2,
      streaming: false,
    });
    const structured = model.withStructuredOutput(RoutedQueryPlanSchema);

    const result = await structured.invoke([
      new SystemMessage(ROUTER_SYSTEM_PROMPT),
      new HumanMessage(state.originalQuery),
    ]);

    await this.recordAgentStep(runId, {
      agentName: 'router',
      stepType: 'route_query',
      status: 'completed',
      input: { query: state.originalQuery },
      output: { plan: result as unknown as Record<string, unknown> },
    });

    return result as RoutedQueryPlan;
  }

  /**
   * 改写节点：将原始查询改写为 1~3 条检索优化查询。
   */
  private async rewriteQuery(
    state: AgentGraphState,
    runId: string,
  ): Promise<string[]> {
    const model = this.chatModelService.createModel({
      temperature: 0.3,
      streaming: false,
    });
    const structured = model.withStructuredOutput(RewriteOutputSchema);

    const result = await structured.invoke([
      new SystemMessage(REWRITE_SYSTEM_PROMPT),
      new HumanMessage(
        `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}\n当前是第 ${state.fallbackCount + 1} 轮检索`,
      ),
    ]);

    const output = result as RewriteOutput;

    await this.recordAgentStep(runId, {
      agentName: 'rewriter',
      stepType: 'rewrite_query',
      status: 'completed',
      input: { originalQuery: state.originalQuery },
      output: { queries: output.queries.map((q) => q.rewritten) },
    });

    return output.queries.map((q) => q.rewritten);
  }

  /**
   * 拆解节点：将复杂问题拆解为多个子问题。
   */
  private async decomposeQuestion(
    state: AgentGraphState,
    runId: string,
  ): Promise<DecomposeOutput> {
    const model = this.chatModelService.createModel({
      temperature: 0.3,
      streaming: false,
    });
    const structured = model.withStructuredOutput(DecomposeOutputSchema);

    const result = await structured.invoke([
      new SystemMessage(DECOMPOSE_SYSTEM_PROMPT),
      new HumanMessage(
        `原始问题: ${state.originalQuery}\n改写查询: ${state.rewrittenQueries.join('；')}`,
      ),
    ]);

    const output = result as DecomposeOutput;

    await this.recordAgentStep(runId, {
      agentName: 'decomposer',
      stepType: 'decompose_question',
      status: 'completed',
      input: { query: state.originalQuery },
      output: {
        questions: output.questions.map((q) => q.subQuestion),
        dependency: output.dependency,
      },
    });

    return output;
  }

  /**
   * 相关性校验：判断检索结果是否与查询相关。
   */
  private async checkRelevance(
    state: AgentGraphState,
    runId: string,
  ): Promise<'relevant' | 'partial' | 'not_relevant'> {
    if (!state.rerankedHits.length) {
      return 'not_relevant';
    }

    const model = this.chatModelService.createModel({
      temperature: 0.1,
      streaming: false,
    });

    const chunksSummary = state.rerankedHits
      .slice(0, 5)
      .map((h, i) => `[${i + 1}] ${h.content.slice(0, 300)}`)
      .join('\n---\n');

    const msg = await model.invoke([
      new SystemMessage(RELEVANCE_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `用户查询: ${state.originalQuery}\n\n检索到的分片内容:\n${chunksSummary}\n\n请判断这些内容的相关性。请用 JSON 格式回复：{"verdict":"relevant|partial|not_relevant","relevantCount":数字,"totalCount":数字,"reason":"简要理由","suggestion":"下一步建议"}`,
      ),
    ]);

    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => (c as { text: string }).text ?? '').join('')
          : '';

    try {
      const json = JSON.parse(
        content.replace(/```json\s*/g, '').replace(/```\s*/g, ''),
      );
      const verdict = json.verdict as string;

      await this.recordAgentStep(runId, {
        agentName: 'verifier',
        stepType: 'relevance_check',
        status: 'completed',
        input: { query: state.originalQuery, hitCount: state.rerankedHits.length },
        output: json,
      });

      if (verdict === 'relevant' || verdict === 'partial' || verdict === 'not_relevant') {
        return verdict;
      }
      return 'partial';
    } catch {
      return 'partial';
    }
  }

  /**
   * 生成节点：基于检索到的上下文生成回答。
   */
  private async draftAnswer(
    state: AgentGraphState,
    _runId: string,
    isRevision = false,
  ): Promise<string> {
    const model = this.chatModelService.createModel({
      temperature: 0.5,
      streaming: false,
    });

    const context = this.buildContextText(state.rerankedHits);
    let prompt = WRITER_SYSTEM_PROMPT.replace('{context}', context);

    if (isRevision && state.factCheckResult) {
      const issues = state.factCheckResult.items
        .filter((i) => i.verdict !== 'supported')
        .map((i) => `- "${i.statement}": ${i.verdict} (证据: ${i.evidence})`)
        .join('\n');
      prompt += `\n\n上一版回答存在以下事实问题，请修正：\n${issues}`;
    }

    const msg = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(state.originalQuery),
    ]);

    return typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('')
        : '';
  }

  /**
   * 事实校验节点：逐条核验回答中的事实陈述。
   */
  private async factCheck(
    state: AgentGraphState,
    runId: string,
  ): Promise<FactCheckResult> {
    const model = this.chatModelService.createModel({
      temperature: 0.1,
      streaming: false,
    });
    const structured = model.withStructuredOutput(FactCheckResultSchema);

    const context = this.buildContextText(state.rerankedHits);

    const result = await structured.invoke([
      new SystemMessage(FACT_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `用户问题: ${state.originalQuery}\n\n回答内容:\n${state.draftAnswer}\n\n检索到的知识库内容:\n${context}`,
      ),
    ]);

    const output = result as FactCheckResult;

    await this.recordAgentStep(runId, {
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

    return output;
  }

  /**
   * 完整性校验节点：检查回答是否完整覆盖所有分析维度。
   */
  private async checkCompleteness(
    state: AgentGraphState,
    runId: string,
  ): Promise<CompletenessCheckResult> {
    const model = this.chatModelService.createModel({
      temperature: 0.1,
      streaming: false,
    });
    const structured = model.withStructuredOutput(
      CompletenessCheckResultSchema,
    );

    const subQuestions = state.decomposedQuestions?.questions
      .map((q) => q.subQuestion)
      .join('；') ?? '未拆解';

    const result = await structured.invoke([
      new SystemMessage(COMPLETENESS_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `原始问题: ${state.originalQuery}\n子问题: ${subQuestions}\n\n回答内容:\n${state.draftAnswer}`,
      ),
    ]);

    const output = result as CompletenessCheckResult;

    await this.recordAgentStep(runId, {
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

    return output;
  }

  // ═══════════════════════════════════════════════
  //  辅助方法
  // ═══════════════════════════════════════════════

  /**
   * 构建检索查询列表。
   */
  private buildRetrieveQueries(state: AgentGraphState): string[] {
    const queries: string[] = [state.originalQuery];

    if (state.rewrittenQueries.length > 0) {
      queries.push(...state.rewrittenQueries);
    }

    if (state.decomposedQuestions) {
      queries.push(
        ...state.decomposedQuestions.questions.map((q) => q.subQuestion),
      );
    }

    return [...new Set(queries)].slice(0, 8);
  }

  /**
   * 将精排结果拼接为 LLM 可消费的上下文字符串。
   */
  private buildContextText(hits: RerankedHit[]): string {
    if (!hits.length) {
      return '（未检索到相关上下文）';
    }

    return hits
      .map((hit, index) => {
        const docTitle =
          (hit.payload['title'] as string) || hit.title || `文档 ${hit.docId}`;
        const scorePercent = Math.round(hit.rerankScore * 100);
        return `[来源 ${index + 1}] 文档: ${docTitle} | 相关度: ${scorePercent}%\n${hit.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * 记录 Agent Step 轨迹。
   */
  private async recordAgentStep(
    runId: string,
    step: AgentStepRecord,
  ): Promise<void> {
    await this.agentTraceService.recordStep(runId, step);
  }
}
