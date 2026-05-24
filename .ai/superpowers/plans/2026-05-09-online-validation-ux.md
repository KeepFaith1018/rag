# 在线校验流程优化 — 实施计划

> 日期：2026-05-09 | 基于 SSE 抓包验证结果

---

## 目标

1. 保留 fact_check + completeness_check 在线执行，用户可见校验进度
2. comment out writer_correct 修正环（暂缓，后续考虑离线化）
3. 补充内容以"补充内容："格式追加到回答末尾
4. 不同阶段停止按钮有不同行为和语义

---

## 一、后端：LangGraph 图改造

### 1.1 移除 writer_correct 修正环

**文件**: `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

```typescript
// 改造前（L1221-1226）:
.addEdge('writer', 'fact_check')
.addConditionalEdges('fact_check', factCheckEdge, {
  completeness_check: 'completeness_check',
  writer_correct: 'writer_correct',
})
.addEdge('writer_correct', 'fact_check')

// 改造后:
.addEdge('writer', 'fact_check')
.addEdge('fact_check', 'completeness_check')  // 直连，不走修正环
// writer_correct 节点和 edge 保留代码但注释掉
```

`factCheckEdge` 函数和 `writer_correct` 节点保留不删，代码块注释标记 `// @deprecated 离线化预留`。

### 1.2 校验阶段新增 abort 检查

在每个校验节点中增加 abort 检查：

```typescript
// fact_check 节点内（L894 附近）:
checkAborted();  // 已有，保留

// 如果 abort：跳过校验，直接返回
// 在 catch 块或特殊处理中：
if (signal?.aborted) {
  return { factCheckResult: null, currentPhase: 'verifying' }
}
```

同样在 `completeness_check`、`supplement_retrieve`、`writer_supplement` 中检查。

### 1.3 改造 completeness_check 后路由

当前 `completenessEdge` 不变：
```
completeness_check → coverage<0.8 + retrievable → supplement_retrieve → writer_supplement → __end__
                   → 其他 → __end__
```

### 1.4 writer_supplement abort 处理

用户中断补充时，保存已输出的补充片段：

```typescript
// writer_supplement 节点内
let supplement = ''
try {
  for await (const chunk of lcStream) {
    if (signal?.aborted) break  // 中断，保留已输出的内容
    // ...
  }
} finally {
  return { supplementAnswer: supplement, currentPhase: 'writing' }
}
```

### 1.5 onFinish 中合并回答

```typescript
// L1255 附近
const fullContent = (state.draftAnswer ?? '')
  + (state.supplementAnswer
    ? '\n\n---\n**补充内容：**\n' + state.supplementAnswer
    : '')
```

### 1.6 新增 SSE 事件类型

**文件**: `apps/server/src/modules/chat/types/agui-events.ts`

```typescript
// 新增:
interface ValidationStartedEvent {
  type: 'VALIDATION_STARTED'
}

interface ValidationCompletedEvent {
  type: 'VALIDATION_COMPLETED'
  factCheckRisk?: 'low' | 'medium' | 'high'
  completenessCoverage?: number
  supplementAdded: boolean
}
```

在 `writer` 完成后发出 `VALIDATION_STARTED`，在所有校验完成后发出 `VALIDATION_COMPLETED`。

---

## 二、前端：状态管理

### 2.1 新增 messageStatus

**文件**: `apps/web/src/modules/chat/types/chat.ts`

```typescript
export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'validating'     // 新增：回答生成完毕，正在校验
  | 'supplementing'  // 新增：正在补充内容
  | 'completed'
  | 'aborted'
  | 'error'
```

### 2.2 useAgentChat 适配

**文件**: `apps/web/src/modules/chat/composables/useAgentChat.ts`

新增 SSE 事件处理：

```typescript
case 'VALIDATION_STARTED':
  chatStore.setMessageStatus(assistantMsgId, 'validating')
  break

case 'VALIDATION_COMPLETED':
  chatStore.setMessageStatus(assistantMsgId, 'completed')
  break
```

在 `STEP_STARTED supplement_retrieve` / `writer_supplement` 时：

```typescript
case 'STEP_STARTED':
  if (event.stepName === 'supplement_retrieve' || event.stepName === 'writer_supplement') {
    chatStore.setMessageStatus(assistantMsgId, 'supplementing')
  }
  // ... existing logic
```

**Abort 行为改造**：

```typescript
function abort(): void {
  if (abortController.value) {
    abortController.value.abort()
  }
  // 不设置 status=aborted，由后端 SSE 事件决定：
  // - TEXT_MESSAGE_END 已发出 → status=completed（回答完整）
  // - TEXT_MESSAGE_END 未发出 → status=aborted（回答不完整）
}
```

---

## 三、前端：UI 展示

### 3.1 AIMessageItem 校验状态指示器

**文件**: `apps/web/src/components/chat/AIMessageItem.vue`

在 Markdown 内容下方新增校验状态栏：

```html
<!-- 校验中 -->
<div v-if="isStreaming && hasContent" class="flex items-center gap-2 mt-2">
  <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
  <span class="text-xs text-outline">
    {{ message.messageStatus === 'validating' ? '正在校验回答...' : 
       message.messageStatus === 'supplementing' ? '正在补充内容...' : '' }}
  </span>
</div>

<!-- 校验完成 -->
<div v-if="!isStreaming && hasContent && isRagMode" class="flex items-center gap-2 mt-2">
  <span class="material-symbols-outlined text-xs text-green-400">verified</span>
  <span class="text-xs text-outline/50">已校验</span>
</div>
```

### 3.2 停止按钮语义

```html
<button v-if="isStreaming" @click="emit('stop')">
  {{ message.messageStatus === 'streaming' ? '停止生成' :
     message.messageStatus === 'validating' ? '跳过校验' :
     message.messageStatus === 'supplementing' ? '停止补充' : '停止' }}
</button>
```

### 3.3 补充内容展示

补充内容作为 Markdown 的一部分追加到 blocks 中。`onFinish` 回调保存的完整内容已包含"补充内容："分隔符和补充文本。MarkdownRenderer 直接渲染即可。

---

## 四、实施任务

### Task 1: 后端 — 移除 writer_correct 修正环

**文件**: `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

- [ ] 将 `fact_check → factCheckEdge → completeness_check/writer_correct` 改为 `fact_check → completeness_check` 直连
- [ ] 注释 `writer_correct` 节点的图注册（保留节点代码）
- [ ] 注释 `MAX_FACT_CHECK_ROUNDS` 和 `factCheckRounds` 相关逻辑（保留代码）
- [ ] 构建验证：`pnpm --filter server build`

### Task 2: 后端 — 校验节点 abort 处理 + SSE 事件

**文件**: 
- `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`
- `apps/server/src/modules/chat/types/agui-events.ts`

- [ ] 在 `fact_check`、`completeness_check`、`supplement_retrieve`、`writer_supplement` 中增加 abort 检查
- [ ] 新增 `VALIDATION_STARTED` / `VALIDATION_COMPLETED` SSE 事件类型
- [ ] `writer` 完成后发送 `VALIDATION_STARTED`
- [ ] 所有校验完成后发送 `VALIDATION_COMPLETED`
- [ ] `onFinish` 中按"补充内容："格式合并 draftAnswer + supplementAnswer
- [ ] 构建验证

### Task 3: 前端 — 类型 + Store

**文件**: 
- `apps/web/src/modules/chat/types/chat.ts`
- `apps/web/src/stores/chat.ts`

- [ ] MessageStatus 新增 `'validating'` | `'supplementing'`
- [ ] chatStore 无需额外改动（status setter 已存在）

### Task 4: 前端 — useAgentChat 适配

**文件**: `apps/web/src/modules/chat/composables/useAgentChat.ts`

- [ ] 处理 `VALIDATION_STARTED` / `VALIDATION_COMPLETED` 事件
- [ ] `STEP_STARTED supplement_retrieve/writer_supplement` 时设置 status='supplementing'
- [ ] abort() 改造：不强制设 aborted，由 TEXT_MESSAGE_END 是否已发出决定

### Task 5: 前端 — AIMessageItem UI

**文件**: `apps/web/src/components/chat/AIMessageItem.vue`

- [ ] 新增校验状态指示器（validating/supplementing 动画 + 完成标志）
- [ ] 停止按钮根据 messageStatus 显示不同文字
- [ ] 补充内容通过 Markdown 自然渲染（已包含在 blocks 中）

### Task 6: 端到端验证

- [ ] 启动后端 + 前端
- [ ] 场景 1：正常对话 → 看到"正在校验..."→ "已校验"✓
- [ ] 场景 3：无关问题 → 看到"正在校验..."→"正在补充..."→"已校验"✓
- [ ] 场景 6：问候 → 看到"正在校验..."→"已校验"✓
- [ ] 中断测试：writer 流式中点停止 → aborted
- [ ] 中断测试：校验中点停止 → 跳过校验，completed
- [ ] 中断测试：补充中点停止 → 保留已补充的内容，completed
- [ ] `vue-tsc -b` + `vite build` 通过

---

## 五、不做的事

- writer_correct 修正环：代码保留但注释掉，后续考虑离线化
- 离线 BullMQ 队列：本次不做，保持全部在线
- factCheckRounds 计数器：随修正环一起注释
