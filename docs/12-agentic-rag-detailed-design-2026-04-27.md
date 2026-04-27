# Agentic RAG 多知识库对话详细设计

## 1. 文档说明

- 本文档承接《[11-agentic-rag-multi-kb-chat-implementation-plan-2026-04-27.md](file:///d:/Faith/Project/rag-knowledge-base/docs/11-agentic-rag-multi-kb-chat-implementation-plan-2026-04-27.md)》中的总体实施方案，进一步细化为可直接进入开发阶段的详细设计稿。
- 本文档重点回答“具体如何落地”，包括：
  - 后端模块拆分
  - LangGraph 工作流节点设计
  - Prisma 数据表调整建议
  - Chat API 与流式协议设计
  - 前端接入方式
  - 分阶段实施任务
- 本文档默认采用以下已确认方案：
  - 项目对话分为“普通对话模式”和“RAG 模式”
  - 会话负责承载上下文，同一个会话中可同时出现普通对话消息与 `RAG` 消息
  - 仅当本轮消息以 `RAG` 模式发送时，才进入 `Agentic RAG + LangGraph` 流程
  - `RAG` 模式下由用户在发送消息时显式选择 `1` 个或多个知识库，后端批量鉴权后受控检索
  - 检索链路采用 `Router -> Rewrite -> Dense/Sparse -> RRF -> Rerank -> Self-Correction`
  - 流式协议采用 `Vercel AI SDK data stream`
  - 编排层采用 `LangGraph`
  - 首版只支持文本问答，不引入图片、文件二次上传、语音输入

相关文档：

- [11-agentic-rag-multi-kb-chat-implementation-plan-2026-04-27.md](file:///d:/Faith/Project/rag-knowledge-base/docs/11-agentic-rag-multi-kb-chat-implementation-plan-2026-04-27.md)
- [09-rag-document-processing-architecture-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/09-rag-document-processing-architecture-plan-2026-04-25.md)
- [10-rag-document-processing-detailed-design-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/10-rag-document-processing-detailed-design-2026-04-25.md)
- [03-database-design.md](file:///d:/Faith/Project/rag-knowledge-base/docs/03-database-design.md)

## 2. 设计目标

本次详细设计的目标如下：

1. 明确每个模块的职责边界
2. 明确四阶段链路的输入输出
3. 明确以会话为主体、支持普通对话与 `RAG` 消息共存的持久化结构
4. 明确流式接口协议与前端状态消费方式
5. 明确首版可落地范围，避免一次性做过度复杂实现

## 3. 首版范围界定

### 3.1 首版必须完成

1. 多知识库选择对话
2. 会话与消息持久化
3. Dense + Sparse 混合检索
4. RRF 融合
5. Reranker 精排
6. Router / Rewrite / Decomposition
7. Relevance Check / Hallucination Check / Completeness Check
8. 前端流式问答与状态展示
9. 引用展示

### 3.2 首版暂不完成

1. 图片理解
2. 文件再次上传到会话
3. MCP 接入
4. 长期用户记忆
5. 多轮自动 Planner 扩展到复杂任务型 Agent
6. 完整联网搜索闭环
   - 首版仅预留工具接口和触发条件

## 4. 后端模块拆分设计

### 4.1 推荐目录结构

```text
apps/backend/src/
  common/
    decorators/
      skip-response-transform.decorator.ts
    interceptors/
      response.interceptor.ts
  modules/
    chat/
      dto/
        create-chat-session.dto.ts
        list-chat-sessions.dto.ts
        stream-chat.dto.ts
        rename-chat-session.dto.ts
      interfaces/
        chat-session-summary.interface.ts
        chat-message-item.interface.ts
        stream-run-context.interface.ts
      services/
        chat-session.service.ts
        chat-message.service.ts
        chat-stream.service.ts       # 注入 CHAT_MODEL (ChatOpenAI)，使用 @ai-sdk/langchain
      chat.controller.ts             # 使用 ai 包的 pipeUIMessageStreamToResponse
      chat.module.ts                 # 注册 CHAT_MODEL 工厂提供者
    agent/
      dto/
        routed-query-plan.dto.ts
        rewritten-query.dto.ts
        decomposed-question.dto.ts
      agents/
        coordinator.agent.ts
        retriever.agent.ts
        verifier.agent.ts
        writer.agent.ts
      prompts/
        router.prompt.ts
        rewrite.prompt.ts
        decompose.prompt.ts
        relevance-check.prompt.ts
        fact-check.prompt.ts
        completeness-check.prompt.ts
        writer.prompt.ts
      schemas/
        routed-query-plan.schema.ts
        rewritten-query.schema.ts
        decomposed-question.schema.ts
        fact-check-result.schema.ts
        completeness-check-result.schema.ts
      services/
        multi-agent-orchestrator.service.ts
        langgraph-runtime.service.ts
        agent-trace.service.ts
      tools/
        search-knowledge-base.tool.ts
        search-web.tool.ts
        get-chunk-detail.tool.ts
      agent.module.ts
    retrieval/
      dto/
        hybrid-retrieve.dto.ts
      interfaces/
        dense-hit.interface.ts
        sparse-hit.interface.ts
        fused-hit.interface.ts
        reranked-hit.interface.ts
      services/
        dense-retrieval.service.ts
        sparse-retrieval.service.ts
        fusion.service.ts
        rerank.service.ts
        retrieval.service.ts
        citation.service.ts
        retrieval-trace.service.ts
      retrieval.module.ts
    llm/
      services/
        model-runtime.service.ts
        model-config.service.ts
      llm.module.ts
```

### 4.2 模块职责

#### `ChatModule`

职责：

- 会话创建、列表、详情、重命名
- 消息列表查询
- 流式聊天入口
- 会话上下文管理
- 通过工厂提供者 `CHAT_MODEL` 注入 `ChatOpenAI` 实例（从 `ConfigService` 读取模型配置）

不负责：

- 检索召回
- Agent 路由推理
- 重排判断

#### `AgentModule`

职责：

- Router / Rewrite / Decomposition
- LangGraph 工作流调度
- Relevance / Hallucination / Completeness 检查
- Writer 生成最终答案
- Agent 运行轨迹记录

#### `RetrievalModule`

职责：

- Dense 检索
- Sparse 检索
- RRF 融合
- Rerank 精排
- 引用构建
- 检索轨迹记录

#### `LlmModule`

职责（后续阶段引入，Phase 1 由 `ChatModule` 直接提供 `CHAT_MODEL` 工厂）：

- 统一从系统模型配置生成可调用模型实例
- 主模型、小模型、Reranker 模型适配
- 统一管理超时、重试、provider 差异
- 根据用户消息级 `modelSource + modelConfigId` 动态选择模型

## 5. 类职责设计

### 5.1 `ChatSessionService`

建议职责：

- 创建会话
- 查询会话列表
- 查询会话详情
- 自动生成会话标题

建议方法：

```ts
createSession(userId: number, payload: CreateChatSessionDto): Promise<ChatSessionSummary>
listSessions(userId: number, query: ListChatSessionsDto): Promise<ChatSessionSummary[]>
getSessionDetail(userId: number, sessionId: string): Promise<ChatSessionDetail>
renameSession(userId: number, sessionId: string, payload: RenameChatSessionDto): Promise<void>
```

### 5.2 `ChatMessageService`

建议职责：

- 持久化用户消息
- 持久化助手消息
- 更新流式助手消息最终内容
- 查询消息历史

建议方法：

```ts
createUserMessage(...)
createAssistantPlaceholder(...)
finalizeAssistantMessage(...)
listMessages(...)
markAssistantMessageAborted(...)
```

### 5.3 `ChatStreamService`

建议职责：

- 接收流式对话请求
- 校验会话归属与知识库权限
- 持久化用户消息与助手占位消息
- 构建 LangChain 消息列表，调用 LLM 流式输出
- 通过 `@ai-sdk/langchain` 的 `toUIMessageStream()` 将 LangChain 流转换为 AI SDK data stream 格式
- 通过 `onFinish / onError / onAbort` 回调管理助手消息生命周期

建议方法：

```ts
streamChat(userId: number, dto: StreamChatDto): Promise<ReadableStream<UIMessageChunk>>
```

> 实现要点：Controller 通过 `ai` 包的 `pipeUIMessageStreamToResponse({ response: res, stream })` 将返回的 `ReadableStream` 直接写入 Express Response，由库处理 AI SDK data stream 协议编码（`0:` 文本块、`8:` 数据事件、`d:` 结束标记），无需手动拼装。

### 5.4 `MultiAgentOrchestratorService`

建议职责：

- 串联四阶段流程
- 驱动 LangGraph 状态流转
- 管理回退次数与终止条件

建议方法：

```ts
run(context: AgentRunContext): Promise<AgentRunResult>
```

### 5.5 `DenseRetrievalService`

建议职责：

- 基于 Qdrant 执行向量检索
- 支持多知识库 filter
- 支持单子问题多 query 检索

### 5.6 `SparseRetrievalService`

建议职责：

- 基于关键词执行倒排检索
- 支持标题、正文、关键词权重
- 输出标准化候选结果

### 5.7 `FusionService`

建议职责：

- 执行 RRF 融合
- 对重复 chunk 去重
- 保留召回来源信息

### 5.8 `RerankService`

建议职责：

- 调用 Reranker 模型
- 输出 score 和解释
- 支持动态阈值过滤

### 5.9 `AgentTraceService`

建议职责：

- 记录每个 Agent step
- 记录工具调用、输入输出、耗时
- 供后续排障与后台回放

## 6. LangGraph 工作流设计

### 6.1 状态定义

建议维护统一图状态：

```ts
interface AgentGraphState {
  sessionId: string;
  userId: string;
  userMessageId: string;
  assistantMessageId: string;
  originalQuery: string;
  selectedModel: {
    source: "system" | "user";
    configId: string;
    provider?: string;
    modelName?: string;
  };
  chatMode: "chat" | "rag";
  selectedKbIds: string[];
  resolvedKbIds: string[];
  routedPlan: RoutedQueryPlan | null;
  rewrittenQueries: RewrittenQuery[];
  decomposedQuestions: DecomposedQuestion[];
  retrievalCandidates: FusedHit[];
  rerankedHits: RerankedHit[];
  draftAnswer: string | null;
  factCheckResults: FactCheckResult[];
  completenessResult: CompletenessCheckResult | null;
  fallbackCount: number;
  needWebSearch: boolean;
  finalAnswer: string | null;
}
```

### 6.2 节点定义

建议首版图节点如下：

1. `route_query`
2. `rewrite_query`
3. `decompose_question`
4. `hybrid_retrieve`
5. `fuse_candidates`
6. `rerank_and_filter`
7. `relevance_check`
8. `draft_answer`
9. `fact_check`
10. `completeness_check`
11. `finalize_answer`

### 6.3 节点职责

#### `route_query`

输入：

- 原始 Query
- 最近会话摘要

输出：

- `routedPlan`

终止分支：

- 若 `chatMode = "chat"`，直接走普通对话生成分支，不进入检索节点
- 若 `intent = greeting`，直接走 `finalize_answer`

#### `rewrite_query`

输入：

- 原始 Query
- `routedPlan`

输出：

- `rewrittenQueries`

#### `decompose_question`

条件：

- `needDecomposition = true` 时进入

输出：

- `decomposedQuestions`

#### `hybrid_retrieve`

输入：

- `selectedKbIds`
- `rewrittenQueries`
- `decomposedQuestions`

输出：

- Dense hits
- Sparse hits

#### `fuse_candidates`

输入：

- Dense / Sparse hits

输出：

- Top 50 `retrievalCandidates`

#### `rerank_and_filter`

输入：

- `retrievalCandidates`
- 原始 Query

输出：

- `rerankedHits`

#### `relevance_check`

输入：

- `rerankedHits`

输出：

- 是否相关
- 是否需要回到 `rewrite_query`

回退上限：

- 首版建议最多 2 次

#### `draft_answer`

输入：

- `rerankedHits`
- 子问题信息

输出：

- `draftAnswer`

#### `fact_check`

输入：

- `draftAnswer`
- `rerankedHits`

输出：

- `factCheckResults`

若高风险事实较多：

- 回到 `draft_answer`

#### `completeness_check`

输入：

- `draftAnswer`
- `decomposedQuestions`

输出：

- `completenessResult`

若缺项：

- 先尝试从候补证据补充
- 不足时回到 `hybrid_retrieve`

#### `finalize_answer`

职责：

- 输出最终消息
- 输出 citations
- 输出完成状态

## 7. 数据库设计建议

### 7.1 原有表调整

#### `b_chat_sessions`

建议增加：

- `summary_text` `Text?`
- `last_selected_kb_ids_json` `Json?`
- `last_chat_mode` `String? @db.VarChar(20)`
- `last_message_at` `DateTime?`

说明：

- `b_chat_sessions` 只负责承载会话上下文，不再作为固定知识库绑定表
- `last_selected_kb_ids_json` 仅用于前端回显上一条 `RAG` 消息选择的知识库，不作为权限或检索真值
- `last_chat_mode` 用于前端回显用户上一轮发送的是普通对话还是 `RAG`
- 不建议在会话表增加“上轮模型选择”回显字段，模型选择应当在每次发送消息时单独传入

#### `b_chat_messages`

建议增加：

- `message_status` `String @db.VarChar(30)`
- `metadata_json` `Json?`
- `model_source` `String? @db.VarChar(20)`
- `model_config_id` `BigInt?`
- `model_name` `String? @db.VarChar(100)`
- `model_provider` `String? @db.VarChar(50)`
- `finish_reason` `String? @db.VarChar(30)`
- `trace_id` `String? @db.Char(36)`
- `chat_mode` `String @db.VarChar(20)`
- `selected_kb_ids_json` `Json?`
- `resolved_kb_ids_json` `Json?`

说明：

- `references` 可作为兼容字段继续保留
- 正式引用建议逐步迁移到独立 citation 表
- `chat_mode` 建议取值为 `chat / rag`
- 普通对话消息不需要写入知识库字段
- 每条消息应显式记录本轮所选模型配置，而不是依赖会话默认模型
- `model_source` 建议取值为 `system / user`
- `model_config_id` 用于对应 `sys_model_configs.id` 或 `b_user_model_configs.id`，需结合 `model_source` 判定来源
- 真正的知识库选择真值记录在消息级字段中，而不是会话级关系表中

### 7.2 新增表建议

#### `b_chat_message_citations`

用途：

- 记录回答使用的引用

建议字段：

```prisma
model b_chat_message_citations {
  id         BigInt   @id @default(autoincrement())
  message_id BigInt
  kb_id      BigInt
  doc_id     BigInt
  chunk_id   BigInt
  score      Float?
  quote      String?  @db.Text
  order_no   Int      @default(0)
  created_at DateTime @default(now()) @db.DateTime(0)

  @@index([message_id], map: "idx_chat_citation_message")
  @@index([doc_id], map: "idx_chat_citation_doc")
  @@index([chunk_id], map: "idx_chat_citation_chunk")
}
```

#### `b_agent_runs`

用途：

- 记录一次完整 Agent 执行

建议字段：

```prisma
model b_agent_runs {
  id               String   @id @db.Char(36)
  session_id       String   @db.Char(36)
  user_id          BigInt
  user_message_id  BigInt
  assistant_message_id BigInt?
  status           String   @db.VarChar(30)
  total_tokens     Int?     @default(0)
  duration_ms      Int?
  chat_mode         String?  @db.VarChar(20)
  selected_kb_ids_json Json?
  resolved_kb_ids_json Json?
  created_at       DateTime @default(now()) @db.DateTime(0)
  finished_at      DateTime? @db.DateTime(0)

  @@index([session_id], map: "idx_agent_run_session")
  @@index([user_id], map: "idx_agent_run_user")
}
```

#### `b_agent_steps`

用途：

- 记录 Graph 节点级过程

建议字段：

```prisma
model b_agent_steps {
  id          BigInt   @id @default(autoincrement())
  run_id       String   @db.Char(36)
  agent_name   String   @db.VarChar(50)
  step_type    String   @db.VarChar(50)
  status       String   @db.VarChar(30)
  input_json   Json?
  output_json  Json?
  duration_ms  Int?
  started_at   DateTime @default(now()) @db.DateTime(0)
  finished_at  DateTime? @db.DateTime(0)

  @@index([run_id], map: "idx_agent_step_run")
  @@index([agent_name], map: "idx_agent_step_agent")
}
```

#### `b_agent_tool_calls`

用途：

- 记录工具调用明细

建议字段：

```prisma
model b_agent_tool_calls {
  id          BigInt   @id @default(autoincrement())
  step_id      BigInt
  tool_name    String   @db.VarChar(100)
  status       String   @db.VarChar(30)
  args_json    Json?
  result_json  Json?
  duration_ms  Int?
  created_at   DateTime @default(now()) @db.DateTime(0)

  @@index([step_id], map: "idx_agent_tool_step")
  @@index([tool_name], map: "idx_agent_tool_name")
}
```

## 8. 检索详细设计

### 8.1 Dense 检索接口

建议在 `QdrantService` 新增：

```ts
searchChunkVectors(params: {
  vector: number[];
  kbIds: string[];
  topK: number;
  scoreThreshold?: number;
}): Promise<DenseHit[]>
```

### 8.2 Sparse 检索首版落地方式

首版建议优先选择“应用层轻量倒排索引”或 “MySQL FullText + chunk 同步写入”。

建议增加一张轻量索引表：

```prisma
model b_document_chunk_search_index {
  chunk_id      BigInt   @id
  doc_id        BigInt
  kb_id         BigInt
  title         String?  @db.VarChar(255)
  title_path    String?  @db.VarChar(500)
  content_plain String   @db.LongText
  keyword_text  String?  @db.Text
  created_at    DateTime @default(now()) @db.DateTime(0)

  @@index([doc_id], map: "idx_chunk_search_doc")
  @@index([kb_id], map: "idx_chunk_search_kb")
}
```

### 8.3 Fusion 接口

```ts
fuseByRrf(input: {
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  topK: number;
  k?: number;
}): FusedHit[]
```

### 8.4 Rerank 接口

```ts
rerank(input: {
  originalQuery: string;
  rewrittenQuery: string;
  candidates: FusedHit[];
  questionType: 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
}): Promise<RerankedHit[]>
```

### 8.5 过滤策略

首版建议：

- 低于 `0.5` 直接丢弃
- 高于 `0.7` 作为主证据
- 保留 `0.5 ~ 0.7` 的前 2 条作为候补证据
- 对于 `compare_analysis` 至少保证两个对象各有一条主证据，否则触发完整性警告

## 9. API 设计

### 9.1 创建会话

`POST /api/chat/sessions`

请求体：

```json
{
  "title": "新会话"
}
```

响应：

```json
{
  "id": "3d84cb8a-5d90-4a39-bc9d-4f6d0f1885cf",
  "title": "新会话",
  "createdAt": "2026-04-27T10:00:00Z"
}
```

### 9.2 会话列表

`GET /api/chat/sessions`

### 9.3 会话消息列表

`GET /api/chat/sessions/:sessionId/messages`

### 9.4 流式对话

`POST /api/chat/stream`

请求体建议：

```json
{
  "sessionId": "3d84cb8a-5d90-4a39-bc9d-4f6d0f1885cf",
  "chatMode": "rag",
  "message": "对比知识库权限模型与文档处理任务治理设计",
  "modelSource": "system",
  "modelConfigId": "12",
  "selectedKbIds": ["101", "102"],
  "agentMode": "multi-agent",
  "metadata": {
    "fromPage": "chat"
  }
}
```

普通对话模式示例：

```json
{
  "sessionId": "3d84cb8a-5d90-4a39-bc9d-4f6d0f1885cf",
  "chatMode": "chat",
  "message": "帮我把上面的设计思路整理成三点",
  "modelSource": "user",
  "modelConfigId": "7",
  "metadata": {
    "fromPage": "chat"
  }
}
```

说明：

- 每轮请求必须显式携带 `modelSource + modelConfigId`
- `chatMode = "chat"` 时，不进入 RAG 检索与 Graph 编排
- `chatMode = "rag"` 时，必须传入 `selectedKbIds`
- `selectedKbIds` 支持 `1` 个或多个知识库
- 后端仅可在 `selectedKbIds` 范围内检索
- 前端不需要回显上一轮消息使用的模型，只需要维护当前输入框的选择状态

### 9.5 流式接口实现说明

注意事项：

1. 该接口必须使用 `@SkipResponseTransform()` 绕过统一响应包装
2. 该接口输出 `text/event-stream`（由 `pipeUIMessageStreamToResponse` 自动设置响应头）
3. 该接口在开始流式前要先创建用户消息与助手占位消息（在 `ChatStreamService.streamChat()` 内完成）
4. 该接口中断时要标记助手消息状态（通过 `toUIMessageStream()` 的 `onAbort / onError` 回调处理）
5. **流式协议由三方包负责**：`ChatStreamService` 返回 `ReadableStream<UIMessageChunk>`，Controller 通过 `pipeUIMessageStreamToResponse({ response: res, stream })` 直接写入 Express Response，**不再手动拼装 `0:` / `8:` / `d:` 协议前缀**

实现依赖：

- `@ai-sdk/langchain` 的 `toUIMessageStream()` — 将 LangChain `AsyncIterable<AIMessageChunk>` 转换为 AI SDK 格式的 `ReadableStream<UIMessageChunk>`
- `ai` 的 `pipeUIMessageStreamToResponse()` — 将 `ReadableStream<UIMessageChunk>` 按 AI SDK data stream 协议写入 Express `Response`

## 10. 流式事件协议设计

### 10.1 事件原则

建议前后端统一使用 `AI SDK UI Message Stream` + 自定义 `data parts`。

### 10.2 自定义 data parts

#### `agent-status`

```ts
type AgentStatusPart = {
  type: "agent-status";
  phase:
    | "planning"
    | "retrieving"
    | "reranking"
    | "verifying"
    | "writing"
    | "done";
  label: string;
  detail?: string;
};
```

#### `retrieval-progress`

```ts
type RetrievalProgressPart = {
  type: "retrieval-progress";
  kbId: string;
  kbName: string;
  query: string;
  hitCount: number;
  channel: "dense" | "sparse" | "hybrid";
};
```

#### `citation-snapshot`

```ts
type CitationSnapshotPart = {
  type: "citation-snapshot";
  citations: Array<{
    citationId: string;
    kbId: string;
    kbName: string;
    docId: string;
    docTitle: string;
    chunkId: string;
    quote: string;
  }>;
};
```

#### `agent-warning`

```ts
type AgentWarningPart = {
  type: "agent-warning";
  code:
    | "LOW_CONFIDENCE"
    | "PARTIAL_ANSWER"
    | "WEB_SEARCH_CANDIDATE"
    | "INSUFFICIENT_CONTEXT";
  message: string;
};
```

## 11. 前端接入设计

### 11.1 推荐目录

```text
apps/frontend/src/
  api/
    chat.ts
  modules/chat/
    composables/
      useAgentChat.ts
    stores/
      chat.ts
    types/
      chat.ts
      stream.ts
    components/
      ChatKbSelector.vue
      ChatAgentTimeline.vue
      ChatCitationPanel.vue
      ChatStatusBanner.vue
```

### 11.2 `useAgentChat` 设计

职责：

- 基于 `@ai-sdk/vue` 的 `useChat`
- 管理消息发送
- 管理当前输入框的模型选择
- 将当前输入框的消息模式与知识库选择注入请求
- 消费 `agent-status / retrieval-progress / citation-snapshot`

示例伪代码：

```ts
const { messages, status, sendMessage, stop, error } = useChat({
  api: "/api/chat/stream",
  body: {
    sessionId,
    agentMode: "multi-agent",
  },
});
```

发送消息时建议动态传参：

```ts
sendMessage(
  { text: inputValue },
  {
    body: {
      modelSource: selectedModel.source,
      modelConfigId: selectedModel.configId,
      ...(chatMode === "rag"
        ? {
            chatMode: "rag",
            selectedKbIds,
          }
        : {
            chatMode: "chat",
          }),
    },
  },
);
```

### 11.3 前端 UI 组件职责

#### `ChatKbSelector.vue`

- 显示当前可选知识库
- 支持多选
- 支持显示选中数量
- 仅在 `RAG` 模式下展示

#### `ChatModelSelector.vue`

- 显示当前用户可用模型列表
- 支持每次发送消息前切换模型
- 只维护当前输入框选择，不回显上一轮消息使用的模型

#### `ChatAgentTimeline.vue`

- 渲染当前阶段：
  - 规划中
  - 检索中
  - 精排中
  - 校验中
  - 生成中

#### `ChatCitationPanel.vue`

- 渲染引用列表
- 支持按知识库和文档分组展示

#### `ChatStatusBanner.vue`

- 展示警告状态：
  - 证据不足
  - 仅部分回答
  - 建议联网搜索

## 12. 权限与安全设计

### 12.1 权限原则

1. 用户只可选择自己有 `canAsk` 权限的知识库
2. 后端必须再次做批量鉴权
3. Agent 工具不能跳过权限层
4. 即使模型输出了新的 `kbId`，也不能直接检索
5. 普通对话模式不得被错误路由到知识库检索链路

### 12.2 批量鉴权建议

建议在 `KbPermissionService` 新增：

```ts
authorizeMany(userId: number, kbIds: string[], action: KbPermissionAction): Promise<KbPermissionContext[]>
```

### 12.3 限制策略

首版建议限制：

- 每次最多选择 5 个知识库
- 每个子问题最多检索 3 个改写 Query
- 每轮最多回退 2 次
- 每次回答最多保留 5 条主证据

## 13. 日志与可观测性

建议记录以下内容：

1. Router 输出
2. Rewrite 输出
3. Decomposition 输出
4. Dense / Sparse 原始召回结果
5. RRF 结果
6. Reranker 分数
7. Relevance / Fact Check / Completeness Check 结果
8. 最终引用列表
9. 每一步耗时
10. token 消耗

建议同时输出两套视图：

- 面向排障的技术 trace
- 面向用户的轻量状态摘要

## 14. 测试建议

### 14.1 后端单测

建议优先覆盖：

1. Router 输出结构校验
2. RRF 融合正确性
3. 动态阈值过滤逻辑
4. 批量知识库鉴权
5. 引用构建正确性

### 14.2 后端集成测试

建议覆盖：

1. 会话创建不再绑定默认知识库
2. 流式接口鉴权失败
3. 选择无权限知识库
4. 普通对话模式与 `RAG` 模式的分流判断
5. Dense / Sparse 任一路为空时的融合行为
6. Self-Correction 回退上限

### 14.3 前端联调测试

建议覆盖：

1. 流式消息是否连续显示
2. 中断生成后状态是否正确
3. 普通对话模式是否正确走直接对话链路
4. `RAG` 模式临时指定知识库是否生效
5. 引用是否跟随回答更新

## 15. 分阶段实施清单

### 阶段一：底层基础

1. 数据库迁移
2. ChatModule 建立
3. 流式接口打通
4. ResponseInterceptor 绕过机制
5. Qdrant search 能力补齐

### 阶段二：检索链路

1. DenseRetrievalService
2. SparseRetrievalService
3. FusionService
4. RerankService

### 阶段三：Agent 工作流

1. Router
2. Rewrite
3. Decomposition
4. Relevance Check
5. Writer
6. Fact Check
7. Completeness Check

### 阶段四：前端联调

1. useChat 接入
2. ChatKbSelector
3. ChatAgentTimeline
4. Citation Panel

### 阶段五：治理与优化

1. trace 查询
2. 错误回放
3. 限流与超时治理
4. 评估指标输出

## 16. 验收标准

满足以下条件，可视为首版完成：

1. 用户可创建以会话为主体的对话
2. 用户可在同一会话中发送普通对话消息
3. 用户可在 `RAG` 模式下为当前消息选择一个或多个知识库发起问答
4. 系统可流式返回回答
5. 系统能显示检索与生成阶段状态
6. 回答含引用来源
7. 对比分析类问题可进行子问题拆解
8. 证据不足时不会直接编造答案
9. Self-Correction 最少能对相关性、事实性、完整性做一轮检查

## 17. 结论

这份详细设计的核心思想是：

- 不是把所有复杂能力一次性塞给一个大模型
- 而是将问答问题拆成“可观测、可校验、可回退”的多阶段工作流

对当前项目来说，最关键的三件事不是“先把回答说得多聪明”，而是：

1. 检索链路要稳定
2. 权限边界要清晰
3. 流式状态与引用要可信

因此，首版开发时应坚持以下优先级：

1. 先做对话底座和检索底座
2. 再做 Rerank 与 Self-Correction
3. 最后逐步增强联网搜索与复杂 Agent 能力

只要这条路径执行到位，你的系统就会从“有向量库的知识问答”升级为“具备多知识库分析能力、可流式交互、可自我校验的 Agentic RAG 对话系统”。
