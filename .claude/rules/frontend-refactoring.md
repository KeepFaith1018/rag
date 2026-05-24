---
paths: ["apps/web/src/**/*"]
---

# 前端重构安全规则

基于 store 拆分 + 流式渲染重构事故总结。31 个文件改动，引入 5 个功能缺陷，核心教训如下。

## 1. 重构粒度

- **禁止**：在一个 commit 中混合 store 拆分、组件拆分、新功能集成（打字机效果）、构建优化
- **必须**：每个独立改动单独提交 + 单独验证
- **必须**：重构（改变结构不改变行为）和新功能（改变行为）分不同 commit

## 2. Pinia Store 拆分规则

### 2.1 统一入口层

- **禁止**：在统一入口 store 中创建本地 ref + watch 克隆子 store 的 ref
- **原因**：watch 异步（`flush: 'pre'`），在子 store 更新后到 watch 回调触发前存在微任务窗口，读取到旧值
- **原因**：本地 ref 可被静默赋值，但不会同步回子 store，造成双写不一致
- **正确做法**：使用 `storeToRefs(store)` 直接获取子 store ref 的引用

### 2.2 方法签名保留

- **必须**：提取方法到子 store 时，保持**参数语义**完全一致
- **案例**：`setMessageStatus(msgId)` 参数语义是"按消息 ID 查找"，不是"数组下标"。改成 `messages[msgIndex]` 造成全部消息操作静默失效
- **正确做法**：保持 `find(m => m.id === msgId)` 的查找语义

### 2.3 附带副作用保留

- **必须**：提取方法时应保留原方法的所有副作用
- **案例**：原 `selectSession` 包含 `loadMessages()` 调用，提取后丢失，导致切换历史会话无内容
- **正确做法**：额外审查每个方法的调用链路，列出所有副作用清单

### 2.4 响应式引用

- **禁止**：直接赋值 `const value = otherStore.someProperty` 来获取响应式值——Pinia 会自动解包 ref，得到的是**快照值**而非响应式引用
- **正确做法**：`const value = toRef(otherStore, 'someProperty')` 或从 `storeToRefs(otherStore)` 中解构

## 3. 第三方库集成规则

### 3.1 生命周期理解

- **必须**：引入新抽象层（如 BlockTransformer）前，阅读源码理解其生命周期回调时机
- **案例**：
  - `push()` 后 `getDisplayBlocks()` 可能在 RAF 前返回空数组 → 需要回退到 raw blocks
  - `processNext()` 处理完全部 block 后会 emit 空数组 → 需要过滤空更新
  - `transformer.reset()` 会 emit 空数组 → 流结束后不能调 reset
  - `push()` 按输入 id 集合过滤内部已完成 block → 每次必须传入全量 block 列表
- **正确做法**：阅读 `node_modules` 中库的类型定义和源码（`.js` 文件）确认行为

### 3.2 渐进式集成

- **推荐**：新抽象层先用最小可行集成验证核心路径，确认无误后再扩展功能
- **案例**：应先集成 BlockTransformer 不做打字机效果（`charsPerTick: 0` 或直接透传），确认流式渲染正常后再开启打字机

## 4. 流式渲染验证清单

任何涉及以下文件/模块的改动完成后，**必须**执行：

- [ ] `stores/chat*.ts` — 发送一条消息，确认内容渲染、状态变化正确
- [ ] `composables/useStreamingMarkdown.ts` — 同上
- [ ] `composables/useAgentChat.ts` — 同上，+ 确认 agent 步骤面板正常、中止流正常
- [ ] `components/chat/MarkdownRenderer.vue` — 确认 Markdown 各类型渲染正常
- [ ] 切换历史会话 — 确认历史消息正确加载和渲染
- [ ] 切换知识库/模型 — 确认选择器有数据、可切换
- [ ] RAG 模式对话 — 确认知识库检索步骤、引用展示正常

## 5. 类型安全

- **禁止**：用 `as never` 绕过类型检查
- **禁止**：改变方法签名中的参数类型（如 `MessageStatus` 退化为 `string`）
- **推荐**：子组件的 `defineEmits<>()` 显式声明事件类型，而非依赖运行时 `$emit()`
