# 对话上下文管理 — 设计文档

**日期：** 2026-05-25
**状态：** 设计中

## 问题

当前系统的对话模块每次 RAG 查询完全无状态。虽然 `b_chat_messages` 表已按 session 存储历史消息，但后端在编排 LLM 调用时不会加载它们。具体表现为：

- LangGraph State 无 `chatHistory` 字段，只有当前 `originalQuery`
- Writer 节点仅发送 `[SystemMessage, HumanMessage(query)]`，无历史轮次
- Rewrite 节点只看当前 query，无法做指代消解（"那个方案" → "方案A"）
- `streamChatMode()` 同样以孤立消息调用 LLM
- 系统无法处理追问、指代消解等基本多轮对话场景

## 设计目标

**标准版（v1）：历史注入 + 查询改写 + Token 预算管理**

- 对话历史在每次请求时从 DB 加载并注入 LangGraph State
- Rewrite 节点利用历史做指代消解，将模糊追问改写为独立完整查询
- Writer 节点接收完整历史，生成有上下文感知的回答
- Token 预算管理：固定 N 轮 + 硬上限，预留扩展接口
- 前端无需改动（历史由后端自行加载）

## 方案概要

### 架构：ContextManagerService（方案 C）

新增专用上下文管理服务，在 `graph.invoke()` 前调用，结果以 `BaseMessage[]` 传入 State。

**选择理由：** 上下文管理有独立演进需求（后续可能加入摘要、滑动窗口等），值得有自己边界清晰的服务。相比图前 pre-load（方案 A）更可测试，比节点内 lazy-load（方案 B）更少重复。

### 数据流

```
POST /chat/stream
      │
      ▼
ChatStreamService.streamRagMode()
      │
      ├─ 权限检查（现有，不动）
      │
      ├─ 【新增】ContextManagerService.buildContext(sessionId, userId)
      │       ├─ 此时当前用户消息尚未入库，加载的是纯历史
      │       ├─ 加载最近 N 轮消息（≤10轮，≤4000 token）
      │       └─ 返回 LangChain BaseMessage[]
      │
      ├─ 创建用户消息（现有，不动）
      │       ├─ 加载最近 N 轮消息（≤10轮，≤4000 token）
      │       ├─ 过滤不完整/错误消息
      │       └─ 返回 LangChain BaseMessage[]
      │
      ├─ graph.invoke({ ..., chatHistory })  ← State 新增字段
      │       │
      │       ├─ route → 无变化（只看当前 query）
      │       ├─ rewrite → 【修改】接收 chatHistory，做指代消解
      │       ├─ retrieve → 无变化（用改写后的 query）
      │       ├─ ... 中间节点无变化 ...
      │       └─ writer → 【修改】注入 chatHistory 到 LLM 消息列表
      │
      └─ 持久化助手消息 + 引用（现有，不动）
```

### 改动清单

| 类型 | 文件 | 说明 |
|------|------|------|
| 新增 | `chat/services/context-manager.service.ts` | 上下文管理服务 |
| 修改 | `chat/services/multi-agent-orchestrator.service.ts` | State 定义 + rewrite/writer 节点 |
| 修改 | `chat/services/chat-stream.service.ts` | streamRagMode + streamChatMode 注入历史 |
| 修改 | `chat/prompts/rewrite.prompt.ts` | 追加 `{chatHistory}` 占位符 |
| 修改 | `chat/chat.module.ts` | 注册 ContextManagerService |

## 详细设计

### 1. ContextManagerService

**文件：** `apps/server/src/modules/chat/services/context-manager.service.ts`

```typescript
@Injectable()
export class ContextManagerService {
  constructor(
    private readonly chatMessageService: ChatMessageService,
    private readonly tokenService: TokenService,
  ) {}

  async buildContext(sessionId: string, userId: number): Promise<BaseMessage[]> {
    // 1. 加载最近消息（pageSize=20 覆盖 10 轮）
    const result = await this.chatMessageService.listMessages(sessionId, {
      pageSize: 20,
    });

    // 2. 过滤：只取 user/assistant 且已完成的消息
    const messages = result.items
      .filter(m => ['user', 'assistant'].includes(m.role))
      .filter(m => m.message_status === 'completed')
      .reverse(); // 时间升序

    // 3. 按轮次配对截断（最多 CONTEXT_MAX_ROUNDS 轮）
    const rounds = this.pairToRounds(messages).slice(-CONTEXT_MAX_ROUNDS);

    // 4. 转换为 LangChain 消息
    const baseMessages = rounds.flatMap(round => [
      new HumanMessage(round.user.content),
      new AIMessage(round.assistant.content),
    ]);

    // 5. Token 预算截断（从旧到新）
    return this.truncateByTokens(baseMessages, CONTEXT_MAX_HISTORY_TOKENS);
  }
}
```

**核心逻辑要点：**

- **消息配对：** 确保 user/assistant 交替出现。连续同角色消息（理论上不应出现）跳过前一条
- **Token 截断：** 使用已有 `TokenService.countTokens()` 累计，超出 4000 从旧端移除。至少保留最后一轮
- **空会话兼容：** 新会话无历史消息时返回空数组，不影响现有行为
- **错误降级：** 任何异常（DB 连接、解析错误）记录 warn 日志，返回空数组

**配置项（环境变量）：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CONTEXT_MAX_ROUNDS` | 10 | 最多保留轮数 |
| `CONTEXT_MAX_HISTORY_TOKENS` | 4000 | 历史消息最大 token 数 |

**依赖注入：** `ChatMessageService`（已有）、`TokenService`（已有）

### 2. LangGraph State 变更

**文件：** `multi-agent-orchestrator.service.ts` — `AgentStateAnnotation`

```typescript
const AgentStateAnnotation = Annotation.Root({
  // ... 现有字段不变 ...
  chatHistory: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
});
```

reducer 为直接覆盖（非追加），因为每轮对话重新从 DB 构建最新历史。

### 3. Rewrite 节点改造

**文件：** `rewrite.prompt.ts`

在 prompt 中加入历史上下文占位符：

```typescript
export const REWRITE_SYSTEM_PROMPT = `你是查询改写专家...基于对话历史，将用户问题改写为独立、完整的检索查询...

对话历史：
{chatHistory}

用户当前问题：{originalQuery}`;
```

**文件：** `multi-agent-orchestrator.service.ts` — `rewriteQueryNode()`

```typescript
// 格式化历史为文本
const historyText = formatChatHistoryAsText(state.chatHistory);

const prompt = REWRITE_SYSTEM_PROMPT
  .replace('{chatHistory}', historyText || '（无历史对话）')
  .replace('{originalQuery}', state.originalQuery);
```

`formatChatHistoryAsText()` 格式化示例：

```
用户: 对比方案A和方案B的优缺点
助手: 方案A使用React..., 方案B使用Vue...
用户: 那个方案的成本是多少？
```

### 4. Writer 节点改造

**文件：** `multi-agent-orchestrator.service.ts` — writer 节点闭包（第 915-917 行附近）

**改动前：**
```typescript
const lcStream = await draftModel.stream([
  new SystemMessage(finalPrompt),
  new HumanMessage(state.originalQuery),
]);
```

**改动后：**
```typescript
const messages: BaseMessage[] = [
  new SystemMessage(finalPrompt),
  ...state.chatHistory,
  new HumanMessage(state.originalQuery),
];
const lcStream = await draftModel.stream(messages);
```

### 5. streamChatMode 改造

**文件：** `chat-stream.service.ts` — `streamChatMode()`（第 233-235 行附近）

与 RAG 模式一致，调用 `contextManagerService.buildContext()` 后注入消息列表。

```typescript
const contextMessages = await this.contextManagerService.buildContext(
  dto.sessionId, user.id,
);

const messages: BaseMessage[] = [
  new SystemMessage(SYSTEM_PROMPT),
  ...contextMessages,
  new HumanMessage(dto.message),
];
```

### 6. Token 预算分配

当前 `qwen-turbo` 上下文窗口 131072 token，远未触及瓶颈。v1 使用简单策略：

- **历史：** 固定 ≤ 4000 token
- **检索上下文：** 延续现有 `MAX_CONTEXT_CHARS = 12000`（约 3000-4000 token）
- **生成输出：** 不硬限，靠模型自动停止

总预算约 8000 token，远低于模型上限。后续模型切换或上下文需求增长时，可引入动态预算分配（`ContextBudgetManager` 接口）。

### 7. 错误处理与降级

| 场景 | 行为 |
|------|------|
| 历史加载失败（DB 错误） | warn 日志，`chatHistory = []`，对话正常继续 |
| Token 计数失败 | 保守估算（charCount / 2），继续 |
| 空历史（新会话首条消息） | 空数组，行为与现有完全一致 |
| 消息配对异常（连续同角色） | 跳过前面的，保留后面的 |

所有降级路径确保：上下文功能故障时，对话仍以无历史模式正常工作。

### 8. 扩展预留

`ContextManagerService` 设计为可替换策略：

```typescript
interface ContextBuildStrategy {
  buildContext(sessionId: string, userId: number): Promise<BaseMessage[]>;
}
```

后续如需升级为滑动窗口 + 摘要策略，实现新的 strategy 并替换注入即可，不碰图节点。

## 前端影响

**无。** 历史由后端从数据库自行加载，前端不需要额外传递任何数据。现有 `useAgentChat` composable 和 SSE 协议不变。

## 测试要点

### 单元测试

- `ContextManagerService.buildContext()` — 正常加载、空会话、超出 token 截断、配对异常
- `formatChatHistoryAsText()` — 格式化输出验证

### 集成测试

- RAG 模式多轮对话：第一轮问"方案A和方案B的区别"，第二轮问"那个成本更低？" → 验证改写准确性
- 普通对话模式多轮：验证历史注入后 LLM 回复有上下文感知
- 超长历史截断：插入 20 轮对话，验证旧轮次被截断

### E2E 测试

- 通过 SSE 端点发送两轮对话，验证第二轮回复关联了第一轮内容
- 新会话首条消息行为不变（回归）

## 不纳入 v1 的内容

- 滑动窗口 + 摘要压缩（后续迭代）
- 路由/分解节点上下文感知（实际场景需求低）
- 前端历史管理 UI 改动（不需要）
- 用户自定义上下文配置（后续迭代）
- 按知识库区分历史的策略（当前单一知识库场景为主）
