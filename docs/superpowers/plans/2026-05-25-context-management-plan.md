# 对话上下文管理 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现多轮对话上下文管理，将历史消息注入 RAG 流水线的 rewrite 和 writer 节点，使系统具备指代消解和上下文感知回复能力。

**Architecture:** 新增 ContextManagerService 在 graph.invoke() 前从 DB 加载历史，转换为 LangChain BaseMessage[] 注入 AgentState。rewrite 节点使用历史做指代消解改写，writer 节点使用历史生成上下文感知回答。TokenService 做 token 预算截断。

**Tech Stack:** NestJS + LangChain/LangGraph + Prisma + tiktoken (cl100k_base)

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `apps/server/src/modules/chat/services/context-manager.service.ts` | 加载/过滤/截断历史消息，返回 BaseMessage[] |
| Create | `apps/server/src/modules/chat/services/context-manager.service.spec.ts` | 单元测试 |
| Modify | `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts` | State + chatHistory 字段；rewrite/writer 节点注入历史 |
| Modify | `apps/server/src/modules/chat/services/chat-stream.service.ts` | streamRagMode/streamChatMode 调用 buildContext |
| Modify | `apps/server/src/modules/chat/prompts/rewrite.prompt.ts` | 追加 {chatHistory} 占位符 |
| Modify | `apps/server/src/modules/chat/chat.module.ts` | 注册 ContextManagerService + TokenService |

---

### Task 1: 新增 ContextManagerService

**Files:**
- Create: `apps/server/src/modules/chat/services/context-manager.service.ts`

- [ ] **Step 1: 创建 ContextManagerService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatMessageService } from './chat-message.service';
import { TokenService } from '@common/utils/token.service';

const CONTEXT_MAX_ROUNDS = 10;
const CONTEXT_MAX_HISTORY_TOKENS = 4000;

/**
 * 将 BaseMessage[] 格式化为纯文本，供 rewrite prompt 使用。
 * 作为独立导出函数，方便各节点零依赖调用。
 */
export function formatChatHistoryAsText(messages: BaseMessage[]): string {
  if (!messages || messages.length === 0) return '';
  return messages
    .map((m) => {
      const role = m._getType() === 'human' ? '用户' : '助手';
      const content =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join('\n');
}

@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);

  constructor(
    private readonly chatMessageService: ChatMessageService,
    private readonly tokenService: TokenService,
  ) {}

  async buildContext(sessionId: string): Promise<BaseMessage[]> {
    try {
      const result = await this.chatMessageService.listMessages(sessionId, {
        pageSize: 20,
      });

      const completed = result.list
        .filter((m) => ['user', 'assistant'].includes(m.role))
        .filter((m) => m.messageStatus === 'completed');

      const rounds = this.pairToRounds(completed).slice(-CONTEXT_MAX_ROUNDS);

      const baseMessages = rounds.flatMap((round) => [
        new HumanMessage(round.user.content),
        new AIMessage(round.assistant.content),
      ]);

      return this.truncateByTokens(baseMessages);
    } catch (error) {
      this.logger.warn('[ContextManager] 加载历史失败，降级为空上下文', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      return [];
    }
  }

  private pairToRounds(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ user: { role: string; content: string }; assistant: { role: string; content: string } }> {
    const rounds: Array<{ user: { role: string; content: string }; assistant: { role: string; content: string } }> = [];
    let i = 0;
    while (i < messages.length - 1) {
      const a = messages[i];
      const b = messages[i + 1];
      if (a.role === 'user' && b.role === 'assistant') {
        rounds.push({ user: a, assistant: b });
        i += 2;
      } else {
        i += 1;
      }
    }
    return rounds;
  }

  private truncateByTokens(messages: BaseMessage[]): BaseMessage[] {
    if (messages.length === 0) return [];

    let total = 0;
    const result: BaseMessage[] = [];
    // 从最新到最旧累计，再反转
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = typeof messages[i].content === 'string'
        ? messages[i].content
        : JSON.stringify(messages[i].content);
      const tokens = this.tokenService.tokenCount(content);
      if (total + tokens > CONTEXT_MAX_HISTORY_TOKENS && result.length >= 2) {
        break; // 至少保留最后一轮
      }
      total += tokens;
      result.unshift(messages[i]);
    }
    return result;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/modules/chat/services/context-manager.service.ts
git commit -m "feat: 新增 ContextManagerService，支持历史加载/配对/Token截断"
```

---

### Task 2: 注册依赖到 ChatModule

**Files:**
- Modify: `apps/server/src/modules/chat/chat.module.ts:1-47`

- [ ] **Step 1: 添加 import 和注册 provider**

在 `chat.module.ts` 顶部添加 import：

```typescript
import { ContextManagerService } from './services/context-manager.service';
import { TokenService } from '@common/utils/token.service';
```

在 `providers` 数组中添加 `ContextManagerService` 和 `TokenService`：

```typescript
providers: [
  ChatSessionService,
  ChatMessageService,
  ChatStreamService,
  AgentTraceService,
  MultiAgentOrchestratorService,
  EvalQueueService,
  EvalProcessorService,
  EvalPipelineService,
  GetChunkDetailTool,
  ModelConfigResolutionService,
  ContextManagerService,
  TokenService,
],
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/modules/chat/chat.module.ts
git commit -m "feat: 注册 ContextManagerService 和 TokenService 到 ChatModule"
```

---

### Task 3: 修改 LangGraph State — 添加 chatHistory 字段

**Files:**
- Modify: `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts:5,47-70,978-996`

- [ ] **Step 1: 添加 BaseMessage import**

在第 5 行，将 `HumanMessage, SystemMessage` 改为：

```typescript
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
```

- [ ] **Step 2: 在 AgentStateAnnotation 中添加 chatHistory**

在 `AgentStateAnnotation` 末尾（第 69 行 `retrievalRetryCount` 之后）添加：

```typescript
/** 对话历史消息（由 ContextManagerService 在 invoke 前构建，每轮覆盖） */
chatHistory: Annotation<BaseMessage[]>({
  default: () => [],
  reducer: (_, next) => next,
}),
```

- [ ] **Step 3: 在 graph.invoke() 初始状态中添加 chatHistory**

在第 978-996 行的 `graph.invoke({ })` 中添加：

```typescript
chatHistory: runCtx.chatHistory ?? [],
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts
git commit -m "feat: LangGraph State 新增 chatHistory 字段"
```

---

### Task 4: 修改 Rewrite prompt — 添加历史占位符

**Files:**
- Modify: `apps/server/src/modules/chat/prompts/rewrite.prompt.ts`

- [ ] **Step 1: 在 prompt 中追加历史上下文**

在 `REWRITE_SYSTEM_PROMPT` 的"【通用改写策略（所有类型适用）】"第 3 条后添加新规则。将第 15 行：

```
3. 将模糊指代具体化（如"它"→具体对象名）
```

改为：

```
3. 将模糊指代具体化（如"它"→具体对象名）— 结合对话历史消解指代
```

并在 Few-Shot 示例前（第 37 行附近）追加历史相关说明：

```typescript
【对话历史消解】
- 如果用户问题包含指代词（"那个"、"它"、"这个"、"上面提到的"等），请参考对话历史将其替换为具体对象
- 如果问题是前一轮问题的追问或细化，改写时应包含前文的关键实体信息
- 将依赖上下文的省略表达补全为独立、完整的检索查询
- 如果历史为空或无帮助，忽略即可

【Few-Shot 示例（带历史消解）】
对话历史：
用户: React和Vue的技术方案对比
助手: React采用JSX和虚拟DOM，Vue采用SFC模板和响应式系统...
用户问题："那个方案的成本更低？"
{
  "queries": [
    { "rewritten": "React 开发成本 人力投入", "focus": "React方案成本分析", "keywords": "React 开发成本 团队 学习曲线" },
    { "rewritten": "Vue 开发成本 人力投入", "focus": "Vue方案成本分析", "keywords": "Vue 开发成本 团队 上手难度" }
  ]
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/modules/chat/prompts/rewrite.prompt.ts
git commit -m "feat: Rewrite prompt 支持对话历史消解指代"
```

---

### Task 5: 修改 Rewrite 节点 — 注入历史到 prompt

**Files:**
- Modify: `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts:15-16,216-221`

- [ ] **Step 1: 添加 import**

在 orchestrator 文件顶部（第 15 行附近）添加：

```typescript
import { formatChatHistoryAsText } from './context-manager.service';
```

- [ ] **Step 2: 修改 rewriteQueryNode — 将历史格式化为文本注入 prompt**

在第 216-221 行的 `rewriteQueryNode`，将 prompt 构建改为包含历史。把：

```typescript
const result = await structured.invoke([
  new SystemMessage(`${REWRITE_SYSTEM_PROMPT}\n\n请以 JSON 格式回复。`),
  new HumanMessage(
    `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}`,
  ),
]);
```

改为：

```typescript
const historyText = formatChatHistoryAsText(state.chatHistory ?? []);

let systemPrompt = REWRITE_SYSTEM_PROMPT;
if (historyText) {
  systemPrompt = `${REWRITE_SYSTEM_PROMPT}\n\n当前对话历史：\n${historyText}\n---`;
}

const result = await structured.invoke([
  new SystemMessage(`${systemPrompt}\n\n请以 JSON 格式回复。`),
  new HumanMessage(
    `原始查询: ${state.originalQuery}\n意图类型: ${state.routedPlan?.questionType ?? 'fact_lookup'}`,
  ),
]);
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts
git commit -m "feat: Rewrite 节点使用对话历史做指代消解"
```

---

### Task 6: 修改 Writer 节点 — 注入历史到消息列表

**Files:**
- Modify: `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts:915-917`

- [ ] **Step 1: 修改 writer 节点的消息构建**

在第 915-917 行，将：

```typescript
const lcStream = await draftModel.stream([
  new SystemMessage(finalPrompt),
  new HumanMessage(s.originalQuery),
]);
```

改为：

```typescript
const messages: BaseMessage[] = [
  new SystemMessage(finalPrompt),
  ...(s.chatHistory ?? []),
  new HumanMessage(s.originalQuery),
];
const lcStream = await draftModel.stream(messages);
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts
git commit -m "feat: Writer 节点注入对话历史到 LLM 消息列表"
```

---

### Task 7: 修改 ChatStreamService — 调用 buildContext

**Files:**
- Modify: `apps/server/src/modules/chat/services/chat-stream.service.ts:2,27-38,92-99,201-236`

- [ ] **Step 1: 注入 ContextManagerService**

在文件顶部添加 import：

```typescript
import { ContextManagerService } from './context-manager.service';
```

在构造函数中添加依赖：

```typescript
private readonly contextManager: ContextManagerService,
```

- [ ] **Step 2: 修改 streamRagMode — 在创建用户消息前加载历史**

在 `streamRagMode` 方法中（第 99 行之前），权限检查后、创建用户消息前，添加 buildContext 调用。将：

```typescript
const userMsg = await this.chatMessageService.createUserMessage({
```

改为：

```typescript
const chatHistory = await this.contextManager.buildContext(dto.sessionId);

const userMsg = await this.chatMessageService.createUserMessage({
```

然后将 `orchestrator.streamRun()` 调用的 context 对象中添加 `chatHistory`。在 `runCtx` 对象中（约第 117-127 行）添加：

```typescript
chatHistory,
```

同时需要在 `AgentRunContext` 接口中添加该字段。修改 `apps/server/src/modules/chat/services/agent-trace.service.ts` 中的 `AgentRunContext` 接口：

```typescript
import type { BaseMessage } from '@langchain/core/messages';

export interface AgentRunContext {
  // ... 现有字段 ...
  chatHistory?: BaseMessage[];
}
```

- [ ] **Step 3: 修改 streamChatMode — 注入历史**

在第 233-236 行，添加 buildContext 调用。将：

```typescript
const messages: BaseMessage[] = [
  new SystemMessage(SYSTEM_PROMPT),
  new HumanMessage(dto.message),
];
```

改为：

```typescript
const chatHistory = await this.contextManager.buildContext(dto.sessionId);

const messages: BaseMessage[] = [
  new SystemMessage(SYSTEM_PROMPT),
  ...chatHistory,
  new HumanMessage(dto.message),
];
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/modules/chat/services/chat-stream.service.ts
git add apps/server/src/modules/chat/services/agent-trace.service.ts
git commit -m "feat: ChatStreamService 调用 buildContext 注入历史到两个模式"
```

---

### Task 8: 编译验证 + 回归测试

- [ ] **Step 1: 编译后端**

```bash
pnpm --filter server build
```
Expected: 无编译错误。

- [ ] **Step 2: 运行已有测试确认无回归**

```bash
pnpm --filter server test
```
Expected: 全部通过。

- [ ] **Step 3: 如果有失败的测试，修复后提交**

```bash
git add -A
git commit -m "fix: 编译/测试回归修复"
```

---

### Task 9: 编写单元测试

**Files:**
- Create: `apps/server/src/modules/chat/services/context-manager.service.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ContextManagerService, formatChatHistoryAsText } from './context-manager.service';
import { ChatMessageService } from './chat-message.service';
import { TokenService } from '@common/utils/token.service';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

describe('ContextManagerService', () => {
  let service: ContextManagerService;
  let chatMessageService: jest.Mocked<Pick<ChatMessageService, 'listMessages'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'tokenCount'>>;

  beforeEach(async () => {
    chatMessageService = { listMessages: jest.fn() };
    tokenService = { tokenCount: jest.fn((text: string) => text.length) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextManagerService,
        { provide: ChatMessageService, useValue: chatMessageService },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get(ContextManagerService);
  });

  describe('buildContext', () => {
    it('空历史返回空数组', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [],
        total: 0,
      });

      const result = await service.buildContext('session-1');
      expect(result).toEqual([]);
    });

    it('正常历史返回配对的 BaseMessage[]', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '问题1', messageStatus: 'completed' },
          { role: 'assistant', content: '回答1', messageStatus: 'completed' },
          { role: 'user', content: '问题2', messageStatus: 'completed' },
          { role: 'assistant', content: '回答2', messageStatus: 'completed' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      expect(result).toHaveLength(4);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[0].content).toBe('问题1');
      expect(result[1]).toBeInstanceOf(AIMessage);
      expect(result[1].content).toBe('回答1');
      expect(result[2]).toBeInstanceOf(HumanMessage);
      expect(result[2].content).toBe('问题2');
      expect(result[3]).toBeInstanceOf(AIMessage);
      expect(result[3].content).toBe('回答2');
    });

    it('过滤 streaming/aborted 状态的消息', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '问题1', messageStatus: 'completed' },
          { role: 'assistant', content: '回答1', messageStatus: 'completed' },
          { role: 'user', content: '问题2', messageStatus: 'completed' },
          { role: 'assistant', content: '', messageStatus: 'streaming' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      expect(result).toHaveLength(2); // 只保留第一轮
    });

    it('超出 token 上限时截断旧消息', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '短问题', messageStatus: 'completed' },
          { role: 'assistant', content: '短回答', messageStatus: 'completed' },
          { role: 'user', content: 'A'.repeat(5000), messageStatus: 'completed' },
          { role: 'assistant', content: 'B'.repeat(5000), messageStatus: 'completed' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      // 旧的小消息应该被截断（超出上限时从旧到新删除）
      expect(result.every((m) => m.content === '短问题' || m.content === '短回答')).toBe(false);
    });

    it('DB 异常时降级返回空数组', async () => {
      chatMessageService.listMessages.mockRejectedValue(new Error('DB down'));

      const result = await service.buildContext('session-1');
      expect(result).toEqual([]);
    });
  });

  describe('formatChatHistoryAsText', () => {
    it('空数组返回空字符串', () => {
      expect(formatChatHistoryAsText([])).toBe('');
    });

    it('格式化历史为文本', () => {
      const messages = [
        new HumanMessage('你好'),
        new AIMessage('你好！有什么可以帮助你的？'),
        new HumanMessage('介绍React'),
      ];
      const text = formatChatHistoryAsText(messages);
      expect(text).toContain('用户: 你好');
      expect(text).toContain('助手: 你好！有什么可以帮助你的？');
      expect(text).toContain('用户: 介绍React');
    });
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter server test -- --testPathPattern="context-manager"
```
Expected: 全部通过。

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/chat/services/context-manager.service.spec.ts
git commit -m "test: ContextManagerService 单元测试"
```

---

### Task 10: 端到端验证

- [ ] **Step 1: 启动依赖服务（如未启动）**

```bash
docker compose up -d
```

- [ ] **Step 2: 启动后端开发模式**

```bash
pnpm dev:server
```

- [ ] **Step 3: 手动测试两轮对话**

用 curl 或前端发起两轮请求：

```bash
# 第一轮
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"sessionId":"<sid>","message":"React和Vue的技术方案对比","chatMode":"rag","selectedKbIds":["<kbId>"]}' \
  --no-buffer

# 第二轮 — 应能理解"那个方案"指代第一轮的上下文
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"sessionId":"<sid>","message":"那个方案的成本更低？","chatMode":"rag","selectedKbIds":["<kbId>"]}' \
  --no-buffer
```

Expected: 第二轮的回复应关联第一轮内容，能够理解"那个方案"指代。

- [ ] **Step 4: 新会话回归测试**

新会话第一条消息应正常响应，无异常。

---

## 完成标准

- [ ] ContextManagerService 通过单元测试
- [ ] 已有测试无回归
- [ ] 多轮对话：第二轮回复能引用第一轮上下文
- [ ] 新会话首条消息行为不变
- [ ] 超长历史自动截断，不阻塞对话
- [ ] DB 异常时降级为空历史，对话继续
