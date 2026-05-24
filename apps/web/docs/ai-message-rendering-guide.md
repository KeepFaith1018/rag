# AI 消息渲染管线 — 前端学习指南

> 适用读者：已掌握 Vue 3 + TypeScript 基础，想深入理解本项目的流式渲染架构。

---

## 学习路线图

```
第 1 步          第 2 步           第 3 步             第 4 步
类型定义  →  Store 层  →  流式数据管道  →  组件渲染层
(30min)      (45min)        (60min)           (60min)
```

每步对应一组文件，按从上到下的顺序阅读。

---

## 第 1 步：类型定义（理解"数据长什么样"）

**目的**：搞清楚核心数据结构，后续代码才不会看不懂。

### 阅读顺序

**1.1 [stream.ts](apps/web/src/modules/chat/types/stream.ts)** — AG-UI 事件类型（约 195 行）

这是前后端 SSE 通信的协议定义。重点关注：

| 行号 | 内容 | 要点 |
|------|------|------|
| 8-21 | `StepName` 联合类型 | 12 种 Agent 步骤名，从 `route` 到 `supplement_retrieve` |
| 23-24 | `ToolCallName` | 2 种工具：`search_knowledge_base` / `web_search` |
| 28-43 | 运行生命周期事件 | `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` |
| 48-60 | 步骤事件 | `STEP_STARTED` / `STEP_FINISHED`（携带 input/output/durationMs） |
| 64-77 | 工具调用事件 | `TOOL_CALL_START` / `TOOL_CALL_RESULT` |
| 81-95 | 文本消息事件 | `TEXT_MESSAGE_START/CONTENT/END`，`delta` 字段是增量文本 |
| 99-121 | `AguiEvent` 联合类型 | 所有事件的联合，`parseSSELine()` 的返回值类型 |
| 123-152 | 持久化记录类型 | `AguiStepRecord` / `AguiToolCallRecord` / `TimelineEntry` — 流结束后快照到消息对象 |
| 156-194 | 遗留兼容类型 | `AgentPhase` / `Citation` / `AgentWarningPart` — 旧架构残留 |

**核心认知**：SSE 是一种单向推送协议。每个事件就是一个 JSON 对象，`type` 字段区分事件种类。前端的工作就是：**解析 SSE 文本 → 识别事件类型 → 更新 store → 驱动 UI**。

---

**1.2 [chat.ts](apps/web/src/modules/chat/types/chat.ts)** — 消息与 UI 类型（约 107 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 9-16 | `RenderableBlock` | Incremark AST 块 + 可选的 `displayNode`（打字机截断后的 AST） |
| 18-19 | `MessageRole` | `'ai' \| 'user' \| 'assistant'` |
| 21-22 | `ChatMode` | `'chat'`（普通对话） vs `'rag'`（知识库问答） |
| 39-61 | `ChatMessageItem` | **核心消息类型**。关键字段：`content`（原始文本）、`htmlContent`（旧兼容）、`blocks`（Incremark AST）、`aguiSteps/aguiToolCalls`（流完成后快照） |
| 63-71 | `MessageStatus` | 7 种状态：`pending → streaming → validating/supplementing → completed/aborted/error` |
| 78-89 | `StreamChatRequest` | 发送给后端的请求体结构 |

**核心认知**：`ChatMessageItem` 是贯穿整个渲染管线的一等公民。它同时承载了：
- 原始 Markdown 文本（`content`）
- 旧版 HTML（`htmlContent`，兼容历史消息）
- 新版 AST 块（`blocks`，Incremark 解析产物）
- Agent 步骤快照（`aguiSteps/aguiToolCalls`，RUN_FINISHED 时写入）

---

## 第 2 步：Store 层（理解"数据放在哪、怎么变"）

**目的**：理解状态管理架构，以及拆分后的三层 store 各自职责。

### 阅读顺序

**2.1 [chat-session.ts](apps/web/src/stores/chat-session.ts)** — 会话+消息 CRUD（约 180 行）

这是最底层的 domain store，只管"会话列表"和"消息列表"。

| 行号 | 内容 | 要点 |
|------|------|------|
| 17-22 | 状态定义 | `sessions` / `currentSession` / `messages` / `isSending` |
| 40-63 | 会话操作 | `createSession` → `selectSession`（含 `loadMessages` 副作用） |
| 124-127 | `setMessageStatus` | **按 `msg.id` 查找**而非数组下标 — 这是重构后修复过的 bug |
| 139-142 | `appendMessageBlocks` | **全量替换**而非追加。流式渲染中每次 `onBlocks` 回调都传入完整 blocks 数组，直接赋值 `msg.blocks = blocks` |

**核心认知**：`appendMessageBlocks` 叫 "append" 是历史遗留命名，实际是 **set/replace**。因为 Incremark transformer 每次都输出完整的 blocks 列表，不是增量。

---

**2.2 [chat-agent.ts](apps/web/src/stores/chat-agent.ts)** — Agent 运行时状态（约 184 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 20-30 | 状态定义 | `aguiSteps` / `aguiToolCalls` / `agentPhase` / `citations` / `agentWarnings` / `timelineOrder` |
| 30 | `timelineOrder` | **模块级变量**（非 ref），每次 upsert 自增，用于步骤+工具时间线排序 |
| 37-48 | `resetAgentState` | 每次新消息前重置所有运行时状态 |
| 75-91 | `stepLabel` | 步骤名 → 中文标签映射 |
| 110-130 | `upsertStep` | 查找已有步骤（按 `stepName`），存在则合并、不存在则 push。同时自动推断 `agentPhase` 和 `agentPhaseLabel` |
| 132-147 | `upsertToolCall` | 同上，查找键为 `toolCallId`。`search_knowledge_base` 完成时自动添加检索进度 |

**核心认知**：`agentPhase` 是从步骤类型自动推断的（`phaseMap`），不需要 SSE 显式发送。步骤和工具调用都带 `order` 字段，在 `ChatAgentPanel` 中合并为统一时间线。

---

**2.3 [chat.ts](apps/web/src/stores/chat.ts)** — 统一入口 store（约 289 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 32-35 | 组合三个子 store | `sessionStore` / `agentStore` / `configStore` |
| 39-41 | `storeToRefs` + `toRef` | 保持响应式引用，而非快照值 |
| 61-63 | `watch` 同步 | 将 config store 的 refs 同步到本地 refs（历史做法，理想情况应用 `storeToRefs` 直接引用） |
| 131-155 | 消息操作代理 | 所有方法透传到 `sessionStore` |
| 196-222 | Agent 操作代理 | 所有方法透传到 `agentStore` |

**核心认知**：`chat.ts` 是门面（Facade），不存自己的状态，所有调用代理到子 store。`ChatView.vue` 和 `AIMessageItem.vue` 都通过 `useChatStore()` 访问数据。

---

## 第 3 步：流式数据管道（理解"数据怎么流动"）

**目的**：这是整个系统最核心的部分——从用户点击发送到屏幕上逐字显示。

### 阅读顺序

**3.1 [useStreamingMarkdown.ts](apps/web/src/modules/chat/composables/useStreamingMarkdown.ts)** — 打字机效果引擎（约 201 行）

**建议先读文件头注释（1-9 行）**，理解三层架构：

```
文本增量 → IncremarkParser (增量解析 Markdown → AST)
         → BlockTransformer (RAF 驱动，逐帧截断 AST)
         → onBlocks 回调 → store → MarkdownRenderer
```

| 行号 | 内容 | 要点 |
|------|------|------|
| 46-58 | `normalizeEmphasis` | 修复 CJK 标点导致的 CommonMark 强调定界符失效 |
| 60-93 | `useStreamingMarkdown()` | 创建 parser + transformer |
| 67 | `createIncremarkParser({ gfm: true })` | 支持 GFM 表格/任务列表等 |
| 74-90 | `createBlockTransformer` | 核心配置：`charsPerTick: [1,3]`、`tickInterval: 25`、`effect: 'typing'`、`pauseOnHidden: true` |
| 78 | `codeBlockPlugin` | 不加此插件时代码块逐字打字，加之后代码块整体显示 |
| 80-85 | `onChange` 回调 | **过滤空数组** — transformer 处理完会 emit `[]`，直接应用会使内容消失 |
| 102-130 | `pushDelta()` | **最重要的方法**。关键逻辑：每次 push 必须传入 parser 的**全量**已完成 block + 本次 updated block，因为 transformer 内部按 id 集合过滤 |
| 135-158 | `flush()` | finalize parser → push 剩余 block → 如 transformer 已无待处理则立即 complete |
| 163-165 | `skip()` | 跳过动画，立即显示全部 |
| 174-184 | `reset()` vs `resetAll()` | `reset()` 只清 parser（流结束后用），`resetAll()` 清 parser + transformer（新消息开始时用） |

**核心认知**：
1. **为什么打字机不会闪烁**：截断发生在 AST 层面（`displayNode`），不是文本层面。Markdown 语法结构始终完整。
2. **为什么必须传全量 blocks**：transformer 的 `push()` 会按传入的 id 集合过滤内部的 `completedBlocks`。只传增量会导致之前已完成的 block 被移除。
3. **为什么 reset 不重置 transformer**：transformer 持有最终 display blocks，重置会 emit 空数组导致已显示内容消失。

---

**3.2 [useAgentChat.ts](apps/web/src/modules/chat/composables/useAgentChat.ts)** — 核心流式逻辑（约 311 行）

这是整个管线的指挥中心。按方法阅读：

**`parseSSELine()`（38-53 行）**
- 检查 `data: ` 前缀 → 处理 `[DONE]` 标记 → JSON.parse → 检查 `type` 字段

**`sendMessage()`（58-286 行）**— 核心方法，分阶段阅读：

| 阶段 | 行号 | 做了什么 |
|------|------|----------|
| 防重入 | 59-62 | 如果已有流进行中，先 abort |
| 确保会话 | 64-67 | 无当前会话则自动创建 |
| 构建请求 | 71-80 | 组装 `StreamChatRequest`（sessionId/chatMode/message/model/selectedKbIds 等） |
| 乐观 UI | 82-108 | 创建用户消息 + AI 占位消息（状态 `streaming`），立即显示在界面 |
| 重置状态 | 112-113 | `resetAgentState()` + `setSending(true)` |
| 初始化 Markdown | 124-142 | 创建 `useStreamingMarkdown` 实例，注册 `onBlocks`/`onComplete`/`onError` |
| HTTP 请求 | 147 | `fetchChatStream(request, signal)` → `Response` |
| 流读取 | 153-166 | `ReadableStream.getReader()` + `TextDecoder` + buffer 管理 |
| SSE 事件循环 | 171-258 | 按行解析 → `parseSSELine()` → switch-case 分发到 store |

**SSE 事件 → Store 映射表（178-257 行）：**

| 事件 | Store 操作 | UI 效果 |
|------|-----------|---------|
| `RUN_STARTED` | `setRunStarted(runId)` | 记录 runId |
| `RUN_FINISHED` | `setRunFinished()` + 快照 steps/toolCalls 到消息 | 步骤面板数据持久化 |
| `RUN_ERROR` | `setMessageStatus(error)` | 显示"生成失败" |
| `STEP_STARTED` | `upsertStep({ status: 'running' })` | Agent 面板添加步骤条目 |
| `STEP_FINISHED` | `upsertStep({ status: 'completed', ... })` | 步骤标记完成 |
| `TOOL_CALL_START` | `upsertToolCall({ status: 'running' })` | Agent 面板添加工具条目 |
| `TOOL_CALL_RESULT` | `upsertToolCall({ status: 'completed', ... })` | 工具标记完成 |
| `TEXT_MESSAGE_CONTENT` | `pushDelta(delta)` | **文本进入打字机管道** |
| `TEXT_MESSAGE_END` | `flush()` | 完成解析 |
| `VALIDATION_STARTED` | `setMessageStatus('validating')` | 显示校验指示器 |
| `VALIDATION_COMPLETED` | `setMessageStatus('completed')` | 显示已校验标识 |

**错误处理（270-278 行）**：
- `AbortError` → 状态设为 `'aborted'`
- 其他错误 → 状态设为 `'error'`

**清理（279-285 行）**：
- `resetMarkdown()` — 仅重置 parser（不重置 transformer）
- `setSending(false)` / `isStreaming = false`

---

**3.3 [chat.ts (API 层)](apps/web/src/api/chat.ts)** — HTTP 请求层（约 142 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 129-141 | `fetchChatStream` | 调用 `apiRequestStream`（底层 fetch 封装），返回原始 `Response`（含 `body: ReadableStream`） |

---

## 第 4 步：组件渲染层（理解"数据怎么变成界面"）

**目的**：理解 Vue 组件树的数据流向和条件渲染逻辑。

### 组件树全景

```
ChatView.vue
  ├── ChatTopNavBar.vue
  ├── ChatStatusBanner.vue          (agentWarnings 不为空时显示)
  ├── ChatStream.vue                (消息列表 + 自动滚动)
  │   ├── UserMessageItem.vue       (role === 'user')
  │   └── AIMessageItem.vue         (role === 'ai') ★ 核心组件
  │       ├── ChatAgentPanel.vue    (思考过程面板)
  │       ├── MarkdownRenderer.vue  (AST 块渲染)
  │       │   ├── InlineRenderer.vue (递归内联节点)
  │       │   └── CodeBlock.vue     (Shiki 代码高亮)
  │       ├── 状态指示器 (validating/supplementing/verified/error/aborted)
  │       └── 操作栏 (复制/重试)
  ├── ChatCitationPanel.vue         (引用来源)
  └── ChatInputArea.vue
      ├── ChatModeToggle.vue
      ├── ChatKbSelector.vue
      └── ChatModelSelector.vue
```

### 阅读顺序

**4.1 [ChatView.vue](apps/web/src/views/chat/ChatView.vue)** — 页面入口（约 134 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 15 | `useAgentChat()` | 解构出 `sendMessage` / `abort` / `isStreaming` |
| 22-63 | `onMounted` | 加载知识库列表 + 模型列表（系统模型 + 用户模型合并） |
| 66-70 | `handleSendMessage` | 保存最后一条用户消息到 store，调用 `sendMessage()` |
| 78-96 | `handleRetry` | 找到最近用户消息 → 删除失败消息之后的所有消息 → 重新发送 |
| 111 | 模板绑定 | `:messages="chatStore.messages"` + `:is-agent-working="isStreaming"` |

**核心认知**：`ChatView` 只做编排，不处理渲染细节。数据通过 props 向下传递，事件通过 emits 向上冒泡。

---

**4.2 [ChatStream.vue](apps/web/src/components/chat/ChatStream.vue)** — 消息列表容器（约 108 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 19-33 | `isNearBottom()` + `scrollToBottom()` | 滚动锚定逻辑：距底部 < 200px 时才自动滚动，否则不打扰用户回看 |
| 36-39 | `watch` 滚动触发 | 监听三个值：`messages.length`、`isAgentWorking`、`messages.at(-1)?.content?.length` |
| 55-69 | 消息遍历 | 按 `role` 分发到 `UserMessageItem` 或 `AIMessageItem` |

**核心认知**：滚动逻辑的关键是第三个 watch 依赖 — `messages.at(-1)?.content?.length`。流式渲染时 `blocks` 数组不断替换但长度可能不变，需要监听内容长度变化来持续触发滚动。

---

**4.3 [AIMessageItem.vue](apps/web/src/components/chat/AIMessageItem.vue)** — AI 消息渲染状态机（约 217 行）

这是最复杂的展示组件。**按模板渲染分支阅读**：

| 行号 | 条件 | 渲染内容 |
|------|------|----------|
| 24-28 | `isStreaming` 计算属性 | 三种流式状态：`streaming \|\| validating \|\| supplementing` |
| 77-85 | `!hasContent && isStreaming && isRagMode` | Agent 阶段标签 + 脉冲动画（如"路由分析"、"检索中"） |
| 88-94 | `!hasContent && isStreaming` (普通模式) | "思考中..." + 脉冲光标 |
| 98-102 | 始终渲染 | `ChatAgentPanel` — 独立组件，传入已快照的 steps/toolCalls |
| 107-109 | `message.blocks?.length` | **新版路径**：`MarkdownRenderer` 渲染 AST 块 |
| 111-115 | 无 blocks 降级 | **旧版兼容**：`v-html` 渲染 `htmlContent \|\| fallbackHtml \|\| content` |
| 116-120 | `isStreaming` | 打字机脉冲光标 |
| 124-130 | `isStreaming && hasContent && isRagMode` | 琥珀色校验指示器 |
| 133-139 | 完成 + RAG 模式 | 绿色"已校验"标识 |
| 142 | `isAborted` | "请求已取消" |
| 145 | `isError` | "生成失败，请重试" |
| 148-154 | 完成 + 有引用 | 引用脚注（参考 N 条知识库内容） |
| 157-177 | `!isStreaming` | 操作栏（复制 + 重试按钮） |

**45-53 行的 `fallbackHtml`**：历史消息可能只有 `content`（Markdown 原始文本），没有 `blocks`。此时用 `marked.parse()` 将 Markdown 转 HTML 作为降级渲染。

---

**4.4 [ChatAgentPanel.vue](apps/web/src/components/chat/ChatAgentPanel.vue)** — 思考过程面板（约 227 行）

**设计原理（2-6 行注释）**：独立组件，避免受父组件高频重渲染影响。`AIMessageItem` 因 `msg.blocks` 每 25ms 替换一次（打字机效果），但 `ChatAgentPanel` 的 props（`messageSteps` / `messageToolCalls`）变化频率低，Vue 的 props 浅比较会跳过无变化的子树。

| 行号 | 内容 | 要点 |
|------|------|------|
| 30-40 | `displaySteps` / `displayToolCalls` | **数据源优先级**：消息快照 > store 实时值。流结束后走快照，流式中走 store |
| 46-53 | `timeline` 计算属性 | 将步骤+工具调用合并为统一数组，按 `order` 排序 |
| 55-71 | `stepMeta` | 步骤名 → 图标 + 中文标签 |
| 73-79 | `toolMeta` | 工具名 → 图标 + 中文标签 |
| 81-118 | `stepOutputSummary` / `toolOutputSummary` | 每种步骤/工具的智能摘要（如审计显示"充分/不足"，事实审核显示风险等级） |
| 190-195 | 查询折叠 | 知识库检索的查询列表可点击展开/收起 |

---

**4.5 [MarkdownRenderer.vue](apps/web/src/components/chat/MarkdownRenderer.vue)** — AST 块渲染器（约 147 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 13-18 | `normalizedBlocks` | **关键映射**：`displayNode ?? node`。`displayNode` 是打字机截断后的 AST，有则用它，无则用原始 `node` |
| 25-29 | heading | 动态 `:is="h1...h6"` |
| 33-36 | code | 委托给 `CodeBlock` |
| 40-42 | paragraph | 委托给 `InlineRenderer` |
| 45-86 | list | 支持有序/无序、嵌套列表（递归渲染子 list） |
| 88-98 | blockquote | 渲染引用块内的段落和内联内容 |
| 100-101 | thematicBreak | `<hr>` |
| 104-128 | table | thead + tbody 结构 |
| 131-134 | html | `v-html`（Incremark 已做 XSS 过滤） |
| 137-144 | fallback | 未知类型：有 children 则递归 InlineRenderer，否则显示 value |

---

**4.6 [InlineRenderer.vue](apps/web/src/components/chat/InlineRenderer.vue)** — 内联节点递归渲染（约 58 行）

支持的节点类型：`text` / `strong` / `emphasis` / `delete` / `inlineCode` / `link` / `image` / `break` / `html`

**核心认知**：这是**递归组件**。`strong`、`emphasis`、`delete`、`link` 内部都可能嵌套其他内联节点（比如 `**bold _italic_ text**`），所以内部再次使用 `<InlineRenderer>`。

---

**4.7 [CodeBlock.vue](apps/web/src/components/chat/CodeBlock.vue)** — Shiki 代码高亮（约 48 行）

| 行号 | 内容 | 要点 |
|------|------|------|
| 14-17 | 异步获取高亮器 | 懒加载单例，避免阻塞首屏 |
| 26-39 | `highlight()` | `highlighter.codeToHtml(code, { lang, theme: 'github-dark' })`，失败则回退纯文本 |
| 42 | watch props | lang 或 value 变化时重新高亮 |

---

## 完整时序图

```
用户点击发送
│
├─ ChatView.handleSendMessage(message)
│   ├─ chatStore.setLastUserMessage(message)
│   └─ useAgentChat.sendMessage(message)
│
├─ sendMessage() 内部
│   ├─ [乐观UI] 创建用户消息 + AI占位消息
│   │   → ChatStream 立即显示用户气泡 + "思考中..."
│   │
│   ├─ chatStore.resetAgentState()
│   │
│   ├─ useStreamingMarkdown() 初始化
│   │   ├─ createIncremarkParser({ gfm: true })
│   │   └─ createBlockTransformer({ charsPerTick: [1,3], ... })
│   │
│   ├─ fetchChatStream(request, signal) → POST /api/chat/stream
│   │
│   └─ while(true) read SSE lines
│       │
│       ├─ RUN_STARTED       → setRunStarted()
│       ├─ STEP_STARTED      → upsertStep(running)
│       │                       → ChatAgentPanel 显示步骤
│       ├─ STEP_FINISHED     → upsertStep(completed)
│       ├─ TOOL_CALL_START   → upsertToolCall(running)
│       │                       → ChatAgentPanel 显示工具
│       ├─ TOOL_CALL_RESULT  → upsertToolCall(completed)
│       ├─ TEXT_MESSAGE_CONTENT → pushDelta(delta)
│       │   │                    → parser.append() → AST 块
│       │   │                    → transformer.push(allBlocks)
│       │   │                    → onChange → store.appendMessageBlocks
│       │   │                    → MarkdownRenderer 渲染（每 25ms 更新）
│       │   │
│       │   └─ [重复 N 次，逐字打字]
│       │
│       ├─ TEXT_MESSAGE_END  → flush()
│       ├─ VALIDATION_STARTED → setMessageStatus('validating')
│       │                       → 琥珀色"正在校验..."指示器
│       ├─ VALIDATION_COMPLETED → setMessageStatus('completed')
│       │                         → 绿色"已校验"标识
│       └─ RUN_FINISHED
│           ├─ setRunFinished()
│           └─ 快照 aguiSteps/aguiToolCalls 到消息对象
│
└─ finally
    ├─ resetMarkdown()  // 仅 parser
    └─ setSending(false)
```

---

## 关键文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| [types/stream.ts](apps/web/src/modules/chat/types/stream.ts) | 195 | AG-UI 事件类型定义 |
| [types/chat.ts](apps/web/src/modules/chat/types/chat.ts) | 107 | 消息/会话/请求类型定义 |
| [stores/chat-session.ts](apps/web/src/stores/chat-session.ts) | 180 | 会话+消息 CRUD store |
| [stores/chat-agent.ts](apps/web/src/stores/chat-agent.ts) | 184 | Agent 运行时状态 store |
| [stores/chat.ts](apps/web/src/stores/chat.ts) | 289 | 统一入口 store（Facade） |
| [composables/useStreamingMarkdown.ts](apps/web/src/modules/chat/composables/useStreamingMarkdown.ts) | 201 | Incremark 打字机效果 |
| [composables/useAgentChat.ts](apps/web/src/modules/chat/composables/useAgentChat.ts) | 311 | 核心流式对话逻辑 |
| [api/chat.ts](apps/web/src/api/chat.ts) | 142 | 聊天 API 层 |
| [views/chat/ChatView.vue](apps/web/src/views/chat/ChatView.vue) | 134 | 页面入口，编排 |
| [components/chat/ChatStream.vue](apps/web/src/components/chat/ChatStream.vue) | 108 | 消息列表+自动滚动 |
| [components/chat/AIMessageItem.vue](apps/web/src/components/chat/AIMessageItem.vue) | 217 | AI 消息状态机 |
| [components/chat/ChatAgentPanel.vue](apps/web/src/components/chat/ChatAgentPanel.vue) | 227 | 思考过程面板 |
| [components/chat/MarkdownRenderer.vue](apps/web/src/components/chat/MarkdownRenderer.vue) | 147 | AST 块级渲染器 |
| [components/chat/InlineRenderer.vue](apps/web/src/components/chat/InlineRenderer.vue) | 58 | 内联节点递归渲染 |
| [components/chat/CodeBlock.vue](apps/web/src/components/chat/CodeBlock.vue) | 48 | Shiki 代码高亮 |

---

## 延伸阅读

- [Incremark 文档](https://github.com/nicepkg/incremark) — 增量 Markdown 解析器
- [AG-UI 协议](https://docs.ag-ui.com/sdk/js/core/events) — Agent-GUI SSE 事件标准
- [Shiki](https://shiki.style/) — 代码语法高亮库
- [`.claude/rules/frontend-refactoring.md`](.claude/rules/frontend-refactoring.md) — 重构事故总结与安全规则
