# Incremark AST → Vue 组件树 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将流式 Markdown 渲染从 marked + v-html 改造为 Incremark 增量解析 + AST → Vue 组件树

**Architecture:** Incremark 内部缓冲 delta → 输出 mdast AST blocks → Vue 组件递归渲染。`useStreamingMarkdown` 删除手写状态机，改为 `parser.append()` → `onBlocks(blocks)` 回调。新建 MarkdownRenderer/InlineRenderer/CodeBlock 三个 Vue 组件替换 `v-html`。

**Tech Stack:** Vue 3 + TypeScript, Incremark (@incremark/core), Shiki, mdast AST

---

### Task 1: ChatMessageItem 类型新增 blocks 字段

**Files:** Modify `apps/web/src/modules/chat/types/chat.ts`

- [ ] **Step 1: 新增 blocks 字段**

在 `ChatMessageItem` 接口的 `aguiToolCalls` 后新增 `blocks` 字段：

```typescript
// 文件: apps/web/src/modules/chat/types/chat.ts
// 在 import 区域新增:
import type { ParsedBlock } from '@incremark/core'

// 在 ChatMessageItem 接口末尾（aguiToolCalls 后）新增:
  /** 增量 Markdown 解析块（Incremark AST） */
  blocks?: ParsedBlock[]
```

- [ ] **Step 2: 运行类型检查**

```bash
cd apps/web && npx vue-tsc --noEmit
```
预期: blocks 类型不匹配的地方会报错（后续任务逐一修复）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/modules/chat/types/chat.ts
git commit -m "feat(frontend): add blocks field to ChatMessageItem for Incremark AST"
```

---

### Task 2: chatStore 新增 appendMessageBlocks

**Files:** Modify `apps/web/src/stores/chat.ts`

- [ ] **Step 1: 新增 appendMessageBlocks 方法**

在 `updateAssistantMessageHtml` 函数之后新增：

```typescript
// 文件: apps/web/src/stores/chat.ts
// 在 import 区新增:
import type { ParsedBlock } from '@incremark/core'

/**
 * 追加 Incremark 解析完成的 AST blocks 到助手消息。
 * 流式场景下每次 flush 追加新完成的 blocks，
 * 历史消息直接设置完整 blocks 数组。
 */
function appendMessageBlocks(
  messageId: number,
  blocks: ParsedBlock[],
) {
  const msg = messages.value.find((m) => m.id === messageId)
  if (!msg) return
  if (!msg.blocks) {
    msg.blocks = []
  }
  msg.blocks.push(...blocks)
}

// 在 return 语句中导出:
return {
  // ... existing
  appendMessageBlocks,
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/stores/chat.ts
git commit -m "feat(frontend): add appendMessageBlocks to chatStore"
```

---

### Task 3: 新建 CodeBlock.vue — Shiki 代码高亮组件

**Files:** Create `apps/web/src/components/chat/CodeBlock.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 代码块高亮组件
 *
 * 从 AST code 节点接收 lang 和 value，
 * 通过 Shiki 异步高亮后渲染。
 */
import { ref, watch } from 'vue'
import { getHighlighter } from '@/modules/chat/utils/shiki'
import type { HighlighterCore } from 'shiki/core'

const props = defineProps<{
  lang: string
  value: string
}>()

const highlightedHtml = ref('')
let highlighter: HighlighterCore | null = null

getHighlighter().then((h) => {
  highlighter = h
  highlight()
})

function encodeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function highlight() {
  const code = props.value.trimEnd()
  if (!highlighter) {
    highlightedHtml.value = `<pre><code>${encodeHTML(code)}</code></pre>`
    return
  }
  try {
    highlightedHtml.value = highlighter.codeToHtml(code, {
      lang: props.lang || 'text',
      theme: 'github-dark',
    })
  } catch {
    highlightedHtml.value = `<pre><code>${encodeHTML(code)}</code></pre>`
  }
}

watch(() => [props.lang, props.value], highlight)
</script>

<template>
  <div v-html="highlightedHtml" />
</template>
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/chat/CodeBlock.vue
git commit -m "feat(frontend): add CodeBlock component with Shiki highlighting"
```

---

### Task 4: 新建 InlineRenderer.vue — 行内元素递归渲染

**Files:** Create `apps/web/src/components/chat/InlineRenderer.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * 行内 Markdown 元素递归渲染器
 *
 * 接收 mdast 行内节点数组，递归渲染为 Vue 模板。
 * 支持 text, strong, emphasis, delete, inlineCode, link, image, html, break
 */
import type { RootContent } from 'mdast'

defineProps<{
  children: RootContent[]
}>()

function encodeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
</script>

<template>
  <template v-for="(child, idx) in children" :key="idx">
    <!-- 纯文本 -->
    <template v-if="child.type === 'text'">
      {{ (child as { value: string }).value }}
    </template>

    <!-- 粗体 -->
    <strong v-else-if="child.type === 'strong'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </strong>

    <!-- 斜体 -->
    <em v-else-if="child.type === 'emphasis'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </em>

    <!-- 删除线 -->
    <del v-else-if="child.type === 'delete'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </del>

    <!-- 行内代码 -->
    <code v-else-if="child.type === 'inlineCode'">
      {{ (child as { value: string }).value }}
    </code>

    <!-- 链接 -->
    <a
      v-else-if="child.type === 'link'"
      :href="(child as { url: string }).url"
      :title="(child as { title?: string }).title"
      target="_blank"
      rel="noopener noreferrer"
      class="text-primary hover:underline"
    >
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </a>

    <!-- 图片 -->
    <img
      v-else-if="child.type === 'image'"
      :src="(child as { url: string }).url"
      :alt="(child as { alt?: string }).alt || ''"
      :title="(child as { title?: string }).title"
      class="rounded max-w-full"
    />

    <!-- 换行 -->
    <br v-else-if="child.type === 'break'" />

    <!-- HTML (Incremark 已过滤 XSS) -->
    <span
      v-else-if="child.type === 'html'"
      v-html="(child as { value: string }).value"
    />

    <!-- 未知类型：转义输出原始文本 -->
    <template v-else>
      {{ encodeHTML(JSON.stringify(child)) }}
    </template>
  </template>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/chat/InlineRenderer.vue
git commit -m "feat(frontend): add InlineRenderer component for recursive inline mdast rendering"
```

---

### Task 5: 新建 MarkdownRenderer.vue — 块级分发 + 嵌套列表

**Files:** Create `apps/web/src/components/chat/MarkdownRenderer.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
/**
 * Markdown 块级渲染器
 *
 * 接收 Incremark 解析的 ParsedBlock[]，
 * 按 node.type 分发为对应的 Vue 组件或 HTML 标签。
 * 保持与 Tailwind Typography prose 兼容的标准 HTML 结构。
 */
import type { RootContent } from 'mdast'
import type { ParsedBlock } from '@incremark/core'
import InlineRenderer from './InlineRenderer.vue'
import CodeBlock from './CodeBlock.vue'

defineProps<{
  blocks: ParsedBlock[]
}>()

/** 列表 depth 映射: prose 对嵌套列表用 prose-ul/deep-ul */
function listClass(_depth: number): string {
  return ''
}
</script>

<template>
  <div class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed">
    <template v-for="block in blocks" :key="block.id">
      <!-- 标题 -->
      <component
        v-if="block.node.type === 'heading'"
        :is="`h${(block.node as { depth: number }).depth}`"
      >
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </component>

      <!-- 代码块 -->
      <CodeBlock
        v-else-if="block.node.type === 'code'"
        :lang="(block.node as { lang?: string }).lang || 'text'"
        :value="(block.node as { value: string }).value"
      />

      <!-- 段落 -->
      <p v-else-if="block.node.type === 'paragraph'">
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </p>

      <!-- 列表 -->
      <component
        v-else-if="block.node.type === 'list'"
        :is="(block.node as { ordered?: boolean }).ordered ? 'ol' : 'ul'"
        :class="listClass((block.node as { depth?: number }).depth ?? 0)"
      >
        <li
          v-for="(item, i) in (block.node as { children: { type: string; children: RootContent[] }[] }).children"
          :key="i"
        >
          <template v-for="(child, j) in item.children" :key="j">
            <InlineRenderer
              v-if="child.type === 'paragraph' || child.type === 'heading'"
              :children="(child as { children: RootContent[] }).children"
            />
            <!-- 嵌套列表：递归处理 block 类型 -->
            <ul v-else-if="child.type === 'list' && !(child as { ordered?: boolean }).ordered">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
              >
                <template v-for="(nc, nk) in nested.children" :key="nk">
                  <InlineRenderer
                    v-if="nc.type === 'paragraph'"
                    :children="(nc as { children: RootContent[] }).children"
                  />
                </template>
              </li>
            </ul>
            <ol v-else-if="child.type === 'list'">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
              >
                <template v-for="(nc, nk) in nested.children" :key="nk">
                  <InlineRenderer
                    v-if="nc.type === 'paragraph'"
                    :children="(nc as { children: RootContent[] }).children"
                  />
                </template>
              </li>
            </ol>
            <template v-else>
              {{ (child as { value?: string }).value || '' }}
            </template>
          </template>
        </li>
      </component>

      <!-- 引用 -->
      <blockquote v-else-if="block.node.type === 'blockquote'">
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </blockquote>

      <!-- 表格 -->
      <table v-else-if="block.node.type === 'table'">
        <thead v-if="(block.node as { children: { type: string }[] }).children?.[0]?.type === 'tableRow'">
          <tr>
            <th
              v-for="(cell, ci) in ((block.node as { children: { type: string; children: { type: string; children: RootContent[] }[] }[] }).children[0] as { children: { type: string; children: RootContent[] }[] }).children"
              :key="ci"
            >
              <InlineRenderer :children="(cell as { children: RootContent[] }).children" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in (block.node as { children: { type: string; children: { type: string; children: RootContent[] }[] }[] }).children.slice(
              (block.node as { children: { type: string }[] }).children?.[0]?.type === 'tableRow' ? 1 : 0
            )"
            :key="ri"
          >
            <td
              v-for="(cell, ci) in (row as { children: { type: string; children: RootContent[] }[] }).children"
              :key="ci"
            >
              <InlineRenderer :children="(cell as { children: RootContent[] }).children" />
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 分割线 -->
      <hr v-else-if="block.node.type === 'thematicBreak'" />

      <!-- HTML (Incremark 已过滤 XSS) -->
      <div
        v-else-if="block.node.type === 'html'"
        v-html="(block.node as { value: string }).value"
      />

      <!-- 兜底 -->
      <div v-else>
        <InlineRenderer
          v-if="'children' in block.node"
          :children="(block.node as { children: RootContent[] }).children"
        />
        <template v-else>
          {{ (block.node as { value?: string }).value || '' }}
        </template>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/chat/MarkdownRenderer.vue
git commit -m "feat(frontend): add MarkdownRenderer component for Incremark AST block rendering"
```

---

### Task 6: 重写 useStreamingMarkdown — 删除状态机，改用 Incremark

**Files:** Modify `apps/web/src/modules/chat/composables/useStreamingMarkdown.ts`

- [ ] **Step 1: 重写文件**

```typescript
/**
 * 流式 Markdown 增量渲染 Composable
 *
 * 策略：Incremark 内部缓冲 + 判定稳定边界，
 * 我们只消费 completed/updated blocks 并通过 onBlocks 回调输出。
 * 代码高亮由下游 CodeBlock 组件负责。
 */
import { createIncremarkParser } from '@incremark/core'
import type { IncremarkParser, ParsedBlock } from '@incremark/core'

interface StreamingMarkdownOptions {
  /** 每次有新的已完成 blocks 时回调 */
  onBlocks: (blocks: ParsedBlock[]) => void
  /** 解析完成回调 */
  onComplete?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

export function useStreamingMarkdown(options: StreamingMarkdownOptions) {
  const { onBlocks, onComplete, onError } = options

  let parser: IncremarkParser | null = null

  try {
    parser = createIncremarkParser({ gfm: true })
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)))
  }

  /**
   * 接收文本增量。
   * appended blocks 已在 parser 内部处理，completed/updated 直接输出。
   */
  function pushDelta(delta: string): void {
    if (!delta || !parser) return

    try {
      const update = parser.append(delta)
      const blocks = [...update.completed, ...update.updated]
      if (blocks.length > 0) {
        onBlocks(blocks)
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * 强制 flush：标记解析完成，输出所有剩余内容。
   */
  function flush(): void {
    if (!parser) {
      onComplete?.()
      return
    }

    try {
      const update = parser.finalize()
      const blocks = [...update.completed, ...update.pending]
      if (blocks.length > 0) {
        onBlocks(blocks)
      }
      onComplete?.()
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
      onComplete?.()
    }
  }

  /**
   * 重置解析器状态。
   */
  function reset(): void {
    if (parser) {
      parser.reset()
    }
  }

  return {
    pushDelta,
    flush,
    reset,
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/modules/chat/composables/useStreamingMarkdown.ts
git commit -m "feat(frontend): rewrite useStreamingMarkdown with Incremark parser"
```

---

### Task 7: useAgentChat 适配 — onFlush(html) → onBlocks(blocks)

**Files:** Modify `apps/web/src/modules/chat/composables/useAgentChat.ts`

- [ ] **Step 1: 修改 useStreamingMarkdown 调用处**

文件约 L125-141，将 `useStreamingMarkdown` 调用从 `onFlush(html)` 改为 `onBlocks(blocks)`：

```typescript
// 旧代码（删除）:
// const {
//   pushDelta,
//   flush,
//   reset: resetMarkdown,
// } = useStreamingMarkdown({
//   onFlush: (html) => {
//     chatStore.updateAssistantMessageHtml(assistantMsgId, html, 'append');
//   },
//   onComplete: () => {
//     chatStore.setMessageStatus(assistantMsgId, 'completed');
//     onMessageFinish?.(assistantMsgId);
//   },
//   onError: (err) => {
//     console.error('[useAgentChat] Markdown 渲染错误:', err);
//     onError?.(err);
//   },
// });

// 新代码:
const {
  pushDelta,
  flush,
  reset: resetMarkdown,
} = useStreamingMarkdown({
  onBlocks: (blocks) => {
    chatStore.appendMessageBlocks(assistantMsgId, blocks)
  },
  onComplete: () => {
    chatStore.setMessageStatus(assistantMsgId, 'completed')
    onMessageFinish?.(assistantMsgId)
  },
  onError: (err) => {
    console.error('[useAgentChat] Markdown 渲染错误:', err)
    onError?.(err)
  },
})
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/modules/chat/composables/useAgentChat.ts
git commit -m "feat(frontend): adapt useAgentChat to Incremark onBlocks callback"
```

---

### Task 8: AIMessageItem 适配 — v-html → MarkdownRenderer

**Files:** Modify `apps/web/src/components/chat/AIMessageItem.vue`

- [ ] **Step 1: 替换渲染模板**

在 `<script setup>` 中新增 import：

```typescript
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
```

将模板中：

```html
<!-- 旧代码（删除）: -->
<div
  v-if="hasContent"
  class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed"
  v-html="message.htmlContent || message.content"
/>

<!-- 新代码: -->
<MarkdownRenderer
  v-if="hasContent && message.blocks?.length"
  :blocks="message.blocks"
/>
<!-- 兼容旧消息（无 blocks 的历史数据）：回退 HTML -->
<div
  v-else-if="hasContent"
  class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed"
  v-html="message.htmlContent || message.content"
/>
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/chat/AIMessageItem.vue
git commit -m "feat(frontend): render Incremark AST blocks via MarkdownRenderer in AIMessageItem"
```

---

### Task 9: 类型检查 + 构建验证

**Files:** 无新建，验证所有变更

- [ ] **Step 1: 运行类型检查**

```bash
cd apps/web && npx vue-tsc --noEmit
```

预期: 0 errors。

常见修复：
- 如果 mdast 类型不匹配：确认 `@incremark/core` 导出了正确的类型，必要时在组件中用 `as` 断言
- 如果 `RootContent` 导入报错：检查 `mdast` 包是否安装（Incremark 依赖中已含）

- [ ] **Step 2: 运行构建**

```bash
cd apps/web && npx vite build
```

预期: 构建成功，输出与当前 master 一致的 chunk 结构。

- [ ] **Step 3: （如有后端可用）启动开发环境验证流式对话**

```bash
pnpm dev:web
```

验证项：
- 发送消息，文字逐段出现
- 代码块语法高亮正常
- 粗体/斜体/链接等内联格式正确
- 列表/表格/引用正确渲染
- 中止/重发不崩溃

- [ ] **Step 4: 提交最终修复**

```bash
git add apps/web/src/
git commit -m "chore(frontend): fix type errors and build issues from Incremark migration"
```

---

### Task 10: 回写实施文档

**Files:** Modify `docs/06-优化/前端优化/03-技术选型-流式渲染方案.md`, `docs/06-优化/前端优化/04-实施计划-流式渲染优化.md`

- [ ] **Step 1: 更新 03-技术选型**

在文件末尾追加，更新技术组合表为"已完整实施"状态：

```markdown
### 2026-05-09 更新：完整实施 Incremark + AST 渲染

> 详见 [设计文档](../../superpowers/specs/2026-05-09-incremark-ast-vue-streaming-design.md)
> 详见 [业界调研](./05-业界调研-流式渲染方案.md)

原技术选型中"保持 marked"的决策已升级——在调研业界方案（ChatGPT/Gemini/DeepSeek/豆包）后，
决定执行完整迁移：Incremark 增量解析 + AST → Vue 组件树渲染。

| 层级 | 当前 | 变更后 |
|------|------|--------|
| Markdown 解析 | marked（buffer 切片 O(n) 实际） | **Incremark**（真增量 O(n)，稳定边界判定） |
| 代码高亮 | Shiki 按需 | Shiki 按需（不变，配合更紧密） |
| DOM 渲染 | HTML 字符串 + v-html | **Vue 组件树**（MarkdownRenderer/InlineRenderer/CodeBlock） |
```

- [ ] **Step 2: 更新 04-实施计划**

追加第二次实施记录：

```markdown
## 八、第二次实施（2026-05-09）：Incremark + AST → Vue 组件树

> 基于设计文档 [2026-05-09-incremark-ast-vue-streaming-design](../../superpowers/specs/2026-05-09-incremark-ast-vue-streaming-design.md)
> 基于业界调研 [05-业界调研-流式渲染方案](./05-业界调研-流式渲染方案.md)

### 实施方案

保留 Shiki 高亮方案不变，将 marked + buffer 切片解析 + v-html 渲染
全部替换为 Incremark 增量解析 + AST → Vue 组件树。

### 变更文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/chat/composables/useStreamingMarkdown.ts` | 重写 | 删除 buffer/状态机（~250 行），改用 Incremark |
| `src/components/chat/MarkdownRenderer.vue` | 新建 | 块级 AST → Vue 组件分发 |
| `src/components/chat/InlineRenderer.vue` | 新建 | 行内元素递归渲染 |
| `src/components/chat/CodeBlock.vue` | 新建 | Shiki 代码高亮组件 |
| `src/stores/chat.ts` | 修改 | 新增 appendMessageBlocks() |
| `src/modules/chat/types/chat.ts` | 修改 | ChatMessageItem 新增 blocks 字段 |
| `src/modules/chat/composables/useAgentChat.ts` | 微调 | onFlush(html) → onBlocks(blocks) |
| `src/components/chat/AIMessageItem.vue` | 修改 | v-html → MarkdownRenderer |

### 验收状态

| 检查项 | 状态 | 备注 |
|--------|------|------|
| vue-tsc 类型检查通过 | ⏳ | |
| vite build 构建成功 | ⏳ | |
| 流式对话正常渲染 | ⏳ | 需启动后端 |
| 代码块高亮正确 | ⏳ | 需启动后端 |
| 内联格式正确 | ⏳ | 需启动后端 |
| 历史消息兼容 | ✅ | 无 blocks 时回退 htmlContent |
```

- [ ] **Step 3: 提交文档**

```bash
git add "docs/06-优化/前端优化/03-技术选型-流式渲染方案.md" "docs/06-优化/前端优化/04-实施计划-流式渲染优化.md"
git commit -m "docs(frontend): update tech selection and implementation plan for Incremark migration"
```

---

### 依赖关系

```
Task 1 (types) ──┐
                 ├── Task 6 (useStreamingMarkdown) ── Task 7 (useAgentChat)
Task 2 (store) ──┘                                        │
                                                          │
Task 3 (CodeBlock) ──┐                                    │
Task 4 (InlineRenderer) ├── Task 5 (MarkdownRenderer) ─── Task 8 (AIMessageItem)
                      │
                      └── (no deps between 3 and 4)

Task 9 (verify) ← depends on all 1-8
Task 10 (docs)  ← depends on 9 passing
```

可并行的任务组：
- 1 + 2 可并行（types + store，无互相依赖）
- 3 + 4 可并行（CodeBlock + InlineRenderer，互不依赖）
- 6 依赖 1，7 依赖 6，8 依赖 2 + 5
