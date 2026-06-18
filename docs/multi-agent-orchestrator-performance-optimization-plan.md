# Multi-Agent Orchestrator 性能优化实施计划

## Context

当前编排链路为 14 节点 LangGraph 全串行。writer 流式输出后，同步等待 `fact_check → completeness_check → [supplement_retrieve → writer_supplement | __end__]`，HTTP 连接持续挂起 3~6 秒。

最近提交 `bc15cea`（citation clickable view）在 `tools` 节点中增加了 Prisma 知识库名称查询和 `documents` 数组推送。这些改动与优化方案无冲突——`tools` 节点保留，`supplement_retrieve` 将被移除。

**优化方向**：writer 流式输出后立即 `__end__` 释放连接。所有 post-writer 校验/补充逻辑全量转为离线异步。不再进行内容补充。

## 最终链路（优化后）

```
__start__ → route → [decompose → rewrite] | rewrite → retrieve_prep → tools → relevance_check
  → [audit → writer | rewrite_fallback ⇄ tools | web_search → writer]
  → writer → __end__
```

**节点变化（14 → 10）**：

| 操作 | 节点 | 说明 |
|------|------|------|
| 删除 | `fact_check` | → 离线异步 `runAsyncValidation()` |
| 删除 | `completeness_check` | → 离线异步 `runAsyncValidation()` |
| 删除 | `supplement_retrieve` | 不再补充内容 |
| 删除 | `writer_supplement` | 不再补充内容 |

---

## Step 1：精简 JSON Schema（去掉 reason/reasoning）

### 1.1 `routed-query-plan.schema.ts`

```diff
  export const RoutedQueryPlanSchema = z.object({
    intent: z.enum(['greeting', 'fact_lookup', 'compare_analysis', 'research_or_open_world']),
    needDecomposition: z.boolean(),
    needWebSearch: z.boolean(),
-   reasoning: z.string().describe('路由决策的简要推理过程'),
    questionType: z.enum(['fact_lookup', 'compare_analysis', 'research_or_open_world']).default('fact_lookup'),
  });
```

### 1.2 `audit-result.schema.ts`

```diff
  export const AuditResultSchema = z.object({
    verdict: z.enum(['sufficient', 'insufficient']),
-   reason: z.string().describe('简要评估理由'),
  });
```

### 1.3 `multi-agent-orchestrator.service.ts` — RelevanceCheckSchema（第 92-99 行）

```diff
  const RelevanceCheckSchema = z.object({
    verdict: z.enum(['relevant', 'partial', 'not_relevant']),
    relevantCount: z.number().int(),
    totalCount: z.number().int(),
-   reason: z.string().describe('简要评估理由'),
  });
```

### 1.4 `router.prompt.ts`

```diff
-   "reasoning": "简要推理过程",
  }
  ```
- 
- - reasoning: 简要推理过程，说明为什么做出上述路由决策
```

### 1.5 `audit.prompt.ts`

```diff
- { "verdict": "sufficient" 或 "insufficient", "reason": "一句话说明判断依据" }
+ { "verdict": "sufficient" 或 "insufficient" }
```

### 1.6 `relevance-check.prompt.ts`

```diff
-   "reason": "简要评估理由",
-   "suggestion": "建议继续后续流程",
  }
  ```
```

> 注：`suggestion` 字段在 Zod schema 中早已不存在，但 prompt 中还有，导致 LLM 白白生成后被 schema 丢弃。一并删除。

---

## Step 2：writer 之后全链路异步化（核心改动）

**文件**：`apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

### 2.1 图中删除 4 个节点

删除以下 `.addNode(...)` 块：
- `fact_check`（约 973-1041 行）
- `completeness_check`（约 1044-1105 行）
- `supplement_retrieve`（约 1107-1187 行）
- `writer_supplement`（约 1189-1247 行）

### 2.2 边改动

```diff
  .addEdge('web_search', 'writer')
  .addEdge('rewrite_fallback', 'tools')
- .addEdge('writer', 'fact_check')
- .addEdge('fact_check', 'completeness_check')
- /* @deprecated writer_correct 修正环 — 离线化预留
- .addConditionalEdges('fact_check', factCheckEdge, {
-   completeness_check: 'completeness_check',
-   writer_correct: 'writer_correct',
- })
- .addEdge('writer_correct', 'fact_check')
- */
- .addConditionalEdges('completeness_check', completenessEdge, {
-   supplement_retrieve: 'supplement_retrieve',
-   __end__: '__end__',
- })
- .addEdge('supplement_retrieve', 'writer_supplement')
- .addEdge('writer_supplement', '__end__')
+ .addEdge('writer', '__end__')
  .compile();
```

### 2.3 删除 `completenessEdge` 辅助函数

约 489-501 行的 `completenessEdge` 条件路由函数。

### 2.4 State 瘦身

`AgentStateAnnotation` 中删除：
```diff
- factCheckResult: Annotation<FactCheckResult | null>(),
- factCheckRounds: Annotation<number>(),
- completenessResult: Annotation<CompletenessCheckResult | null>(),
- supplementAnswer: Annotation<string>(),
```

`graph.invoke(initialState)` 中移除对应初始化。

### 2.5 数据写入策略：核心数据同步 + 校验结果异步追加

**关键发现**：离线评估流水线（`EvalPipelineService`）只从 `metadata_json` 读取 3 个字段——`originalQuery`、`draftAnswer`、`rerankedHits`。**完全不依赖** `factCheckResult` 和 `completenessResult`。

因此采用**分两次写入**的策略：

```
graph.invoke() 完成
  ↓
saveEvaluationData({ originalQuery, draftAnswer, rerankedHits, ... })  ← 同步 fire-and-forget
  ↓                                           （eval 流水线所需的字段全部就位）
completeRun()
  ↓
await onFinish(...)
  ↓
enqueueEvaluation()  ← eval job 入队时 metadata_json 已就位
  ↓
RUN_FINISHED  ← 释放 HTTP 连接
  ↓
runAsyncValidation()  ← 异步 fire-and-forget，只跑 fact_check + completeness_check
  ↓                     完成后 merge 写入 metadata_json（追加 factCheckResult + completenessResult）
```

### 2.6 新增 `mergeEvaluationData` 方法

文件：`apps/server/src/modules/chat/services/agent-trace.service.ts`

```typescript
/**
 * 合并写入评估数据（追加字段，不覆盖已有数据）。
 * 用于异步校验完成后追加 factCheckResult / completenessResult。
 */
async mergeEvaluationData(runId: string, partial: Record<string, unknown>): Promise<void> {
  const run = await this.prisma.b_agent_runs.findUnique({
    where: { id: runId },
    select: { metadata_json: true },
  });
  const existing = (run?.metadata_json as Record<string, unknown>) ?? {};
  await this.prisma.b_agent_runs.update({
    where: { id: runId },
    data: { metadata_json: { ...existing, ...partial } as Prisma.InputJsonValue },
  });
}
```

### 2.7 新增 `runAsyncValidation` 私有方法

文件：`apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

只跑 fact_check 和 completeness_check，完成后通过 `mergeEvaluationData` 追加写入（不覆盖已同步写入的核心数据）。

```typescript
/**
 * 离线异步执行事实核查和完整性检查。
 * 核心评估数据（originalQuery/draftAnswer/rerankedHits）已同步写入，
 * 此方法仅追加 factCheckResult 和 completenessResult 到 metadata_json。
 */
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

    // fact_check
    const factModel = model.withStructuredOutput(FactCheckResultSchema, { method: 'jsonMode' });
    const factResult = await factModel.invoke([
      new SystemMessage(FACT_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `用户问题: ${params.originalQuery}\n\n检索上下文:\n${snippets}\n\n待审核回答:\n${params.draftAnswer}`,
      ),
    ]);

    // completeness_check
    const compModel = model.withStructuredOutput(CompletenessCheckResultSchema, { method: 'jsonMode' });
    const compResult = await compModel.invoke([
      new SystemMessage(COMPLETENESS_CHECK_SYSTEM_PROMPT),
      new HumanMessage(
        `用户问题: ${params.originalQuery}\n\n回答:\n${params.draftAnswer}`,
      ),
    ]);

    // 追加写入（与已同步写入的核心数据合并）
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
```

### 2.8 更新 post-graph-invoke 流程

```diff
  const finalState = await graph.invoke({ ... });

- writer.write({
-   type: 'VALIDATION_COMPLETED',
-   factCheckRisk: ...,
-   completenessCoverage: ...,
-   supplementAdded: ...,
- });

+ const state = finalState as unknown as AgentState;

  // ✅ 核心评估数据同步写入（eval 流水线需要 originalQuery/draftAnswer/rerankedHits）
  self.agentTraceService
    .saveEvaluationData(runId, {
      originalQuery: state.originalQuery,
      draftAnswer: state.draftAnswer,
-     supplementAnswer: state.supplementAnswer,
      rewrittenQueries: state.rewrittenQueries,
      rewrittenKeywords: state.rewrittenKeywords ?? [],
      decomposedQueries: state.decomposedQueries,
      rerankedHits: (state.rerankedHits ?? []).map((h) => ({
        chunkId: h.chunkId, docId: h.docId, kbId: h.kbId,
        content: h.content, title: h.title,
        fusionScore: h.fusionScore, rerankScore: h.rerankScore,
      })),
-     factCheckResult: state.factCheckResult,
-     completenessResult: state.completenessResult,
      auditVerdict: state.auditVerdict,
      relevanceVerdict: state.relevanceVerdict,
      retrievalRetryCount: state.retrievalRetryCount ?? 0,
-     factCheckRounds: state.factCheckRounds ?? 0,
    })

  // completeRun 保持不变
  self.agentTraceService.completeRun(runId, { totalTokens: 0, totalDurationMs: Date.now() - startedAt })

  if (onFinish) {
-   const fullContent = (state.draftAnswer ?? '')
-     + (state.supplementAnswer ? '\n\n---\n**补充内容：**\n' + state.supplementAnswer : '');
+   const fullContent = state.draftAnswer ?? '';
    const finishResult = await onFinish({
      content: fullContent,
      citations: state.rerankedHits ?? [],
    });
    writer.write({ type: 'RUN_FINISHED', runId, citations: finishResult?.citations });

    // eval 入队（此时 metadata_json 已包含 eval 流水线所需的全部字段）
    self.evalQueueService.enqueueEvaluation(runId).catch(...)
  }

+ // 异步校验：fact_check + completeness_check（不阻塞主流程，追加写入 metadata_json）
+ self.runAsyncValidation({
+   runId,
+   originalQuery: state.originalQuery,
+   draftAnswer: state.draftAnswer,
+   rerankedHits: state.rerankedHits ?? [],
+   modelOptions,
+ }).catch((err) =>
+   self.logger.warn('[Orchestrator] 异步校验失败', {
+     error: err instanceof Error ? err.message : String(err),
+   }),
+ );
```

### 2.9 `agui-events.ts` 清理

`StepName` 类型中移除：
```diff
- | 'fact_check'
- | 'completeness_check'
- | 'supplement_retrieve'
- | 'writer_supplement'
```

`AguiEvent` 联合类型中移除 `ValidationStartedEvent` 和 `ValidationCompletedEvent`（前端如有依赖则保留向后兼容，发空事件）。

---

## 涉及文件总览

| 文件 | 改动 |
|------|------|
| `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts` | **核心**：删 4 节点 + 跑异步校验 + State 瘦身 + onFinish 简化 |
| `apps/server/src/modules/chat/types/agui-events.ts` | `StepName` 类型清理 |
| `apps/server/src/modules/chat/schemas/routed-query-plan.schema.ts` | 删 `reasoning` |
| `apps/server/src/modules/chat/schemas/audit-result.schema.ts` | 删 `reason` |
| `apps/server/src/modules/chat/prompts/router.prompt.ts` | 删 `reasoning` 相关 |
| `apps/server/src/modules/chat/prompts/audit.prompt.ts` | 删 `reason` 相关 |
| `apps/server/src/modules/chat/prompts/relevance-check.prompt.ts` | 删 `reason` + `suggestion` |

---

## 验证方案

### 编译验证

```bash
pnpm --filter server build
```

TypeScript 编译零错误。

### 功能测试（启动开发环境）

| 场景 | 预期行为 |
|------|----------|
| **Greeting**（"你好"） | 直接路由到 writer，跳过 retrieval |
| **简单事实查询** | decompose/rewrite → retrieve → writer → `__end__` |
| **复杂对比查询** | 含 decompose → rewrite → retrieve → writer |
| **检索不足** | rewrite_fallback 循环 → tools 重试 |
| **知识库不足 + webSearch** | audit → web_search → writer |
| **客户端断开** | AbortSignal 在各节点正常传播，SSE 正常关闭 |

### SSE 事件序列验证

1. writer 流式输出完毕后，**立即** `RUN_FINISHED`（不再有 fact_check / completeness_check 步骤）
2. `RUN_FINISHED` 携带 `citations` 数组（bc15cea 功能保持）
3. 前端不会因缺失事件而报错

### 离线校验验证

1. 检查 `b_agent_runs` 表 `metadata_json` 字段，确认异步 fact_check + completeness_check 结果正确写入
2. 离线评估任务（BullMQ `EvalQueueService`）正常消费
