# Chat & RAG 对话数据流分析文档

## 一、概述

本文档详细分析 Linsor AI 系统中两种对话模式（`chat` 和 `rag`）的全流程数据流，包括：
- 后端 → 前端的 SSE 消息类型、事件协议、数据结构
- 前端解析、流式渲染、组件层级的完整链路
- Agent 工作流节点编排与状态图
- 数据库存储结构
- 与业内主流方案的对比分析

---

## 二、数据库表结构

### 2.1 b_chat_sessions（会话表）

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | Char(36) | 会话 ID (UUID) |
| user_id | BigInt | 用户 ID |
| kb_id | BigInt? | 关联知识库（可选） |
| title | VarChar(100) | 会话标题 |
| summary_text | Text? | 摘要文本 |
| last_selected_kb_ids_json | Json? | 最近选择的知识库 ID 列表 |
| last_chat_mode | VarChar(20) | 最近聊天模式 'chat'/'rag' |
| last_message_at | DateTime? | 最近消息时间 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

### 2.2 b_chat_messages（消息表）

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BigInt | 消息 ID（自增） |
| session_id | Char(36) | 所属会话 ID |
| role | VarChar(50) | 'user' / 'assistant' |
| content | Text | 消息内容 |
| references | Json? | 引用列表 |
| tool_calls | Json? | 工具调用记录 |
| tokens_used | Int? | Token 消耗数量 |
| message_status | VarChar(30) | 'streaming'/'completed'/'aborted' |
| metadata_json | Json? | 元数据 |
| model_name | VarChar(100) | 模型名称 |
| finish_reason | VarChar(30) | 'stop'/'abort' |
| trace_id | Char(36)? | 追踪 ID |
| chat_mode | VarChar(20)? | 'chat'/'rag' |
| selected_kb_ids_json | Json? | 用户选择的知识库 |
| resolved_kb_ids_json | Json? | 实际解析通过的知识库 |
| stream_started_at | DateTime? | 流式开始时间 |
| stream_finished_at | DateTime? | 流式结束时间 |
| feedback_type | VarChar(20)? | 反馈类型 |
| feedback_reason | Text? | 反馈原因 |
| created_at | DateTime | 创建时间 |

### 2.3 b_agent_runs（Agent 执行记录表）

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | Char(36) | Agent Run ID |
| session_id | Char(36) | 所属会话 ID |
| user_id | BigInt | 用户 ID |
| user_message_id | BigInt | 用户消息 ID |
| assistant_message_id | BigInt? | 助手消息 ID |
| status | VarChar(30) | 执行状态 (running/completed/failed) |
| total_tokens | Int? | 总 Token 数 |
| duration_ms | Int? | 执行耗时（毫秒） |
| chat_mode | VarChar(20)? | 'chat'/'rag' |
| selected_kb_ids_json | Json? | 用户选择的知识库 |
| resolved_kb_ids_json | Json? | 实际解析通过的知识库 |
| routed_query_json | Json? | 路由查询结果 |
| metadata_json | Json? | 元数据 |
| created_at | DateTime | 创建时间 |
| finished_at | DateTime? | 完成时间 |

### 2.4 b_agent_steps（Agent 步骤记录表）

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | BigInt | 步骤 ID |
| run_id | Char(36) | 所属 Agent Run ID |
| agent_name | VarChar(50) | 角色名 (router/rewriter/decomposer/retriever/verifier) |
| step_type | VarChar(50) | 步骤类型 (route_query/rewrite_query/decompose_question/hybrid_retrieve/relevance_check/fact_check/completeness_check) |
| status | VarChar(30) | 状态 (started/completed/failed) |
| input_json | Json? | 输入参数 |
| output_json | Json? | 输出结果 |
| duration_ms | Int? | 执行耗时 |
| started_at | DateTime | 开始时间 |
| finished_at | DateTime? | 完成时间 |

---

## 三、Chat 模式数据流

### 3.1 处理流程

```
ChatController.streamChat()
  → ChatStreamService.streamChat()
    → 检测 chatMode === 'chat'（或 rag 模式下无 selectedKbIds）
    → streamChatMode()
      → 构建消息: [SystemMessage(系统提示), HumanMessage(用户输入)]
      → chatModelService.createModel({ temperature: 0.7, streaming: true })
      → model.stream(messages) → 获取 LangChain AIMessageChunk 流
      → accumulateStream() 累积全文
      → toUIMessageStream(stream, { onFinish, onError, onAbort })
      → pipeUIMessageStreamToResponse() → SSE 输出到客户端
```

### 3.2 发送给前端的事件类型

Chat 模式最简单，只有 2 种事件：

| 事件类型 | 数据结构 | 说明 |
|---------|---------|------|
| `text-delta` | `{ type: 'text-delta', id: string, delta: string }` | LLM 逐 token 输出 |
| `finish` | `{ type: 'finish', finishReason: 'stop' }` | 流结束标记 |

### 3.3 回调处理

- `onFinish`：持久化回答到 `b_chat_messages` + 自动生成会话标题 (`summarizeTitleIfNeeded`)
- `onError` / `onAbort`：标记消息为 `aborted`

---

## 四、RAG 模式数据流

### 4.1 处理流程（全链路）

```
ChatController.streamChat()
  → ChatStreamService.streamChat()
    → 检测 chatMode === 'rag' && selectedKbIds?.length > 0
    → streamRagMode()
      1. kbPermissionService.authorizeMany(userId, kbIds, 'ask')
         → 逐个鉴权，得到 resolvedKbIds
      2. chatMessageService.createUserMessage()    → 持久化用户消息
      3. chatMessageService.createAssistantPlaceholder() → 创建助手占位
      4. orchestrator.streamRun(runCtx, callbacks)
         → 返回 ReadableStream<UIMessageChunk>
         → callbacks.onFinish: 持久化引用 + 回答 + 自动标题
         → callbacks.onError: 标记消息为 aborted
```

### 4.2 MultiAgentOrchestratorService 工作流详解

#### 4.2.1 StateGraph 定义（7 节点 + 6 条件边）

```
__start__
  │
  ▼
route (路由分析 — qwen-turbo, temp=0.2)
  │ 输出: RoutedQueryPlan { intent, needDecomposition, needWebSearch, questionType }
  │
  ├──[intent=greeting]──→ retrieve_prep (跳过改写和拆解)
  │
  └──[其他意图]──→ rewrite (查询改写 — qwen-turbo, temp=0.3)
                    │ 输出: RewriteOutput { queries: [{ rewritten }] }
                    │
                    ├──[needDecomposition=false]──→ retrieve_prep
                    │
                    └──[needDecomposition=true]──→ decompose (问题拆解 — qwen-turbo, temp=0.3)
                                                    │ 输出: DecomposeOutput { questions, dependency }
                                                    │
                                                    ▼
                                              retrieve_prep → tools
                                                    │
                                                    ▼
                                              tools (混合检索)
                                                1. DenseRetrievalService (Qdrant 向量)
                                                2. ElasticsearchSparseRetrievalService (BM25 关键词)
                                                3. FusionService.rrfFuse (RRF 融合, topK=50)
                                                4. RerankService.rerank (Cross-encoder 精排)
                                                → 写入 retrieval-progress 事件
                                                    │
                                                    ▼
                                              relevance_check (相关性检查 — qwen-turbo, temp=0.1)
                                                输入: top5 chunks 的摘要 + 原始查询
                                                输出: { verdict: 'relevant'|'partial'|'not_relevant' }
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                              [not_relevant]   [partial]      [relevant]
                               fallback<2?    fallback<2?          │
                               → rewrite     → rewrite            │
                               ≥2 → continue ≥2 → continue        │
                                    │               │               │
                                    └───────────────┴───────────────┘
                                                    │
                                                    ▼
                                              proceed_to_verify
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                              [无结果或not_relevant]          [复杂查询]
                              [fact_lookup/greeting]            │
                                    │                               │
                                    ▼                               ▼
                                finalize                          verify
                                                                  │ 并行执行:
                                                                  ├─ factCheckNode
                                                                  │    → FactCheckResult { items[], overallRisk, needRevise }
                                                                  └─ completenessCheckNode
                                                                       → CompletenessCheckResult { coverage, missingAspects[], needSupplement }
                                                                  │
                                                    ┌─────────────┴─────────────┐
                                                    │                           │
                                              [needRevise 或              [通过]
                                               needSupplement]
                                               → rewrite (回退循环)      → finalize
                                               fallbackCount < 2               │
                                                                              ▼
                                                                           __end__
```

#### 4.2.2 回退机制

`MAX_FALLBACK = 2`，即最多回退 2 次：

- **事实校验失败** (`factCheckResult.needRevise`) → 设置 `pendingRevise = true`，回到 `rewrite` 重新检索
- **完整性不足** (`completenessResult.needSupplement`) → 设置 `pendingSupplement = true`，回到 `rewrite` 补充检索
- `pendingRevise` 回退不消耗 fallbackCount（不计入回退上限）
- 相关性初审 `not_relevant` / `partial` 触发回退，消耗 fallbackCount

#### 4.2.3 流式回答生成（Writing 阶段）

```
emitStatus('writing', '正在生成回答...')
  → 构建上下文: buildContextText(state.rerankedHits)
    → [来源 1] 文档: xxx\n内容片段...
  → WRITER_SYSTEM_PROMPT.replace('{context}', context)
  → draftModel.stream([SystemMessage(prompt), HumanMessage(query)])
  → for await chunk: emitText(text) → writer.write({ type: 'text-delta', ... })
  → 积攒 fullAnswer → state.draftAnswer
```

#### 4.2.4 质量校验（Verifying 阶段）

写入回答后，并行执行事实校验和完整性校验：

- **事实校验** — `factCheckNode`
  - 将回答内容切片为独立声明，逐条与检索上下文对照
  - 输出: `{ items: [{ claimId, claimText, verdict, evidence }], overallRisk: 'low'|'medium'|'high', needRevise: boolean }`

- **完整性校验** — `completenessCheckNode`
  - 对照拆解出的子问题，检查回答是否覆盖所有方面
  - 输出: `{ overallCoverage: 0-1, missingAspects: [{ aspect, reason }], needSupplement: boolean }`

- 如果已有 `pendingSupplement` 标记（说明已经是补充检索后的），跳过完整性校验直接结束

### 4.3 发送给前端的所有事件类型（7 种）

| 序号 | SSE type 字段 | 触发位置 | 用途 |
|-----|-------------|---------|------|
| 1 | `text-delta` | `orchestrator.ts:731` / `chat-stream.service.ts:200` | LLM 逐 token 文本增量 |
| 2 | `data-agent-status` | `orchestrator.ts:724-726` | Agent 工作流阶段切换 |
| 3 | `data-retrieval-progress` | `orchestrator.ts:755-763` | 混合检索完成后的统计 |
| 4 | `data-citation-snapshot` | `orchestrator.ts:901-913` | 最终回答的引用快照 |
| 5 | `finish` | `orchestrator.ts:924` | 流正常结束 |
| 6 | `error` | `orchestrator.ts:933` | 异常时推送错误信息 |
| 7 | `finish`(error) | `orchestrator.ts:934` | 异常时结束标记 |

#### 各事件详细数据结构

**text-delta**
```json
{ "type": "text-delta", "id": "rag-msg-1", "delta": "你好" }
```

**data-agent-status**
```json
{
  "type": "data-agent-status",
  "data": {
    "type": "agent-status",
    "phase": "planning",
    "detail": "意图: fact_lookup | 需拆解: false"
  }
}
```

**data-retrieval-progress**
```json
{
  "type": "data-retrieval-progress",
  "data": {
    "type": "retrieval-progress",
    "denseCount": 15,
    "sparseCount": 12,
    "fusedCount": 20
  }
}
```

**data-citation-snapshot**
```json
{
  "type": "data-citation-snapshot",
  "data": {
    "type": "citation-snapshot",
    "citations": [
      { "chunkId": "xxx", "docId": "yyy", "content": "...", "title": "..." }
    ]
  }
}
```

**finish / error**
```json
{ "type": "finish", "finishReason": "stop" }
{ "type": "error", "errorText": "具体错误信息" }
{ "type": "finish", "finishReason": "error" }
```

### 4.4 AgentPhase 与 Node 映射

```typescript
type AgentPhase = 'planning' | 'retrieving' | 'reranking' | 'verifying' | 'writing' | 'done';
```

| 节点名 | AgentPhase | detail 示例 |
|-------|-----------|------------|
| route | `planning` | `意图: fact_lookup | 需拆解: false` |
| rewrite | `planning` | `改写完成 → 3 条查询` |
| decompose | `planning` | `拆解完成 → 2 个子问题` |
| retrieve_prep | `retrieving` | `开始分析...` |
| tools | `retrieving` | `检索完成 → 5 条结果` |
| relevance_check | `verifying` | `相关性: relevant` |
| verify | `verifying` | `事实风险: low | 完整性: 85%` |
| finalize | `finalizing` | `最终化 → 256 字` |
| (writer) | `writing` | `回答生成完成 → 256 字` |

---

## 五、检索流水线

### 5.1 四阶段检索

```
RetrievalService.retrieve({ queries, kbIds, questionType })
  │
  ├─ 1. DenseRetrievalService (稠密向量检索)
  │      → Qdrant 向量相似度搜索, topK=20
  │
  ├─ 2. ElasticsearchSparseRetrievalService (稀疏关键词检索)
  │      → ES BM25 全文检索, topK=20
  │
  ├─ 3. FusionService.fuse() (RRF 融合)
  │      → Reciprocal Rank Fusion, topK=50
  │
  └─ 4. RerankService.rerank() (Cross-encoder 精排)
         → 对融合结果重新打分 + 阈值过滤 (scoreThreshold=0.3)
```

### 5.2 检索工具封装

检索被包装为 LangChain `tool()` 供 Agent 调用：

```typescript
const searchTool = tool(
  async (input: { queries: string[]; kbIds: string[]; questionType?: string }) => {
    const result = await retrievalService.retrieve(input);
    await traceService.recordStep(runId, { agentName: 'retriever', ... });
    return { hits, hitCount, denseCount, sparseCount, durationMs };
  },
  { name: 'search_knowledge_base', schema: zodSchema }
);
```

---

## 六、前端解析与渲染全流程

### 6.1 数据接入层

**入口**: `useAgentChat.ts` 的 `sendMessage()` 方法

```
用户点击发送
  → chatStore.setLastUserMessage(message)
  → 构建 StreamChatRequest { sessionId, chatMode, message, selectedKbIds, agentMode: 'multi-agent' }
  → 乐观更新: addUserMessage() + addAssistantMessage(占位, status='streaming')
  → chatStore.resetAgentState()  重置所有 Agent 状态
  → fetchChatStream(request)
    → apiRequestStream({ url: '/chat/stream', method: 'POST', body: request })
      → fetch() + 自动 Token 注入 + 401 刷新排队
  → response.body.getReader() 获取 ReadableStream reader
  → TextDecoder 逐块解码
```

### 6.2 SSE 解析器

```typescript
// useAgentChat.ts:51-71
function parseSSEData(line: string): { type: string; data: Record<string, unknown> } | null {
  if (!line.startsWith('data: ')) return null;

  const json = line.slice(6);           // 去掉 "data: " 前缀
  if (json === '[DONE]') {
    return { type: '[DONE]', data: {} };
  }

  try {
    const obj = JSON.parse(json);
    const type = typeof obj.type === 'string' ? obj.type : '';
    return { type, data: obj };
  } catch {
    return null;
  }
}
```

**注意**: 后端使用 AI SDK 的 `createUIMessageStream` + `pipeUIMessageStreamToResponse` 发送流数据，内部编码为前缀格式（`0:` 文本、`8:` data、`d:` finish）。前端按传统 SSE 格式（`data: {...}`）解析，两者的适配取决于 `ai` 包的内部转换行为。如果流式文本未正常到达前端，应优先排查此协议层。

### 6.3 6 种事件的 dispatch 逻辑

```typescript
// useAgentChat.ts:192-254
const { type, data } = parsed;

if (type === 'text-delta') {
  // 文本增量: {"type": "text-delta", "id": "...", "delta": "..."}
  pushDelta(data.delta as string);
}
else if (type === 'finish') {
  // 流结束: {"type": "finish", "finishReason": "stop"}
  flush();
}
else if (type.startsWith('data-')) {
  // 自定义 data 事件: {"type": "data-xxx", "data": {...}}
  const innerData = data.data as Record<string, unknown>;
  const innerType = innerData.type as string;

  switch (innerType) {
    case 'agent-status':
      chatStore.setAgentPhase(phase, label, detail);
      break;
    case 'retrieval-progress':
      chatStore.addRetrievalProgress({ denseCount, sparseCount, fusedCount });
      break;
    case 'citation-snapshot':
      chatStore.setCitations(citations);
      break;
    case 'agent-warning':
      chatStore.addWarning(warning);
      break;
    case 'agent-step':
      chatStore.addAgentStep(step);
      break;
    case 'tool-call':
      chatStore.addToolCall(toolCall);
      break;
  }
}
```

### 6.4 流式 Markdown 增量渲染

**核心组件**: `useStreamingMarkdown.ts`

**策略**: 逐 token 接收 → buffer 累积 → 块级 flush → innerHTML 追加

```
pushDelta(delta: string)
  → state.buffer += delta
  → tryFlush()
    → 检测完整代码块 (``` 配对出现)
      → 提取代码 + 语法高亮 (highlight.js)
      → 输出 <pre><code class="hljs language-xxx">...</code></pre>
    → 检测段落分隔 (\n\n)
      → marked.parse(buffer) → HTML
      → onFlush(html) → chatStore.updateAssistantMessageHtml(id, html, 'append')
    → 检测标题行 (^#{1,6}\s)
      → 立即 flush
    → buffer 超过阈值 (80字符)
      → 强制 flush

flush()
  → tryFlush(true)
  → 处理残留代码块 (isInCodeBlock)
  → 处理残留文本
  → onComplete()
```

**渲染钩子**（在 `useAgentChat.ts:140-152` 注册）：

```typescript
const { pushDelta, flush, reset } = useStreamingMarkdown({
  onFlush: (html) => {
    // 每次 flush: 追加 HTML 到对应消息
    chatStore.updateAssistantMessageHtml(assistantMsgId, html, 'append');
  },
  onComplete: () => {
    chatStore.setMessageStatus(assistantMsgId, 'completed');
    onMessageFinish?.(assistantMsgId);
  },
  onError: (err) => { ... },
});
```

### 6.5 前端组件层级

```
ChatView.vue                                   — 页面入口，组装所有子组件
├── ChatTopNavBar                              — 顶部导航栏
├── ChatStatusBanner.vue                       — 警告横幅 (低置信度/部分回答等)
│     v-if: chatStore.hasWarnings
├── ChatSettingsBar.vue                        — 模式切换 / 知识库选择 / 模型选择
│     ├── ChatModeToggle.vue                   — chat ↔ rag 模式切换
│     ├── ChatKbSelector.vue                   — 知识库级联选择器 (私人/共享/公开)
│     └── ChatModelSelector.vue                — 模型选择器
├── ChatStream.vue                             — 消息列表容器 (MutationObserver 自动滚动)
│     ├── UserMessageItem.vue                  — 用户消息气泡 (右侧, 带头像)
│     └── AIMessageItem.vue                    — AI 消息 (Markdown + 操作栏)
│           └── (RAG 模式) 使用 AIAgentMessage.vue
│                 ├── Agent 详情面板 (可折叠)
│                 │   ├── 检索进度: Dense/Sparse/Fused 数量
│                 │   ├── 工具调用: toolName + queries + durationMs
│                 │   └── 执行流程: 7 个步骤的时间线列表
│                 └── Markdown 内容 (v-html)
├── ChatCitationPanel.vue                      — 引用面板
│     v-if: chatStore.hasCitations
└── ChatInputArea.vue                          — 浮动输入框 (发送/取消按钮)
```

### 6.6 AIAgentMessage 详细渲染逻辑

**阶段图标映射**:

| phase | Material Icon | 颜色 | 中文标签 |
|-------|--------------|------|---------|
| `planning` | `psychology` | text-purple-400 | 规划中 |
| `retrieving` | `search` | text-blue-400 | 检索中 |
| `reranking` | `sort` | text-cyan-400 | 重排中 |
| `verifying` | `verified` | text-amber-400 | 校验中 |
| `writing` | `edit_note` | text-green-400 | 生成中 |
| `done` | `check_circle` | text-primary | 完成 |

**节点步骤中文化映射**:

| stepType | 中文标签 |
|----------|---------|
| `route_query` | 路由分析 |
| `rewrite_query` | 查询改写 |
| `decompose_question` | 问题拆解 |
| `hybrid_retrieve` | 混合检索 |
| `relevance_check` | 相关性检查 |
| `fact_check` | 事实校验 |
| `completeness_check` | 完整性检查 |

**步骤状态图标**:
- `completed` → `check_circle` (text-green-400)
- `failed` → `error` (text-red-400)
- `started` → `hourglass_empty` (text-amber-400)

### 6.7 消息自动滚动策略

`ChatStream.vue` 使用 `MutationObserver` 监听 DOM 变化实现流式场景下的平滑自动滚动：

```typescript
observer = new MutationObserver(() => {
  scrollToBottom();  // container.scrollTop = container.scrollHeight
});
observer.observe(containerRef.value, {
  childList: true, subtree: true, characterData: true,
});
```

相比 `scrollIntoView` 方案，`MutationObserver` 对流式追加内容更精准，不会因频繁调用造成抖动。

### 6.8 状态管理 (chatStore)

**Pinia Store** (`stores/chat.ts`) 管理的核心状态：

| 状态分组 | 字段 | 说明 |
|---------|------|------|
| 会话 | `sessions`, `currentSession`, `messages` | 会话列表 + 当前会话 + 消息列表 |
| 加载 | `isLoadingSessions`, `isLoadingMessages`, `isSending` | 加载态 |
| 模式 | `chatMode`, `selectedKbIds`, `selectedModel` | 模式选择 |
| Agent 阶段 | `agentPhase`, `agentPhaseLabel`, `agentPhaseDetail` | 当前所在阶段 |
| Agent 步骤 | `agentSteps` | 节点执行记录列表 |
| 工具调用 | `toolCalls` | 工具调用记录列表 |
| 检索 | `retrievalProgresses` | 检索进度列表 (去重保留最新) |
| 引用 | `citations` | 引用列表 |
| 警告 | `agentWarnings` | 警告信息列表 |

---

## 七、完整数据流图

```
┌─────────────────────────────────────────────────────────┐
│                        前端                              │
│                                                         │
│  ChatView.vue                                           │
│    └→ useAgentChat.sendMessage(message)                 │
│         ├─ 乐观更新: addUserMessage + addAssistantMessage│
│         ├─ resetAgentState()                            │
│         └─ fetchChatStream(request)                     │
│              └→ apiRequestStream() → fetch()            │
│                   └→ response.body.getReader()          │
│                        └→ TextDecoder + 按行分割         │
│                             └→ parseSSEData(line)       │
│                                  └→ 事件分发:            │
│                                      ├─ text-delta → pushDelta()              │
│                                      │    └→ useStreamingMarkdown             │
│                                      │         ├─ buffer 累积                 │
│                                      │         ├─ 代码块检测 → highlight.js   │
│                                      │         ├─ marked.parse() → HTML       │
│                                      │         └─ onFlush(html)               │
│                                      │              └→ updateAssistantMessageHtml│
│                                      ├─ agent-status → setAgentPhase()        │
│                                      ├─ retrieval-progress → addRetrievalProgress│
│                                      ├─ agent-step → addAgentStep()           │
│                                      ├─ tool-call → addToolCall()             │
│                                      ├─ citation-snapshot → setCitations()    │
│                                      └─ agent-warning → addWarning()          │
└──────────────────┬──────────────────────────────────────┘
                   │ POST /api/chat/stream
                   ▼
┌─────────────────────────────────────────────────────────┐
│                        后端                              │
│                                                         │
│  ChatController.streamChat()                            │
│    └→ ChatStreamService.streamChat(userId, dto)         │
│         │                                               │
│         ├─ chat 模式 ────────────────────────────────── │
│         │  streamChatMode()                             │
│         │    → SystemMessage + HumanMessage             │
│         │    → model.stream(messages)                   │
│         │    → toUIMessageStream(stream, callbacks)     │
│         │    → text-delta / finish                      │
│         │                                               │
│         └─ rag 模式 ─────────────────────────────────── │
│            streamRagMode()                              │
│              → kbPermissionService.authorizeMany()      │
│              → createUserMessage() + createAssistantPlaceholder()│
│              → orchestrator.streamRun(runCtx, callbacks)│
│                   │                                     │
│                   ├─ StateGraph 执行                    │
│                   │   route → rewrite → decompose       │
│                   │     → retrieve → relevance_check   │
│                   │     → verify → finalize             │
│                   │   每个节点 emitStatus() → data-agent-status│
│                   │   检索完成 → data-retrieval-progress│
│                   │                                     │
│                   ├─ 流式生成回答                       │
│                   │   WRITER_SYSTEM_PROMPT + context    │
│                   │   + draftModel.stream()             │
│                   │   → emitText() → text-delta         │
│                   │                                     │
│                   ├─ 质量校验                           │
│                   │   并行: factCheck + completenessCheck│
│                   │                                     │
│                   └─ 完成                               │
│                     data-citation-snapshot              │
│                     + finish                            │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│                      数据库                              │
│                                                         │
│  b_chat_sessions    — 会话元数据 + 标题 + 模式记忆       │
│  b_chat_messages    — 用户/AI 消息 + 引用 + Token 消耗   │
│  b_agent_runs       — Agent 执行记录 + 状态 + 耗时       │
│  b_agent_steps      — 每个节点的输入/输出/耗时           │
└─────────────────────────────────────────────────────────┘
```

---

## 八、协议层说明

### 8.1 后端编码

后端使用 `@ai-sdk/langchain` 的 `toUIMessageStream()` 和 `ai` 包的 `createUIMessageStream()` 生成流：

- LangChain stream → `toUIMessageStream()` → AI SDK `UIMessageStream`
- 自定义 Agent 流程 → `createUIMessageStream({ execute })` → 在 execute 中手动 write
- 最终通过 `pipeUIMessageStreamToResponse({ response: res, stream })` 输出为 SSE

### 8.2 前端解析

前端 `useAgentChat.ts` 按传统 SSE 格式（`data: {...}\n\n`）解析。AI SDK 内部可能做了格式转换，如果出现流式文本丢失或解析异常，需检查：
1. `ai` 包的 `pipeUIMessageStreamToResponse` 实际输出的 HTTP 响应体格式
2. 浏览器 Network 面板中 EventStream 的实际内容格式
3. 前端解析器与后端编码器是否版本匹配

---

## 九、业内主流方案对比

### 9.1 流式响应协议

| 方案 | 协议格式 | 说明 |
|-----|---------|------|
| **Vercel AI SDK** | `0:` 文本 / `2:` tool call / `8:` data / `d:` done | 前缀编码，高效区分消息类型 |
| **OpenAI** | 标准 SSE `data: {...}` + `data: [DONE]` | 最通用的流式协议 |
| **Anthropic** | SSE `event: message_start/content_block_delta/message_stop` | 更精细的事件类型 |
| **当前实现** | AI SDK data stream | 后端用 Vercel AI SDK，前端按 SSE 解析 |

### 9.2 多 Agent 编排

| 方案 | 编排方式 | 说明 |
|-----|---------|------|
| **LangGraph** | StateGraph + 条件边 | 官方方案，支持 checkpoint 和回溯 |
| **CrewAI** | 角色定义 + 顺序/层级执行 | 更偏向角色扮演 |
| **AutoGen** | 多 Agent 对话 + 群聊模式 | 微软出品，支持人机交互 |
| **当前实现** | 自研 StateGraph + 7 节点 + 双轮回退 | 基于 LangGraph 的自定义图，更可控 |

### 9.3 RAG 检索

| 方案 | 检索策略 |
|-----|---------|
| **LlamaIndex** | 内置多种检索器 + 融合策略 |
| **LangChain** | `EnsembleRetriever` + `ContextualCompressionRetriever` |
| **当前实现** | Dense(Qdrant) + Sparse(ES BM25) → RRF 融合 → Cross-encoder Rerank |

### 9.4 质量校验

| 方案 | 校验方式 |
|-----|---------|
| **RAGAS** | 事后评估: faithfulness / answer_relevancy / context_precision |
| **LangSmith** | 追踪 + 人工评估 |
| **DeepEval** | 在线评估 + 合成数据 |
| **当前实现** | 实时双重校验: Fact Check + Completeness Check → 触发回退 |

当前实现的**实时双重校验 + 回退循环**在业内较为少见，大多数系统仅在事后做离线评估。

### 9.5 前端渲染

| 方案 | 渲染策略 |
|-----|---------|
| **Vercel AI SDK (React)** | `useChat()` Hook + 自动解析 + 流式渲染 |
| **streamdown** | buffer + 块级 flush + 代码高亮 |
| **当前实现** | 自研 `useStreamingMarkdown`: buffer 累积 + 块级 flush + marked + highlight.js |

### 9.6 综合对比总结

| 维度 | 当前实现 | 业界主流 | 评价 |
|-----|---------|---------|------|
| 流式协议 | AI SDK data stream | Vercel AI SDK / OpenAI SSE | 协议选型合理 |
| Agent 编排 | LangGraph 自研 7 节点图 | LangGraph / CrewAI / AutoGen | 业内主流路线 |
| 检索策略 | 双路检索+RRF+Rerank | 类似 | 达到主流水平 |
| 实时校验 | Fact Check + Completeness Check | 事后评估为主 (RAGAS) | **亮点，领先业界** |
| 回退重试 | 最多 2 次回退循环 | 较少见 | **亮点** |
| 流式 Markdown | 自研 buffer+flush | Vercel useChat / streamdown | 功能完备 |
| Token 计数 | 无实时显示 | ChatGPT 实时显示 | 可增强 |
| 中断/恢复 | 不支持 | AutoGen 支持 | 可增强 |
| 引用交互 | 基础展示 | Notion AI 可点击跳转 | 可增强 |
| 协议一致性 | 后端前缀编码 vs 前端 SSE 解析 | 统一协议 | **需排查** |

---

## 十、优化建议

1. **协议一致性排查**: 后端使用 AI SDK 前缀编码 (`0:` / `8:` / `d:`)，前端按传统 SSE (`data:`) 解析，建议确认 `pipeUIMessageStreamToResponse` 的实际输出格式，确保两端匹配。

2. **类型安全**: 后端 `writer.write({...} as any)` 大量使用 `as any`，建议使用 AI SDK 的 `DataStreamWriter` 类型或自定义类型守卫。

3. **回退策略可配化**: `MAX_FALLBACK = 2` 写死，可考虑根据问题复杂度或 token 消耗动态调整。

4. **工具调用可视化增强**: 目前前端定义了 `tool-call` 事件但后端在流式代码中未实际发送该事件，工具调用信息仅通过 `agent-step` 间接记录。如需渲染工具调用卡片，需在 `tools` 节点中补充 `data-tool-call` 事件。

5. **实时 Token 计数**: 可在 `finish` 事件中附带 `usage: { promptTokens, completionTokens }`，前端展示 token 消耗。

6. **引用可点击跳转**: 引用项增加文档 ID+分块 ID，前端支持点击跳转到知识库文档详情页。

---

## 十一、关键文件路径

| 功能 | 文件路径 |
|-----|---------|
| 后端控制器 | `apps/server/src/modules/chat/chat.controller.ts` |
| 流式服务 | `apps/server/src/modules/chat/services/chat-stream.service.ts` |
| 多 Agent 编排器 | `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts` |
| 消息服务 | `apps/server/src/modules/chat/services/chat-message.service.ts` |
| Agent 追踪服务 | `apps/server/src/modules/chat/services/agent-trace.service.ts` |
| 路由提示词 | `apps/server/src/modules/chat/prompts/router.prompt.ts` |
| 路由 Schema | `apps/server/src/modules/chat/schemas/routed-query-plan.schema.ts` |
| 检索流水线 | `apps/server/src/modules/rag/retrieval/retrieval.service.ts` |
| Prisma Schema | `apps/server/prisma/schema.prisma` |
| 前端 API 层 | `apps/web/src/api/chat.ts` + `apps/web/src/api/api.ts` |
| 流式解析 + Agent Hook | `apps/web/src/modules/chat/composables/useAgentChat.ts` |
| Markdown 渲染器 | `apps/web/src/modules/chat/composables/useStreamingMarkdown.ts` |
| 流式类型定义 | `apps/web/src/modules/chat/types/stream.ts` |
| 聊天类型定义 | `apps/web/src/modules/chat/types/chat.ts` |
| 聊天 Store | `apps/web/src/stores/chat.ts` |
| 消息流容器 | `apps/web/src/components/chat/ChatStream.vue` |
| AI 消息组件 | `apps/web/src/components/chat/AIMessageItem.vue` |
| Agent 消息组件 | `apps/web/src/components/chat/AIAgentMessage.vue` |
| 页面入口 | `apps/web/src/views/chat/ChatView.vue` |
