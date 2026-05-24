# Incremark AST → Vue 组件树 流式渲染设计

> 设计日期：2026-05-09 | 状态：待审批
> 基于：[业界调研](../06-优化/前端优化/05-业界调研-流式渲染方案.md)
> 替换方案：[实施计划-流式渲染优化](../06-优化/前端优化/04-实施计划-流式渲染优化.md) 中的 marked + buffer 切片方案

---

## 一、目标

将流式 Markdown 渲染从"marked 全量解析 → HTML 字符串 → v-html"改造为"Incremark 增量解析 → mdast AST → Vue 组件树"。

### 核心收益

| 维度 | 现状 | 目标 |
|------|------|------|
| 解析 | 手写 buffer 状态机 (~150 行) + marked 解析 | Incremark 真增量 O(n)，删除所有手写状态机 |
| 渲染 | HTML 字符串 → v-html | AST → Vue 组件树（按 block 增量更新） |
| 安全 | v-html（XSS 风险） | Vue 文本插值（代码块除外，Shiki 输出可信） |
| 代码高亮 | 正则提取 ``` 围栏 → Shiki | 直接消费 AST node.lang + node.value |
| 扩展性 | 无（HTML 字符串不可操作） | 强（自定义组件/插件按 node.type 分发） |

### 不做的事（延后）

- BlockTransformer 打字机动画（先让 blocks 直接完整渲染）
- shiki-stream 流式高亮（代码块仍等闭合后一次性高亮）
- 暗色/亮色主题自适应（当前 `github-dark` 硬编码）

---

## 二、架构

### 2.1 数据流

```
SSE delta
  → useAgentChat 提取 TEXT_MESSAGE_CONTENT.delta
  → useStreamingMarkdown.pushDelta(delta)
      → Incremark parser.append(delta)
      → IncrementalUpdate { completed, updated, pending }
      → completed/updated blocks 传给 onBlocks 回调
  → chatStore.appendMessageBlocks(messageId, blocks)
  → AIMessageItem.vue 读取 message.blocks
  → MarkdownRenderer.vue 渲染 AST → 页面 DOM
```

### 2.2 buffer 职责转移

当前 `useStreamingMarkdown` 负责：buffer 累积、代码块状态机、内联语法配对检查、句子边界检测、flush 时机判定。

改为 Incremark 内部负责。`useStreamingMarkdown` 只做：`parser.append()` → 取 completed blocks → 回调。

### 2.3 组件树

```
MarkdownRenderer.vue          — 块级分发 (heading/code/paragraph/list/table...)
  ├─ InlineRenderer.vue       — 行内递归 (text/strong/emphasis/link/image...)
  └─ CodeBlock.vue            — 代码高亮 (Shiki)
```

---

## 三、文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/chat/composables/useStreamingMarkdown.ts` | **重写** | 删除 buffer/状态机，改用 Incremark，接口 `onFlush(html)` → `onBlocks(blocks)` |
| `src/components/chat/MarkdownRenderer.vue` | **新建** | 块级递归组件，AST node.type → Vue 组件分发 |
| `src/components/chat/InlineRenderer.vue` | **新建** | 行内元素递归渲染 |
| `src/components/chat/CodeBlock.vue` | **新建** | Shiki 代码高亮组件 |
| `src/stores/chat.ts` | **修改** | 新增 `appendMessageBlocks()` 方法 |
| `src/components/chat/AIMessageItem.vue` | **修改** | `v-html` → `<MarkdownRenderer :blocks="message.blocks">` |
| `src/modules/chat/composables/useAgentChat.ts` | **微调** | `onFlush` → `onBlocks` 适配 |
| `src/modules/chat/types/chat.ts` | **修改** | ChatMessageItem 新增 `blocks?: ParsedBlock[]` |

### 不新建/不删除

- `src/modules/chat/utils/shiki.ts` — 保持不变，CodeBlock 继续使用
- `package.json` — 依赖已预装（`@incremark/core`, `shiki`, `marked` 保留）
- `marked` — 作为 Incremark 内部引擎依赖，不直接使用

---

## 四、核心接口设计

### 4.1 useStreamingMarkdown（重写后）

```typescript
// 输入
interface StreamingMarkdownOptions {
  onBlocks: (blocks: ParsedBlock[]) => void  // 替代 onFlush(html)
  onComplete?: () => void
  onError?: (error: Error) => void
}

// 输出
{
  pushDelta: (delta: string) => void
  flush: () => Promise<void>
  reset: () => void
}
```

内部实现（伪代码）：
```typescript
const parser = createIncremarkParser({ gfm: true })

function pushDelta(delta: string) {
  const update = parser.append(delta)
  const blocks = [...update.completed, ...update.updated]
  if (blocks.length > 0) onBlocks(blocks)
}

async function flush() {
  const update = parser.finalize()
  const blocks = [...update.completed, ...update.pending]
  if (blocks.length > 0) onBlocks(blocks)
  onComplete?.()
}

function reset() { parser.reset() }
```

### 4.2 chatStore 新增

```typescript
function appendMessageBlocks(messageId: number, blocks: ParsedBlock[]) {
  const msg = messages.value.find(m => m.id === messageId)
  if (!msg) return
  if (!msg.blocks) msg.blocks = []
  msg.blocks.push(...blocks)
}
```

### 4.3 MarkdownRenderer.vue

```
Props: { blocks: ParsedBlock[] }

对每个 block，按 block.node.type 分发：
  heading     → <h1>~<h6> + <InlineRenderer>
  paragraph   → <p> + <InlineRenderer>
  code        → <CodeBlock :lang :value>
  list        → <ul>/<ol> + 递归 <li>
  blockquote  → <blockquote> + <InlineRenderer>
  table       → <table> (prose 兼容)
  thematicBreak → <hr>
  html        → <div v-html>（Incremark 已做 XSS 过滤）
```

### 4.4 InlineRenderer.vue

```
Props: { children: RootContent[] }

递归处理每个 child，按 type 分发：
  text       → 纯文本
  strong     → <strong>
  emphasis   → <em>
  delete     → <del>
  inlineCode → <code>
  link       → <a>
  image      → <img>
  html       → <span v-html>
```

### 4.5 CodeBlock.vue

```
Props: { lang: string, value: string }

watch [lang, value] → getHighlighter().codeToHtml(value, { lang, theme })
fallback: <pre><code> 纯文本
v-html 仅用于 Shiki 输出的受信 HTML
```

---

## 五、样式策略

Tailwind Typography `prose prose-invert` 通过标准 HTML 标签选择器工作。Vue 组件输出的标签与 marked 生成的完全一致（`<h1>`, `<p>`, `<ul>`, `<blockquote>` 等），prose 样式零改动生效。

CodeBlock 的 Shiki 输出自带内联样式，不受 prose 影响。

---

## 六、边界情况

| 场景 | 处理 |
|------|------|
| 空 paragraph | 跳过，不渲染 |
| HTML 节点 | Incremark 内置 XSS 黑名单过滤（script/iframe 移除），通过后 v-html |
| 未闭合 code block | flush 时 `parser.finalize()` 自动处理，标记为 completed |
| 嵌套内联深度 | InlineRenderer 递归，实际不超过 5 层 |
| 语言未注册 | Shiki fallback 到 `lang: 'text'` |
| 中止流式 | `reset()` 清空 parser，不渲染残留 pending |
| 历史消息 | 消息对象存 `blocks: ParsedBlock[]`，直接 `<MarkdownRenderer :blocks="msg.blocks">` |
| 未知 AST type | 兜底 `<div>` + 递归 children |

---

## 七、错误处理

```
Incremark parse 异常 → try/catch → onError → 聊天框 "渲染失败"
Shiki 高亮异常     → try/catch → fallback <pre><code> 纯文本
未知 AST node type  → 兜底渲染 <div> + 递归 children
```

---

## 八、类型影响

`ChatMessageItem` 新增可选字段：
```typescript
interface ChatMessageItem {
  // ... existing fields
  blocks?: ParsedBlock[]  // 流式/历史消息的结构化 AST 块
}
```

`ParsedBlock` 由 `@incremark/core` 导出，无需自定义。

---

## 九、回退方案

```bash
# 恢复 useStreamingMarkdown 的 marked + buffer 切片方案
git checkout HEAD~1 -- apps/web/src/modules/chat/composables/useStreamingMarkdown.ts
git checkout HEAD~1 -- apps/web/src/modules/chat/composables/useAgentChat.ts
git checkout HEAD~1 -- apps/web/src/stores/chat.ts
git checkout HEAD~1 -- apps/web/src/components/chat/AIMessageItem.vue
git checkout HEAD~1 -- apps/web/src/modules/chat/types/chat.ts
rm apps/web/src/components/chat/MarkdownRenderer.vue
rm apps/web/src/components/chat/InlineRenderer.vue
rm apps/web/src/components/chat/CodeBlock.vue
```

回退范围局限在 chat 模块，不影响知识库、文档、认证等其他模块。

---

## 十、验收标准

| 检查项 | 验证方式 |
|--------|---------|
| TypeScript 类型检查通过 | `vue-tsc -b` 0 errors |
| Vite 构建成功 | `vite build` 无错误 |
| 流式对话文字正常渲染 | 启动后端，发送消息，文本逐段出现 |
| 代码块高亮正确 | ts/js/python/json/shell 代码块高亮正常 |
| 内联格式正确 | 粗体/斜体/删除线/行内代码/链接正确渲染 |
| 列表/表格/引用 | 有序/无序列表、表格、引用块正确渲染 |
| 中止/重发不崩溃 | 流式中点击中止，重新发送正常 |
| 历史消息回显 | 切换到历史会话，消息正常显示 |
| 暗色主题样式 | prose-invert 暗色样式正常 |

---

## 十一、参考

- [业界调研-流式渲染方案](../06-优化/前端优化/05-业界调研-流式渲染方案.md)
- [Incremark 官方文档](https://www.incremark.com/)
- [mdast 规范](https://github.com/syntax-tree/mdast)
- [Chrome — Render streamed LLM responses](https://developer.chrome.com/docs/ai/render-llm-responses)
