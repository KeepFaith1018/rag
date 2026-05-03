# Chat Module 前端实现缺口分析

**日期**: 2026-04-28
**状态**: ✅ 已完成
**方案升级**: 新增流式 Markdown 增量渲染方案

---

## 1. 概述

后端已完整实现所有功能（流式对话、Agent 编排、限流、Trace API）。前端对话模块**已完成集成**。实施方案中提到的所有文件均已实现完毕。

---

## 2. 文件状态

### 2.1 已实现文件 ✅

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/api/chat.ts` | ✅ 完整 | 完整的 API 层，包含会话 CRUD、知识库列表、模型配置、流式请求 |
| `src/stores/chat.ts` | ✅ 完整 | 完整的 Pinia Store，包含会话管理、Agent 状态、引用、警告、检索进度 |
| `src/modules/chat/types/chat.ts` | ✅ 完整 | 所有类型定义，新增 `htmlContent` 字段 |
| `src/modules/chat/types/stream.ts` | ✅ 完整 | AI SDK 流协议类型、解析工具 |
| `src/modules/chat/composables/useStreamingMarkdown.ts` | ✅ 完整 | 流式 Markdown 增量渲染 composable，块级 flush |
| `src/modules/chat/composables/useAgentChat.ts` | ✅ 完整 | 核心流式对话逻辑，集成 Markdown 渲染 |
| `src/components/chat/MessageBubble.vue` | ✅ 完整 | 渲染消息气泡，支持 HTML 内容渲染 |
| `src/components/chat/ChatStream.vue` | ✅ 完整 | 消息流组件，支持 `htmlContent` 流式渲染，自动滚动 |
| `src/components/chat/ChatInputArea.vue` | ✅ 完整 | 输入区域，集成模式切换、知识库选择、模型选择 |
| `src/components/chat/ChatKbSelector.vue` | ✅ 完整 | 知识库多选组件，RAG 模式下显示 |
| `src/components/chat/ChatModeToggle.vue` | ✅ 完整 | Chat/RAG 模式切换 |
| `src/components/chat/ChatModelSelector.vue` | ✅ 完整 | 模型选择下拉框 |
| `src/components/chat/ChatAgentTimeline.vue` | ✅ 完整 | Agent 执行阶段时间线 |
| `src/components/chat/ChatCitationPanel.vue` | ✅ 完整 | 引用来源展示面板 |
| `src/components/chat/ChatStatusBanner.vue` | ✅ 完整 | Agent 警告横幅 |
| `src/views/chat/ChatView.vue` | ✅ 完整 | 主视图，集成所有组件，store 驱动 |

### 2.2 新增依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `marked` | `^18.0.2` | Markdown 解析 |
| `highlight.js` | `^11.11.1` | 代码语法高亮 |

---

## 3. 流式 Markdown 渲染方案

### 3.1 技术选型说明

用户提及 `streamdown` / `@streamdown/code` 作为参考。经验证：

| 包名 | 技术栈 | 结论 |
|------|--------|------|
| `streamdown` | **React** (peerDep: React 18/19) | ❌ 不可用 |
| `@streamdown/code` | **React** (peerDep: React 18/19) | ❌ 不可用 |

**选型决策**: 自主实现 Vue 3 兼容的流式 Markdown 渲染器，参考 streamdown 的分块 flush 思路。

### 3.2 `useStreamingMarkdown.ts` 实现

**策略**: 逐 token 接收文本增量，块级 flush，通过 innerHTML 追加实现流畅渲染。

**核心逻辑**:
1. 维护 `buffer` 字符串，接收每次文本增量
2. 每次增量后检测是否形成完整的 Markdown 块（代码块、列表项、引用块、段落）
3. 将完整块通过 `marked.parse()` 转为 HTML 并 flush 输出
4. 剩余未完成部分保留在 buffer 中等待下一次增量

**flush 触发条件**:
- 遇到完整的代码块（``` 闭合）
- 遇到空行（段落结束）
- buffer 超过 200 字符且遇到标点/空白（强制 flush）

### 3.3 `useAgentChat.ts` 集成

`useAgentChat` 处理流事件时，文本增量通过 `pushDelta` 传入 Markdown 渲染器：

```
AI SDK Stream → parseStreamLine() → pushDelta() → useStreamingMarkdown → onFlush(html) → store.updateAssistantMessageHtml()
```

---

## 4. Store 扩展

新增以下状态和方法：

```typescript
// 新增状态
retrievalProgresses: Ref<RetrievalProgressPart[]>

// 新增方法
updateAssistantMessageHtml(messageId, html, mode: 'append' | 'replace')
setMessageStatus(messageId, status)
addRetrievalProgress(progress)
```

---

## 5. ChatView.vue 架构

```
ChatView.vue
├── TopNavBar
├── ChatStatusBanner          ← 警告横幅
├── ChatAgentTimeline        ← Agent 阶段时间线
├── ChatStream               ← 消息流（自动滚动）
│   └── MessageBubble        ← 消息气泡
├── ChatCitationPanel        ← 引用面板（侧边）
└── ChatInputArea
    ├── ChatModeToggle       ← 模式切换
    ├── ChatKbSelector       ← 知识库选择
    └── ChatModelSelector    ← 模型选择
```

**数据流**:
```
用户输入 → ChatInputArea.emit('send')
→ ChatView.handleSendMessage()
→ useAgentChat.sendMessage()
→ fetchChatStream() → ReadableStream
→ parseStreamLine() → pushDelta()
→ onFlush(html) → store.updateAssistantMessageHtml()
→ ChatStream 自动滚动渲染
```

---

## 6. 构建状态

- ✅ TypeScript 类型检查通过
- ✅ Vite 构建成功

---

## 7. 后端 API 补充

### 7.1 新增端点

| 方法 | 路径 | 实现文件 | 说明 |
|------|------|----------|------|
| GET | `/api/knowledge-base/members/my-kbs` | `chat/chat-kb.controller.ts` | 获取当前用户可用的知识库列表 |
| GET | `/api/ai/model-configs` | `ai/ai.controller.ts` | 获取当前用户可用的模型配置列表 |

### 7.2 详细说明

**`GET /api/knowledge-base/members/my-kbs`**

返回当前用户拥有 `canAsk` 权限的知识库列表（owner / manager / collaborator / member / publicVisitor）。

响应格式：
```json
[
  { "kbId": "xxx", "kbName": "知识库A", "permission": "owner" },
  { "kbId": "yyy", "kbName": "知识库B", "permission": "collaborator" }
]
```

**`GET /api/ai/model-configs`**

返回当前用户可用的模型配置列表。首版返回系统默认模型。

响应格式：
```json
[
  { "configId": "system-default", "modelName": "gpt-4o-mini", "provider": "system", "source": "system" }
]
```

---

## 8. 参考文档

| 文档 | 用途 |
|------|------|
| `docs/14-agentic-rag-implementation-summary-2026-04-28.md` | 总体实施总结 |
| `apps/backend/docs/chat-module-phase1-implementation-record-2026-04-27.md` | 后端阶段一（会话/消息） |
| `apps/backend/docs/chat-module-phase2-implementation-record-2026-04-28.md` | 后端阶段二（检索链路） |
| `apps/backend/docs/chat-module-phase3-implementation-record-2026-04-28.md` | 后端阶段三（Agent 工作流） |
| `apps/backend/docs/chat-module-phase5-implementation-record-2026-04-28.md` | 后端阶段五（限流/Trace） |
| `docs/12-agentic-rag-detailed-design-2026-04-27.md` | 详细设计参考 |
