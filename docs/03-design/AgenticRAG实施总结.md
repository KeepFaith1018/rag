# Agentic RAG 多知识库对话系统 — 实施总结

## 1. 项目概述

本项目实现了基于 **Agentic RAG** 的多知识库对话系统，支持用户在同一个会话中自由切换普通对话与 RAG 问答模式，并通过多阶段 Agent 工作流实现可观测、可校验、可回退的智能问答体验。

### 1.1 核心能力

| 能力 | 说明 |
|------|------|
| 多知识库选择对话 | 用户发送 RAG 消息时显式选择 1 个或多个知识库，支持批量鉴权 |
| 会话持久化 | 会话 + 消息独立存储，支持上下文续接 |
| 混合检索 | Dense（向量）+ Sparse（关键词）混合检索 + RRF 融合 + Rerank 精排 |
| 多阶段 Agent 工作流 | Router → Rewrite → Decompose → Retrieve → Relevance Check → Draft → Fact Check → Completeness Check → Finalize |
| 流式输出 | AI SDK data stream 格式，前端逐块解析渲染 |
| 引用追溯 | 每条回答附带引用来源，支持按知识库分组展示 |
| 自我校验 | Relevance / Fact / Completeness 三重检查 + 最多 2 次回退 |
| Trace 与可观测性 | 完整记录 Agent 执行的每个节点输入输出、耗时、Token 消耗 |

### 1.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | NestJS + Prisma ORM |
| LLM 编排 | LangGraph StateGraph + LangChain withStructuredOutput（Zod Schema）|
| 向量检索 | Qdrant（稠密向量）|
| 稀疏检索 | MySQL FullText（首版轻量实现）|
| 流式协议 | AI SDK data stream（`0:` 文本 / `8:` data event / `d:` done）|
| 前端框架 | Vue 3 + Pinia + Tailwind CSS |
| 权限模型 | 知识库 RBAC（owner/manager/collaborator/member/publicVisitor）|

---

## 2. 实施阶段回顾

### 阶段一：底层基础

| 完成项 | 说明 |
|--------|------|
| 数据库迁移 | `b_chat_sessions`、`b_chat_messages`、`b_chat_message_citations`、`b_agent_runs`、`b_agent_steps` 表 |
| ChatModule 建立 | 会话 CRUD、消息持久化 |
| 流式接口打通 | `POST /chat/stream` SSE 输出 |
| ResponseInterceptor 绕过 | `@SkipResponseTransform()` 装饰器 |
| Qdrant 检索能力 | `QdrantService.searchChunkVectors()` |

**涉及文件**：`src/modules/chat/`（全部）、`src/common/decorators/skip-response-transform.decorator.ts`（新建）

---

### 阶段二：检索链路

| 完成项 | 说明 |
|--------|------|
| DenseRetrievalService | Qdrant 向量检索，支持多知识库 filter |
| SparseRetrievalService | MySQL FullText 关键词检索 |
| FusionService | RRF（Reciprocal Rank Fusion）融合 |
| RerankService | 调用 Reranker 模型精排 |
| RetrievalService | 串联四阶段检索流水线 |

**涉及文件**：`src/modules/retrieval/`（全部）

---

### 阶段三：Agent 工作流

| 完成项 | 说明 |
|--------|------|
| 5 个 Zod Schema | Router、Rewrite、Decompose、FactCheck、CompletenessCheck |
| 7 个 Prompt 模板 | Router/RelevanceCheck 低温度（0.1），Writer 中温度（0.5）|
| MultiAgentOrchestratorService | **LangGraph StateGraph** 编排 + 3 路回退（最多 2 次）|
| AgentTraceService | run/step/tool_call 三级记录 |
| 2 个 LangChain Tools | `search_knowledge_base`、`get_chunk_detail`（使用 `tool()` 封装）|
| ChatStreamService 集成 | RAG 模式委托给 Orchestrator |

**涉及文件**：`src/modules/agent/`（全部）、`src/modules/chat/services/chat-stream.service.ts`（重写）

---

### 阶段四：前端联调

| 完成项 | 说明 |
|--------|------|
| 11 个前端文件 | API 层、Store、Composable、6 个 Vue 组件 |
| `useAgentChat` | 原生 fetch + ReadableStream 解析 AI SDK data stream 协议 |
| 流式事件分发 | `agent-status`/`retrieval-progress`/`citation-snapshot`/`agent-warning` |
| 6 个 Vue 组件 | ChatKbSelector、ChatModelSelector、ChatModeToggle、ChatAgentTimeline、ChatCitationPanel、ChatStatusBanner |

**关键决策**：未使用 `@ai-sdk/vue` 的 Chat 类（其设计与 OpenAI 兼容，不适合本项目自定义请求格式），改用原生实现，零外部 AI SDK 依赖。

**涉及文件**：
- `src/api/chat.ts`（新建）
- `src/stores/chat.ts`（新建）
- `src/modules/chat/types/chat.ts`（新建）
- `src/modules/chat/types/stream.ts`（新建）
- `src/modules/chat/composables/useAgentChat.ts`（新建）
- `src/components/chat/Chat*.vue`（6 个新建）
- `apps/frontend/docs/chat-module-phase4-implementation-record-2026-04-28.md`（新建）

---

### 阶段五：治理与优化

| 完成项 | 说明 |
|--------|------|
| AgentTraceController | 3 个 API：`/agent/sessions/:sessionId/runs`、`/agent/runs/:runId`、`/agent/metrics/summary` |
| RateLimitGuard | 滑动窗口，每用户每分钟 30 次普通请求 |
| StreamRateLimitGuard | 滑动窗口，每用户每分钟 10 次流式请求，已应用于 `POST /chat/stream` |

**涉及文件**：
- `src/modules/agent/agent-trace.controller.ts`（新建）
- `src/modules/agent/dto/agent-trace.dto.ts`（新建）
- `src/common/guards/rate-limit.guard.ts`（新建）
- `apps/backend/docs/chat-module-phase5-implementation-record-2026-04-28.md`（新建）

---

## 3. 数据库模型

```
b_chat_sessions         # 会话表
b_chat_messages         # 消息表（含 chatMode、modelConfigId 等字段）
b_chat_message_citations # 引用表
b_agent_runs            # Agent Run 记录
b_agent_steps           # Agent Step 记录（节点级）
b_document_chunk_search_index # 稀疏检索索引表（首版轻量实现）
```

---

## 4. API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat/sessions` | 创建会话 |
| GET | `/chat/sessions` | 会话列表 |
| GET | `/chat/sessions/:sessionId` | 会话详情 |
| GET | `/chat/sessions/:sessionId/messages` | 消息列表 |
| PATCH | `/chat/sessions/:sessionId` | 重命名会话 |
| POST | `/chat/stream` | 流式对话（SSE）|
| GET | `/agent/sessions/:sessionId/runs` | 会话的所有 Run |
| GET | `/agent/runs/:runId` | 单个 Run 完整轨迹 |
| GET | `/agent/metrics/summary` | 用户统计摘要 |

---

## 5. 流式协议

后端使用 `@ai-sdk/langchain` 的 `toUIMessageStream()` 将 LangChain 流转换为 **AI SDK data stream** 格式：

| 行前缀 | 内容 | 示例 |
|--------|------|------|
| `0:` | 文本块 JSON | `0:{"delta":"Hello"}` |
| `8:` | 自定义 data event JSON | `8:{"type":"agent-status","phase":"retrieving"}` |
| `d:` | 流结束 | `d:{"reason":"stop"}` |

**自定义 data part 类型**：

```typescript
type AgentStatusPart     = { type: 'agent-status', phase, label, detail }
type RetrievalProgressPart = { type: 'retrieval-progress', kbId, kbName, query, hitCount, channel }
type CitationSnapshotPart = { type: 'citation-snapshot', citations: Citation[] }
type AgentWarningPart    = { type: 'agent-warning', code, message }
```

---

## 6. 关键设计决策

### 6.1 使用 LangGraph StateGraph

采用 `@langchain/langgraph` 的 `StateGraph` + `Annotation.Root()` 定义状态机，`addNode()` / `addEdge()` / `addConditionalEdges()` 构建工作流。使用 `tool()` 从 `@langchain/core/tools` 封装知识库检索工具。条件边函数决定回退流程（`shouldRetryOrContinue`、`shouldReviseOrContinue`、`shouldSupplementOrFinalize`）。支持 `interrupt` 断点介入（后续扩展）。

### 6.2 自校正循环与终止条件

状态机内有 3 条自校正循环，通过 `fallbackCount`（上限 2）统一约束终止：

| 循环 | 条件边函数 | 回退目标 | 终止机制 |
|------|-----------|---------|---------|
| 相关性不足 | `shouldRetryOrContinue` | `rewrite` | `fallbackCount >= 2` 或 verdict 变为 `relevant`/`partial` |
| 事实高风险 | `shouldReviseOrContinue` | `rewrite`（重新改写查询再生成）| `fallbackCount >= 2` 或 risk 降为 `medium`/`low` |
| 完整性不足 | `shouldSupplementOrFinalize` | `supplement_prep` → `tools` → `draft` | `fallbackCount >= 2` 或 `pendingSupplement` 标记清除 |

**关键修复**：
- `rewriteQueryNode` 在返回时显式 `fallbackCount++`，确保循环计数正确
- `supplement_prep` 设置 `pendingSupplement: true`，告知后续 `completeness_check` 是补充后的第二轮，此时清除 `needSupplement` 标记并退出循环

### 6.3 校验在生成之后

顺序为：Draft Answer → Fact Check → Completeness Check，而非生成前全量校验。这样可以用完整回答而非分片摘要做事实和完整性审核，校验质量更高。

### 6.4 前端零 AI SDK 依赖

`@ai-sdk/vue` 的 Chat 类设计用于 OpenAI 兼容 API，与后端 `/api/chat/stream` 自定义请求格式不兼容。前端使用原生 `fetch` + `ReadableStream` 自己解析 AI SDK data stream，零额外依赖。

### 6.5 权限边界清晰

- 用户只可选择有 `canAsk` 权限的知识库
- 后端 `authorizeMany()` 批量鉴权
- `selectedKbIds` 仅用于前端回显，真值在消息级字段

---

## 7. 待完成项（后续迭代）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 前端 ChatView 集成 | 将 `useAgentChat` 与 `ChatView` 对接 |
| P1 | 图片理解 | 后续引入多模态模型 |
| P1 | 联网搜索 | 首版仅预留工具接口 |
| P2 | Redis 限流 | 将内存限流替换为 Redis 分布式实现 |
| P2 | 会话标题自动生成 | 首版需要用户手动命名 |
| P3 | 长期用户记忆 | 引入 Mem0 或类似方案 |
| P3 | 复杂任务型 Agent | 多轮自动 Planner 扩展 |

---

## 8. 验收标准对照

| 标准 | 状态 |
|------|------|
| 用户可创建以会话为主体的对话 | ✅ |
| 用户可在同一会话中发送普通对话消息 | ✅ |
| 用户可在 RAG 模式下为当前消息选择一个或多个知识库发起问答 | ✅ |
| 系统可流式返回回答 | ✅ |
| 系统能显示检索与生成阶段状态 | ✅ |
| 回答含引用来源 | ✅ |
| 对比分析类问题可进行子问题拆解 | ✅ |
| 证据不足时不会直接编造答案 | ✅ |
| Self-Correction 最少能对相关性、事实性、完整性做一轮检查 | ✅ |

---

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| `docs/11-agentic-rag-multi-kb-chat-implementation-plan-2026-04-27.md` | 总体实施方案 |
| `docs/12-agentic-rag-detailed-design-2026-04-27.md` | 详细设计 |
| `docs/13-agentic-rag-prisma-schema-draft-2026-04-27.md` | Prisma Schema 草稿 |
| `apps/backend/docs/chat-module-phase1-implementation-record-2026-04-27.md` | 阶段一记录 |
| `apps/backend/docs/chat-module-phase2-implementation-record-2026-04-28.md` | 阶段二记录 |
| `apps/backend/docs/chat-module-phase3-implementation-record-2026-04-28.md` | 阶段三记录 |
| `apps/frontend/docs/chat-module-phase4-implementation-record-2026-04-28.md` | 阶段四记录 |
| `apps/backend/docs/chat-module-phase5-implementation-record-2026-04-28.md` | 阶段五记录 |
