import { Injectable, Inject } from '@nestjs/common';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createUIMessageStream } from 'ai';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RetrievalService } from '../../rag/retrieval/retrieval.service';
import { WebSearchService } from '../../rag/web-search/web-search.service';
import { AgentTraceService } from './agent-trace.service';
import type { AgentRunContext } from './agent-trace.service';
import type { WebSearchResult } from '../../rag/web-search/web-search.service';

import type { RerankedHit } from '../../rag/retrieval/interfaces/reranked-hit.interface';
import { RoutedQueryPlanSchema } from '../schemas/routed-query-plan.schema';
import type { RoutedQueryPlan } from '../schemas/routed-query-plan.schema';
import { RewriteOutputSchema } from '../schemas/rewritten-query.schema';
import type { RewriteOutput } from '../schemas/rewritten-query.schema';
import { ROUTER_SYSTEM_PROMPT } from '../prompts/router.prompt';
import { REWRITE_SYSTEM_PROMPT } from '../prompts/rewrite.prompt';
import { WRITER_SYSTEM_PROMPT } from '../prompts/writer.prompt';

const MIN_KB_RESULTS = 3;
const MIN_RERANK_SCORE = 0.5;

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
  rewrittenQueries: Annotation<string[]>(),
  rerankedHits: Annotation<RerankedHit[]>(),
  webSearchResults: Annotation<WebSearchResult[]>(),
  draftAnswer: Annotation<string>(),
  currentPhase: Annotation<string>(),
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
 * Node 函数
 * ═══════════════════════════════════════════ */

async function routeQueryNode(
  state: AgentState,
  chatModelService: ChatModelService,
  runId: string,
  traceService: AgentTraceService,
): Promise<Partial<AgentState>> {
  const model = chatModelService.createModel({
    model: 'qwen-turbo',
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
    model: 'qwen-turbo',
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

/** ═══════════════════════════════════════════
 * 条件边
 * ═══════════════════════════════════════════ */

function shouldSkipRetrieval(state: AgentState): 'rewrite' | 'writer' {
  if (state.routedPlan?.intent === 'greeting') return 'writer';
  return 'rewrite';
}

function shouldSearchWeb(state: AgentState): 'web_search' | 'writer' {
  if (state.rerankedHits.length < MIN_KB_RESULTS) return 'web_search';
  const top1Score = state.rerankedHits[0]?.rerankScore ?? 0;
  if (top1Score < MIN_RERANK_SCORE) return 'web_search';
  return 'writer';
}

/** ═══════════════════════════════════════════
 * 辅助
 * ═══════════════════════════════════════════ */

function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
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
   * 流式执行多智能体编排。
   *
   * 全部流程由 LangGraph StateGraph 管理：
   *
   *   __start__ → route → [greeting? → writer] → rewrite → retrieve_prep
   *     → tools → [shouldSearchWeb? → web_search] → writer → __end__
   */
  streamRun(
    runCtx: AgentRunContext,
    options?: {
      enableWebSearch?: boolean;
      onFinish?: (result: { content: string; citations: RerankedHit[] }) => Promise<void>;
      onError?: () => Promise<void>;
    },
  ): ReadableStream<any> {
    const { enableWebSearch = false, onFinish, onError } = options ?? {};
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const msgId = 'rag-msg-1';
        const runId = await self.agentTraceService.createRun(runCtx);

        const searchTool = createSearchTool(
          self.retrievalService,
          self.agentTraceService,
          runId,
        );

        const emitStatus = (phase: string, detail: string) => {
          writer.write({
            type: 'data-agent-status',
            data: { type: 'agent-status', phase, detail },
          } as any);
        };

        try {
          // ══════ 构建图 ══════
          const graph = new StateGraph(AgentStateAnnotation)
            .addNode('route', (s) =>
              routeQueryNode(s, self.chatModelService, runId, self.agentTraceService),
            )
            .addNode('rewrite', (s) =>
              rewriteQueryNode(s, self.chatModelService, runId, self.agentTraceService),
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
            .addNode('web_search', async (s) => {
              const results = await self.webSearchService.search(s.originalQuery, 5);
              return { webSearchResults: results, currentPhase: 'retrieving' };
            })
            .addNode('writer', async (s) => {
              emitStatus('writing', '正在生成回答...');
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

              let answer = '';
              for await (const chunk of lcStream) {
                const text = extractContent(chunk);
                if (text) {
                  answer += text;
                  writer.write({ type: 'text-delta', id: msgId, delta: text });
                }
              }

              // 引用快照
              const citations = s.rerankedHits.slice(0, 5);
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

              return { draftAnswer: answer, currentPhase: 'writing' };
            })

            // --- 边 ---
            .addEdge('__start__', 'route')
            .addConditionalEdges('route', shouldSkipRetrieval, {
              rewrite: 'rewrite',
              writer: 'writer',
            })
            .addEdge('rewrite', 'retrieve_prep')
            .addEdge('retrieve_prep', 'tools')
            .addConditionalEdges('tools', (s) => {
              if (enableWebSearch && shouldSearchWeb(s) === 'web_search') return 'web_search';
              return 'writer';
            }, {
              web_search: 'web_search',
              writer: 'writer',
            })
            .addEdge('web_search', 'writer')
            .addEdge('writer', '__end__')
            .compile();

          // ══════ 执行 ══════
          emitStatus('planning', '开始分析...');
          const graphStream = await graph.stream(
            {
              sessionId: runCtx.sessionId,
              userId: runCtx.userId,
              originalQuery: runCtx.originalQuery,
              selectedKbIds: runCtx.selectedKbIds,
              resolvedKbIds: runCtx.resolvedKbIds,
              routedPlan: null,
              rewrittenQueries: [],
              rerankedHits: [],
              webSearchResults: [],
              draftAnswer: '',
              currentPhase: 'planning',
            } satisfies AgentState,
            { streamMode: 'updates' },
          );

          const state: Partial<AgentState> = {};
          for await (const chunk of graphStream) {
            const [nodeName, nodeUpdate] = Object.entries(chunk)[0];
            Object.assign(state, nodeUpdate);
            emitStatus(
              getPhaseForNode(nodeName),
              getDetailForNode(nodeName, state as AgentState),
            );
          }

          emitStatus('done', '完成');

          if (onFinish) {
            await onFinish({
              content: (state as AgentState).draftAnswer ?? '',
              citations: (state as AgentState).rerankedHits?.slice(0, 5) ?? [],
            });
          }

          writer.write({ type: 'finish', finishReason: 'stop' } as any);
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          self.logger.error(`[Orchestrator] 流式编排失败: ${errMsg}`);
          if (onError) await onError();
          writer.write({ type: 'error', errorText: errMsg || '未知错误' } as any);
          writer.write({ type: 'finish', finishReason: 'error' } as any);
        }
      },
    });
  }
}

/** ── 节点 → 前端阶段映射 ── */
function getPhaseForNode(nodeName: string): string {
  const map: Record<string, string> = {
    route: 'planning',
    rewrite: 'planning',
    retrieve_prep: 'retrieving',
    tools: 'retrieving',
    web_search: 'retrieving',
    writer: 'writing',
  };
  return map[nodeName] ?? 'planning';
}

function getDetailForNode(nodeName: string, state: AgentState): string {
  switch (nodeName) {
    case 'route':
      return `意图: ${state.routedPlan?.intent ?? 'unknown'}`;
    case 'rewrite':
      return `改写完成 → ${state.rewrittenQueries.length} 条查询`;
    case 'tools':
      return `检索完成 → ${state.rerankedHits.length} 条结果`;
    case 'web_search':
      return `联网搜索完成 → ${state.webSearchResults.length} 条结果`;
    case 'writer':
      return `回答生成完成 → ${(state.draftAnswer ?? '').length} 字`;
    default:
      return '';
  }
}
