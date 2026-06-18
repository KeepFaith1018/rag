# 2026-05-24 前端整体优化记录

## 概述

对 `apps/web/` 进行全面审计（55 个源文件 + 依赖配置），实施构建层、架构层、性能层、稳定性层四类优化。提交 `3ade54c`。

## 一、构建与依赖

### 移除 8 个冗余依赖

| 包 | 原因 |
|---|---|
| `entities`、`shiki-stream`、`tailwind-merge`、`clsx` | 0 次 import |
| `@fontsource/inter`、`@fontsource/space-grotesk` | 使用本地 WOFF2 字体 |
| `autoprefixer` (devDep) | Tailwind v4 内置 Lightning CSS |

### 删除死文件

- `tailwind.config.js` — v3 语法，Tailwind v4 使用 CSS `@theme` 配置

### Vite 构建代码分割

新增 `manualChunks`，分离 Shiki（886KB gzip 147KB）、Vue 核心（117KB gzip 45KB）、Markdown（115KB gzip 33KB）为独立 chunk。Shiki 仅在含代码块的页面按需加载，首屏 JS 减少约 60%。

### 字体预加载

`index.html` 添加 Inter 400/500 字重 preload 提示，消除字体发现的双轮往返延迟。

### TypeScript 严格模式

`tsconfig.app.json` 启用 `"strict": true`，补齐 `noUncheckedIndexedAccess`。

## 二、架构层

### Chat Store 拆分

原 `stores/chat.ts`（720 行）拆为 3 个 domain store：

| Store | 文件 | 职责 |
|-------|------|------|
| `useChatConfigStore` | `chat-config.ts` (~110行) | chatMode、selectedModel、selectedKbIds、enableWebSearch |
| `useChatSessionStore` | `chat-session.ts` (~170行) | sessions、messages CRUD、分页 |
| `useChatAgentStore` | `chat-agent.ts` (~160行) | agentPhase、aguiSteps、aguiToolCalls、citations、warnings |

原 `useChatStore` 通过 `storeToRefs()` 组合三个 store，保持 API 兼容。所有 14 个消费者无需修改 import。

### KbDetailView 拆分

原 1658 行单文件拆为 4 个组件：

| 组件 | 行数 | 职责 |
|------|------|------|
| `KbDetailView.vue` | ~430 | 顶层编排器 |
| `KbDocumentPanel.vue` | ~130 | 上传区域 + 文档列表 |
| `KbMemberPanel.vue` | ~80 | 成员列表 + 邀请码 |
| `KbSettingsPanel.vue` | ~60 | 设置表单 |

子组件采用纯 Props/Events 模式，业务逻辑统一由 KbDetailView 管理。

### 共享基础设施

| 文件 | 内容 |
|------|------|
| `src/config/constants.ts` | KB 名称上限、分片大小、并发数、SSE 重连上限等 |
| `src/utils/format.ts` | `formatFileSize`、`formatDateTime` |
| `src/utils/error.ts` | `resolveErrorMessage` |
| `src/modules/chat/constants/steps.ts` | step 元数据（label/icon/outputSummary），消除 3 处重复实现 |

## 三、性能层

### ChatStream 滚动重排修复（P0）

移除 `MutationObserver`（每 token 触发一次 layout reflow），改为单个 `watch` + `requestAnimationFrame` + 滚动锚定。用户手动上滚时停止自动滚动。

### SSE 流中断

`useAgentChat` 添加 `onUnmounted(() => abort())`，导航离开对话页时自动中断流，避免后台资源泄漏。

### KbDetailView double-load 修复

移除 `onMounted(() => loadPage())`，因 `watch(kbId, { immediate: true })` 已处理首次加载。

### 流式渲染正则优化

`useStreamingMarkdown` 的 `normalizeEmphasis()` 仅当 delta 包含 `*` 或 `~` 时才执行 6 次正则替换。

### API 层增强

- 所有 fetch 添加 30s 默认超时（`AbortSignal.timeout`）
- GET 请求去重：相同 url+params 复用 pending Promise

## 四、稳定性层

### 补充 AG-UI 事件类型

`AguiEvent` 联合类型新增 `VALIDATION_STARTED` / `VALIDATION_COMPLETED`，消除 TypeScript 类型覆盖率缺口。

### 统一错误展示

`ChatView.vue` 模型/KB 加载失败从 `console.error` 改为 `useMessage` toast 展示。

## 五、代码量变化

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| `stores/chat.ts` | 720 行 | ~250 行 |
| `views/kb/KbDetailView.vue` | 1658 行 | ~430 行 |
| 依赖数 | 14 + 8 dev | 9 + 7 dev |
| 构建 chunk (首屏 JS) | 单 vendor >1MB | 分 3 个 vendor chunk |
