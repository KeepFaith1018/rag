# Chat 模块阶段四实施记录

## 概述

按照《[12-agentic-rag-detailed-design-2026-04-27.md](../../docs/12-agentic-rag-detailed-design-2026-04-27.md)》中阶段四的规划，完成前端联调模块的搭建。实现了 `useAgentChat` composable 流式封装、Pinia chatStore 状态管理、以及 6 个 Vue 组件与设计稿的对齐。

## 完成清单

### 1. 安装依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@ai-sdk/vue` | 3.0.168 | Vue 3 AI SDK（但最终未直接使用其 Chat 类，而是作为类型参考） |

**说明**：AI SDK 6.x (`@ai-sdk/vue` 3.0) 的 `Chat` 类设计用于 OpenAI 兼容 API，与我们后端 `/api/chat/stream` 的自定义请求格式不兼容。因此最终采用原生 `fetch` + `ReadableStream` 自己解析 AI SDK data stream 协议。

### 2. 类型定义（2 个文件）

| 文件 | 内容 |
|------|------|
| `src/modules/chat/types/chat.ts` | 会话摘要、消息项、聊天模式、模型选项等业务类型 |
| `src/modules/chat/types/stream.ts` | 流式事件协议类型（AgentStatusPart、RetrievalProgressPart、CitationSnapshotPart、AgentWarningPart）、AI SDK data stream 解析工具函数 |

涉及文件：
- `src/modules/chat/types/chat.ts` — 新建
- `src/modules/chat/types/stream.ts` — 新建

### 3. API 层（1 个文件）

| 文件 | 用途 |
|------|------|
| `src/api/chat.ts` | 会话 CRUD、消息列表、流式聊天请求（fetchChatStream）|

涉及文件：
- `src/api/chat.ts` — 新建

### 4. Pinia Store（1 个文件）

| 文件 | 职责 |
|------|------|
| `src/stores/chat.ts` | 会话状态、消息列表、Agent 阶段、引用、警告等全局状态管理 |

**状态结构**：
- 会话相关：`sessions`、`currentSession`、`messages`
- 模式相关：`chatMode`、`selectedKbIds`、`availableKbs`、`selectedModel`、`availableModels`
- Agent 状态：`agentPhase`、`agentPhaseLabel`、`agentPhaseDetail`、`citations`、`agentWarnings`
- 加载状态：`isLoadingSessions`、`isLoadingMessages`、`isSending`

涉及文件：
- `src/stores/chat.ts` — 新建

### 5. Composable（1 个文件）

| 文件 | 职责 |
|------|------|
| `src/modules/chat/composables/useAgentChat.ts` | 流式聊天封装、协议解析、store 集成 |

**核心实现**：
- `parseStreamResponse()` — 解析 AI SDK data stream 协议（`0:` 文本块、`8:` data event、`d:` done）
- `sendMessage()` — 发送消息、乐观更新消息状态、解析流式响应
- `stop()` — 通过 AbortController 中断请求

**协议解析**：
- `agent-status` → `chatStore.setAgentPhase()`
- `retrieval-progress` → `console.debug`（可扩展）
- `citation-snapshot` → `chatStore.setCitations()`
- `agent-warning` → `chatStore.addWarning()`

涉及文件：
- `src/modules/chat/composables/useAgentChat.ts` — 新建

### 6. Vue 组件（6 个）

| 组件 | 用途 |
|------|------|
| `ChatKbSelector.vue` | 知识库多选器，仅 RAG 模式展示，支持全选/清空 |
| `ChatModelSelector.vue` | 模型选择下拉，支持系统模型/用户模型分组 |
| `ChatModeToggle.vue` | 聊天模式切换（对话/知识库问答） |
| `ChatAgentTimeline.vue` | Agent 工作流阶段时间线（planning→retrieving→reranking→verifying→writing→done）|
| `ChatCitationPanel.vue` | 引用列表，支持按知识库分组展示 |
| `ChatStatusBanner.vue` | Agent 警告横幅（LOW_CONFIDENCE、PARTIAL_ANSWER、WEB_SEARCH_CANDIDATE、INSUFFICIENT_CONTEXT）|

涉及文件：
- `src/components/chat/ChatKbSelector.vue` — 新建
- `src/components/chat/ChatModelSelector.vue` — 新建
- `src/components/chat/ChatModeToggle.vue` — 新建
- `src/components/chat/ChatAgentTimeline.vue` — 新建
- `src/components/chat/ChatCitationPanel.vue` — 新建
- `src/components/chat/ChatStatusBanner.vue` — 新建

## 前端目录结构

```
apps/frontend/src/
  api/
    chat.ts                      # Chat API
  modules/chat/
    types/
      chat.ts                    # 业务类型定义
      stream.ts                  # 流式协议类型定义
    composables/
      useAgentChat.ts            # 流式聊天 composable
  stores/
    chat.ts                      # Pinia Chat Store
  components/chat/
    ChatKbSelector.vue           # 知识库选择器
    ChatModelSelector.vue        # 模型选择器
    ChatModeToggle.vue           # 模式切换
    ChatAgentTimeline.vue       # Agent 工作流时间线
    ChatCitationPanel.vue        # 引用列表
    ChatStatusBanner.vue         # 警告横幅
```

## AI SDK Data Stream 协议解析

后端 `ChatStreamService` 使用 `@ai-sdk/langchain` 的 `toUIMessageStream()` 将 LangChain 流转换为 AI SDK data stream 格式，前端需要解析该格式：

| 行前缀 | 内容格式 | 解析方式 |
|--------|----------|----------|
| `0:` | JSON 字符串（文本块） | `JSON.parse()` 后取 `delta` 或直接作为字符串 |
| `8:` | JSON 对象（自定义 data part） | `JSON.parse()` 后根据 `type` 分发 |
| `d:` | JSON 对象（流结束） | `JSON.parse()` 后取 `reason` |

**自定义 data part 类型**（需与后端保持一致）：
- `agent-status`: `{ type, phase, label, detail }`
- `retrieval-progress`: `{ type, kbId, kbName, query, hitCount, channel }`
- `citation-snapshot`: `{ type, citations: [...] }`
- `agent-warning`: `{ type, code, message }`

## 与现有 ChatView 的集成

当前 `ChatView.vue` 使用的是静态模拟数据。阶段五（前端联调）需要：

1. 将 `ChatView.vue` 中的 `messages` ref 替换为 `useAgentChat().messages`
2. 将 `ChatInputArea.vue` 的 `sendMessage` 替换为 `useAgentChat().sendMessage()`
3. 在 `ChatView.vue` 中添加 `ChatKbSelector`、`ChatAgentTimeline`、`ChatCitationPanel`、`ChatStatusBanner` 组件
4. 初始化 `chatStore.loadSessions()` 和 `chatStore.setAvailableKbs()`

**集成示例**：
```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAgentChat } from '@/modules/chat/composables/useAgentChat';
import { listAvailableKbs } from '@/api/chat';
import ChatKbSelector from '@/components/chat/ChatKbSelector.vue';
import ChatAgentTimeline from '@/components/chat/ChatAgentTimeline.vue';
import ChatCitationPanel from '@/components/chat/ChatCitationPanel.vue';
import ChatStatusBanner from '@/components/chat/ChatStatusBanner.vue';

const chatStore = useChatStore();
const { messages, sendMessage, stop, isSending } = useAgentChat();

onMounted(async () => {
  await chatStore.loadSessions();
  const kbs = await listAvailableKbs();
  chatStore.setAvailableKbs(kbs);
});
</script>
```

## 关键设计决策

1. **不直接使用 `@ai-sdk/vue` 的 Chat 类**：AI SDK 6.x 的 Chat 类设计用于 OpenAI 兼容 API（发送 `{ role, content }` 格式），而后端 `/api/chat/stream` 期望 `{ sessionId, chatMode, message, ... }` 格式。创建自定义 transport 过于复杂，因此采用原生 fetch + ReadableStream。

2. **协议解析复用**：`parseStreamResponse()` 函数将 AI SDK data stream 协议行解析为语义化事件，与具体 UI 框架无关，便于后续抽取为独立工具函数。

3. **乐观更新**：用户发送消息时立即在 `messages` 数组中添加用户消息和助手占位消息，提供即时反馈。

4. **组件单一职责**：每个组件只负责一个功能（知识库选择、时间线、引用、警告），便于独立测试和复用。

## 后续阶段

参见《12-agentic-rag-detailed-design》的阶段五：

- 阶段五：治理与优化（trace 查询、限流、评估指标）
- 前端联调：将 useAgentChat 与 ChatView 集成
- 交互优化：中断生成、重新生成、消息编辑

## 涉及文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/chat/types/chat.ts` | 新建 | 业务类型定义 |
| `src/modules/chat/types/stream.ts` | 新建 | 流式协议类型定义 |
| `src/api/chat.ts` | 新建 | API 层 |
| `src/stores/chat.ts` | 新建 | Pinia Store |
| `src/modules/chat/composables/useAgentChat.ts` | 新建 | Composable |
| `src/components/chat/ChatKbSelector.vue` | 新建 | 知识库选择器 |
| `src/components/chat/ChatModelSelector.vue` | 新建 | 模型选择器 |
| `src/components/chat/ChatModeToggle.vue` | 新建 | 模式切换 |
| `src/components/chat/ChatAgentTimeline.vue` | 新建 | Agent 时间线 |
| `src/components/chat/ChatCitationPanel.vue` | 新建 | 引用列表 |
| `src/components/chat/ChatStatusBanner.vue` | 新建 | 警告横幅 |
| `apps/frontend/package.json` | 修改 | 新增 @ai-sdk/vue 依赖 |
