# Chat 模块阶段三实施记录

## 概述

按照《[12-agentic-rag-detailed-design-2026-04-27.md](../../../docs/12-agentic-rag-detailed-design-2026-04-27.md)》中阶段三的规划，完成 Agent 工作流模块的搭建。实现了 Router → Rewrite → Decompose → Relevance Check → Writer → Fact Check → Completeness Check 的七节点状态机编排，并与 ChatStreamService 完成集成。

## 完成清单

### 1. Zod 结构化输出 Schema（5 个）

| Schema | 用途 | 关键字段 |
|--------|------|----------|
| `RoutedQueryPlanSchema` | Router 输出：意图分类 | intent, needDecomposition, needWebSearch, questionType |
| `RewriteOutputSchema` | Rewrite 输出：改写查询 | queries[{ rewritten, focus }], 1~3 条 |
| `DecomposeOutputSchema` | Decompose 输出：子问题 | questions[{ subQuestion, aspect, keywords }], dependency |
| `FactCheckResultSchema` | Fact Check 输出：事实校验 | items[{ statement, verdict, evidence }], overallRisk, needRevise |
| `CompletenessCheckResultSchema` | Completeness 输出：完整性 | coveredAspects, missingAspects, overallCoverage, needSupplement |

所有 Schema 通过 `@langchain/core` 的 `withStructuredOutput()` 方法绑定到 LLM 调用，实现从自然语言到类型安全结构化数据的转换。

涉及文件：
- `src/modules/agent/schemas/*` — 5 个 Zod Schema 文件

### 2. Prompt 模板（7 个）

| Prompt | 用途 | 温度 |
|--------|------|------|
| `ROUTER_SYSTEM_PROMPT` | 意图分类（greeting/fact_lookup/compare_analysis/research） | 0.2 |
| `REWRITE_SYSTEM_PROMPT` | 查询改写（补充术语、具体化指代、多维度扩展） | 0.3 |
| `DECOMPOSE_SYSTEM_PROMPT` | 复杂问题拆解（独立子问题 + 检索关键词） | 0.3 |
| `RELEVANCE_CHECK_SYSTEM_PROMPT` | 检索相关性判断（relevant/partial/not_relevant） | 0.1 |
| `FACT_CHECK_SYSTEM_PROMPT` | 事实逐条校验（supported/contradicted/not_verified） | 0.1 |
| `COMPLETENESS_CHECK_SYSTEM_PROMPT` | 回答完整性审核（覆盖率 0~1） | 0.1 |
| `WRITER_SYSTEM_PROMPT` | 基于检索上下文生成回答（含 `{context}` 占位符） | 0.5 |

涉及文件：
- `src/modules/agent/prompts/*` — 7 个 Prompt 文件

### 3. MultiAgentOrchestratorService

**职责**：实现基于状态机的 Agentic RAG 多阶段工作流编排。

**工作流节点与状态转换**：

```
start → route_query (Router)
  ├─ greeting → simple response (跳过检索)
  └─ rag → rewrite_query (Rewrite)
      ├─ decompose_question (Decompose, 仅 needDecomposition=true)
      ├─ hybrid_retrieve (调用 RetrievalService)
      ├─ relevance_check
      │   ├─ not_relevant → rewrite_query (回退，最多 2 次)
      │   └─ relevant/partial → draft_answer
      ├─ draft_answer (Writer)
      ├─ fact_check
      │   ├─ high_risk → draft_answer (修正)
      │   └─ low/medium → completeness_check
      ├─ completeness_check
      │   ├─ needSupplement → hybrid_retrieve (补充检索)
      │   └─ complete → finalize
      └─ finalize (返回 finalAnswer + citations + trace)
```

**关键设计**：
- `MaxFallback = 2`：改写回退、事实修正、补充检索共享回退配额
- 每个节点独立调用 LLM + 结构化输出（via `withStructuredOutput(ZodSchema)`）
- 校验节点使用低温度（0.1），生成节点使用中等温度（0.5）
- 通过 `AgentStatusCallback` 回调函数向调用方通知当前阶段（planning/retrieving/verifying/writing/done）
- 每步自动记录到 `b_agent_steps` 表供后续排障

涉及文件：
- `src/modules/agent/services/multi-agent-orchestrator.service.ts` — 新建

### 4. AgentTraceService

**职责**：将 Agent 执行过程持久化到 `b_agent_runs` 和 `b_agent_steps` 表。

**方法**：
- `createRun(ctx)` — 创建 run 记录，返回 runId
- `recordStep(runId, step)` — 记录单步（agent_name / step_type / status / input / output / duration_ms）
- `completeRun(runId, summary)` — 完成 run，写入 total_tokens、duration_ms
- `failRun(runId)` — 标记 run 失败

涉及文件：
- `src/modules/agent/services/agent-trace.service.ts` — 新建

### 5. Agent 工具（2 个）

| 工具 | 用途 |
|------|------|
| `SearchKnowledgeBaseTool` | 封装 RetrievalService 为标准工具接口 |
| `GetChunkDetailTool` | 按 chunkId 查询完整分片内容与元数据 |

涉及文件：
- `src/modules/agent/tools/search-knowledge-base.tool.ts` — 新建
- `src/modules/agent/tools/get-chunk-detail.tool.ts` — 新建

### 6. AgentModule

**模块结构**：

```
agent/
├── dto/
│   ├── routed-query-plan.dto.ts
│   ├── rewritten-query.dto.ts
│   └── decomposed-question.dto.ts
├── prompts/
│   ├── router.prompt.ts
│   ├── rewrite.prompt.ts
│   ├── decompose.prompt.ts
│   ├── relevance-check.prompt.ts
│   ├── fact-check.prompt.ts
│   ├── completeness-check.prompt.ts
│   └── writer.prompt.ts
├── schemas/
│   ├── routed-query-plan.schema.ts
│   ├── rewritten-query.schema.ts
│   ├── decomposed-question.schema.ts
│   ├── fact-check-result.schema.ts
│   └── completeness-check-result.schema.ts
├── services/
│   ├── multi-agent-orchestrator.service.ts
│   └── agent-trace.service.ts
├── tools/
│   ├── search-knowledge-base.tool.ts
│   └── get-chunk-detail.tool.ts
└── agent.module.ts
```

依赖：`AiModule`（ChatModelService）、`RetrievalModule`（RetrievalService）

涉及文件：
- `src/modules/agent/agent.module.ts` — 新建

### 7. ChatStreamService 集成

**Phase 3 集成变更**：

- RAG 模式不再直接调用 RetrievalService + 构建 Prompt，而是委托给 `MultiAgentOrchestratorService.run()`
- Orchestrator 内部自行完成路由 → 改写 → 拆解 → 检索 → 校验 → 生成 → 修正的完整链路
- Agent 状态事件通过 `onStatus` 回调传递给 ChatGPT 侧（planning/retrieving/verifying/writing/done）
- 引用在 Orchestrator 返回后由 `CitationService` 异步写入
- 普通对话模式保持不变，直接 LLM 流式输出

涉及文件：
- `src/modules/chat/services/chat-stream.service.ts` — 重写（Phase 2 直接检索 → Phase 3 Agent 编排）
- `src/modules/chat/chat.module.ts` — 修改，新增 `AgentModule` 导入

### 8. 基础设施变更

**新增依赖**：`zod` — 用于 LLM 结构化输出的 Schema 定义与校验

**新增 Prisma 模型**：`b_agent_steps` — Agent 节点级执行步骤记录表（`b_agent_runs` 在 Phase 1 迁移中已存在）

**模块注册**：
- `AgentModule` 已注册到 `AppModule`
- `ChatModule` 新增 `imports: [AgentModule]`

### 涉及文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/agent/` | 新建目录 | Agent 模块全部 19 个文件 |
| `src/modules/chat/chat.module.ts` | 修改 | 新增 AgentModule 导入 |
| `src/modules/chat/services/chat-stream.service.ts` | 重写 | RAG 模式改用 Orchestrator 编排 |
| `src/app.module.ts` | 修改 | 注册 AgentModule |
| `prisma/schema.prisma` | 修改 | 新增 b_agent_steps 模型 |
| `package.json` | 修改 | 新增 zod 依赖 |

## 工作流示意

```
用户 RAG 消息
  │
  ├─ KbPermissionService.authorizeMany()      // 批量鉴权
  ├─ ChatMessageService.createUserMessage()   // 持久化用户消息
  ├─ ChatMessageService.createAssistantPlaceholder()
  │
  └─ MultiAgentOrchestratorService.run()
       │
       ├─ [planning]  route_query           // Router: 意图分类
       ├─ [planning]  rewrite_query         // Rewrite: 查询改写 ×3
       ├─ [planning]  decompose_question    // Decompose: 子问题拆解
       ├─ [retrieving] hybrid_retrieve      // 混合检索 (Phase 2)
       ├─ [verifying]  relevance_check      // 相关性校验
       ├─ [writing]    draft_answer         // Writer: 生成草稿
       ├─ [verifying]  fact_check           // 事实校验
       ├─ [verifying]  completeness_check   // 完整性校验
       └─ [done]       finalize             // 返回答案 + 引用
       │
  ├─ CitationService.createCitations()        // 持久化引用
  └─ 流式返回最终答案                          // SSE → 前端
```

## 回退与自校正机制

| 纠错点 | 触发条件 | 回退目标 | 上限 |
|--------|----------|----------|------|
| 相关性不足 | relevance_check → not_relevant | rewrite_query → 重新检索 | 共 2 次 |
| 事实风险高 | fact_check → overallRisk=high | draft_answer（修正提示） | 共 2 次 |
| 完整性不足 | completeness_check → needSupplement | hybrid_retrieve（补充维度） | 共 2 次 |

三项回退共享同一个 `fallbackCount` 计数器，避免无限循环。

## 验证结果

- TypeScript 编译通过（`pnpm --filter backend build`）
- Prisma Client 生成成功（含新模型 `b_agent_steps`）
- Zod Schema 覆盖全部 LLM 结构化输出节点
- Agent 工作流状态机：7 节点 + 3 回退路径完整
- Orchestrator 与 ChatStreamService 正确集成

## 关键设计决策

1. **不使用 LangGraph 库**：首版采用 TypeScript 原生状态机实现节点编排，避免引入重量级依赖。状态转换逻辑清晰可读，后续若需 LangGraph 高级特性（checkpoint、streaming graph events），可在不改变节点方法的前提下迁移
2. **校验节点统用低温度**：Relevance / Fact / Completeness Check 三个校验节点均使用 temperature=0.1，确保校验结果稳定可复现
3. **生成优先于校验**：先 Draft Answer → 再 Fact Check → 再 Completeness Check，而非在生成前做全量校验。这样可以用完整回答而非分片摘要来做事实和完整性审核，校验质量更高
4. **Agent 工作流非流式、最终答案流式**：Orchestrator 内部 LLM 调用均为非流式（需要结构化输出），最终答案通过 AI SDK data stream 返回前端。后续可优化为 Draft 阶段流式生成 + 后台异步校验

## 后续阶段

参见《12-agentic-rag-detailed-design》的阶段四至阶段五：

- 阶段四：前端联调（useChat 接入、AgentTimeline、CitationPanel）
- 阶段五：治理与优化（trace 查询、限流、评估指标）
