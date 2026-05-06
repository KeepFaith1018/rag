# 对话模块 Phase 6 — AG-UI 协议迁移与 Agent 步骤实时展示

## 概述

将对话流式通信从 Vercel AI SDK (`ai` + `@ai-sdk/langchain`) 替换为 AG-UI (Agent-User Interaction Protocol) 标准协议，通过原生 SSE 推送 Agent 工作流各节点的执行步骤和工具调用结果到前端，实现类似 ChatGPT/Claude 的 "思考过程" 实时展示效果。

## 动机

- AI SDK v6 的流式协议围绕 LLM function calling 设计，不适合本项目基于 LangGraph 固定图结构的 Agent 编排模式
- 原实现仅发送粗粒度的 `agent-status` 阶段事件，前端无法获知具体步骤（路由、改写、检索、生成）的输入输出
- AG-UI 协议提供 `STEP_STARTED/FINISHED`、`TOOL_CALL_START/RESULT`、`TEXT_MESSAGE_*` 等细粒度事件类型，天然适合多 Agent 管线

## 依赖变更

```diff
- ai@^6.0.168
- @ai-sdk/langchain
```

不再需要 `ai` 和 `@ai-sdk/langchain` 包。前端也无需新增依赖，SSE 解析改为直接消费 AG-UI JSON 事件。

## 协议设计

### 事件序列（RAG 模式完整流程）

```
RUN_STARTED          → 运行开始
  STEP_STARTED       → route 节点开始
  STEP_FINISHED      → route 完成 (intent, questionType)
  STEP_STARTED       → rewrite 节点开始
  STEP_FINISHED      → rewrite 完成 (queries)
  TOOL_CALL_START    → search_knowledge_base 开始
  TOOL_CALL_RESULT   → search_knowledge_base 完成 (hitCount, durationMs)
  TOOL_CALL_START    → web_search 开始 (条件)
  TOOL_CALL_RESULT   → web_search 完成 (条件)
  STEP_STARTED       → writer 节点开始
  TEXT_MESSAGE_START → 文本流开始
  TEXT_MESSAGE_CONTENT × N  → token 级增量
  TEXT_MESSAGE_END   → 文本流结束
  STEP_FINISHED      → writer 完成
RUN_FINISHED         → 运行结束
```

### 事件格式

SSE 标准格式：`data: {"type":"...","field1":"value1",...}\n\n`

LLM 流式节点 (writer) 中每个 token 独立推送为一条 SSE 事件，前端通过 `useStreamingMarkdown` 累积渲染。非流式节点 (route, rewrite, tools) 发 STEP_STARTED → 等待批量结果 → STEP_FINISHED。

## 后端改动

### 1. 新增文件

| 文件 | 说明 |
|------|------|
| `src/modules/chat/types/agui-events.ts` | AG-UI 事件类型定义 + `SseWriter` 工具类 |

`SseWriter` 封装原生 Express Response，提供 `write(event)` 和 `end()` 方法，格式化为 SSE 行输出。

### 2. 修改文件

| 文件 | 改动内容 |
|------|---------|
| `chat.controller.ts` | 移除 `pipeUIMessageStreamToResponse`；手动设置 SSE 响应头；创建 `SseWriter` 并传入 service |
| `chat-stream.service.ts` | 移除 `toUIMessageStream`、`UIMessageChunk`；方法签名改为 `(userId, dto, writer) => Promise<void>`；Chat 模式手动写 AG-UI 文本事件 |
| `multi-agent-orchestrator.service.ts` | 移除 `createUIMessageStream`；每个 LangGraph 节点内发射对应 AG-UI 事件；使用 `graph.invoke()` 替代 `graph.stream()` |

### 3. Orchestrator 节点事件映射

| 图节点 | 发射的事件 |
|--------|-----------|
| route | `STEP_STARTED("route")` → 执行 → `STEP_FINISHED("route", {intent, questionType})` |
| rewrite | `STEP_STARTED("rewrite")` → 执行 → `STEP_FINISHED("rewrite", {queries})` |
| tools | `TOOL_CALL_START("search_knowledge_base", {queries, kbIds})` → 执行 → `TOOL_CALL_RESULT({hitCount, denseCount, sparseCount, durationMs})` |
| web_search | `TOOL_CALL_START("web_search", {query})` → 执行 → `TOOL_CALL_RESULT({resultCount, durationMs})` |
| writer | `STEP_STARTED("writer")` → `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT × N` → `TEXT_MESSAGE_END` → `STEP_FINISHED("writer")` |

## 前端改动

### 1. 类型层

| 文件 | 改动 |
|------|------|
| `stream.ts` | 重写为 AG-UI 事件类型（`AguiEvent` 联合类型、`AguiStepRecord`、`AguiToolCallRecord`）。保留旧兼容类型 (`AgentPhase`, `Citation`, `AgentWarningPart`, `RetrievalProgressPart`) |
| `chat.ts` | `ChatMessageItem` 新增 `aguiSteps?`、`aguiToolCalls?` 字段，用于持久化步骤数据到消息 |

### 2. SSE 解析层

`useAgentChat.ts` 重写：
- 移除 AI SDK 的 `data-*` 双层包装解析
- 直接解析 `data: {"type":"...","..."}\n\n` 行
- 按 AG-UI 事件类型 `switch` 分发到 store 方法
- `RUN_FINISHED` 时将步骤/工具数据快照到消息对象（保证切换会话后历史消息仍可见）

### 3. 状态管理层

Store (`chat.ts`) 适配：
- `aguiSteps` / `aguiToolCalls` 替代旧的 `agentSteps` / `toolCalls`
- `upsertStep()` — STEP_STARTED 创建 running 记录，STEP_FINISHED 更新为 completed
- `upsertToolCall()` — TOOL_CALL_START 创建 running 记录，TOOL_CALL_RESULT 更新为 completed
- `setRunStarted()` / `setRunFinished()` — 运行生命周期管理

### 4. UI 层

`AIMessageItem.vue` 新增 **Agent 步骤面板**：

- 仅 RAG 模式且有步骤/工具数据时显示
- 可折叠面板（流式中默认展开，完成后自动折叠）
- 步骤时间线：每步显示图标、名称、状态（进行中/完成）、耗时
- 工具调用卡片：缩进子项，显示工具名、输入摘要、输出结果、耗时
- 数据来源：优先取消息自身 `aguiSteps`/`aguiToolCalls`（历史消息），流式中 fallback store

## 验证

1. 后端编译：`pnpm --filter server build` → 0 errors
2. 前端编译：`pnpm --filter web build` → 0 errors
3. 后端启动：`pnpm --filter server start:dev` → Found 0 errors
4. SSE 事件验证（curl 或 DevTools Network EventStream 查看）

## 文件清理

`AIAgentMessage.vue` 保留但不再从 store 读取旧字段 `agentSteps`/`toolCalls`，改为读取 `aguiSteps`/`aguiToolCalls`。该组件目前未在 `ChatStream.vue` 中使用（备用完整消息组件）。
