# Chat 模块阶段一实施记录

## 概述

按照《[12-agentic-rag-detailed-design-2026-04-27.md](../../../docs/12-agentic-rag-detailed-design-2026-04-27.md)》中阶段一的规划，完成 Chat 模块底座搭建。数据库迁移此前已完成，本次聚焦于代码层面四项任务的落地。

## 完成清单

### 1. ResponseInterceptor 绕过机制

**问题**：全局 `ResponseInterceptor` 会包装所有成功响应为 `Result.success(data)`，但 SSE 流式接口需要直接控制响应输出。

**方案**：新建 `@SkipResponseTransform()` 装饰器，通过 `Reflector` 读取元数据，命中时跳过包装。

涉及文件：
- `src/common/decorators/skip-response-transform.decorator.ts` — 新建
- `src/common/interceptors/response.interceptor.ts` — 修改，注入 `Reflector` 并增加跳过判断

### 2. ChatModule 建立

模块目录 `src/modules/chat/`：

```
chat/
├── dto/
│   ├── create-chat-session.dto.ts
│   ├── list-chat-sessions.dto.ts
│   ├── stream-chat.dto.ts
│   └── rename-chat-session.dto.ts
├── interfaces/
│   ├── chat-session-summary.interface.ts
│   ├── chat-message-item.interface.ts
│   └── stream-run-context.interface.ts
├── services/
│   ├── chat-session.service.ts
│   ├── chat-message.service.ts
│   └── chat-stream.service.ts
├── chat.controller.ts
└── chat.module.ts
```

**API 端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat/sessions` | 创建会话 |
| GET | `/api/chat/sessions` | 会话列表（分页） |
| GET | `/api/chat/sessions/:sessionId` | 会话详情 |
| PATCH | `/api/chat/sessions/:sessionId` | 重命名会话 |
| GET | `/api/chat/sessions/:sessionId/messages` | 消息历史（分页） |
| POST | `/api/chat/stream` | 流式对话（SSE） |

**服务职责划分**：

- `ChatSessionService` — 会话 CRUD，归属校验（`assertSessionOwnership`）
- `ChatMessageService` — 消息持久化：用户消息创建、助手占位创建、流式完成/中断标记
- `ChatStreamService` — 流式编排：鉴权 → 创建双端消息 → SSE 流式输出 → 收尾持久化

### 3. 流式接口打通

- 协议：AI SDK data stream（`0:` 文本增量，`8:` 自定义 data parts）
- 自定义事件类型：`agent-status`（phase: planning/retrieving/writing/done）、`agent-warning`
- 生命周期：用户消息 → 助手占位（status=streaming）→ 逐字推送 → 完成时持久化最终内容
- 断连处理：监听 `res.close`，中断时标记 `aborted`
- Phase 1 阶段返回占位回答，后续阶段接入 LLM 与 RAG 检索链路

### 4. Qdrant 检索能力补齐

- `QdrantService.searchChunkVectors()` — 支持多知识库 filter、topK、scoreThreshold
- `DenseHit` 接口 — 标准化检索命中结构（pointId / kbId / docId / chunkId / content / score / payload）
- `KbPermissionService.authorizeMany()` — 批量知识库鉴权，供流式对话中校验 RAG 模式下的多知识库选择

### 5. AppModule 注册

- `ChatModule` 已注册到 `app.module.ts` 的 imports 中
- `ResponseInterceptor` 的 `Reflector` 依赖由 NestJS 核心自动注入

## 关键设计决策

1. **会话与知识库解耦**：会话不再绑定默认知识库（`kb_id` 保留为可空字段），知识库选择下沉到消息级字段 `selected_kb_ids_json`
2. **消息显式记录模式**：每条消息独立记录 `chat_mode`（chat/rag），同会话内可混合普通对话与 RAG 消息
3. **流式绕过统一包装**：通过声明式装饰器而非硬编码路径判断，后续其他 SSE/WebSocket 端点可复用

## 验证结果

- TypeScript 编译通过（`pnpm --filter backend build`）
- 数据库模型（`b_chat_sessions`、`b_chat_messages`、`b_chat_message_citations`、`b_agent_runs`）在此前迁移中已就绪

## 补充记录：ChatModelService 抽离（2026-04-28）

### 背景

原先 `chat-stream.service.ts` 通过 `@Inject('CHAT_MODEL')` 直接注入 `ChatOpenAI` 实例，该实例在 `chat.module.ts` 的工厂函数中一次性创建，模型名称写死。存在以下问题：

- 模型类型由启动配置固定，用户无法按请求选择不同模型
- 模型能力开关（thinking/vision/toolCalling 等）无法按模型动态判断
- 后续组织对话 Chain 需要更灵活的模型实例创建方式

### 方案

将对话模型的创建逻辑抽离为独立的 `ChatModelService`，归属于 `AiModule`（与 `EmbeddingService` 并列）：

**ChatModelService** (`src/modules/ai/chat-model.service.ts`)：
- `createModel(options?)` — 按运行时选项动态创建 `ChatOpenAI` 实例，选项优先级：调用方传入 > 环境变量 > 硬编码兜底
- `getDefaultModelName()` — 获取系统默认模型名称
- `getModelCapabilities(modelName)` — 返回模型能力开关 `{ thinking, vision, toolCalling, streaming }`
- `isCapabilityEnabled(modelName, capability)` — 判断指定能力是否开启

涉及文件：
- `src/modules/ai/chat-model.service.ts` — 新建
- `src/modules/ai/ai.module.ts` — 修改，新增 `ChatModelService` 到 providers/exports
- `src/modules/chat/services/chat-stream.service.ts` — 修改，改为注入 `ChatModelService`，在 `streamChat()` 中动态创建模型实例
- `src/modules/chat/chat.module.ts` — 修改，移除 `CHAT_MODEL` 工厂 provider，改为 `imports: [AiModule]`
- `.env` — 新增 `LLM_MODEL`、`OPENAI_API_KEY`、`OPENAI_BASE_URL` 环境变量
- `src/common/config/env.validation.ts` — 新增对应 Joi 校验

### 架构收益

1. **模型可切换**：后续阶段可从 `StreamChatDto.modelConfigId` 解析用户选择的模型，传入 `createModel()` 即可
2. **能力可查询**：通过 `getModelCapabilities()` 可在运行时判断当前模型是否支持思考/视觉/工具调用，避免无效调用
3. **Chain 可扩展**：`ChatModelService` 作为模型实例的统一入口，后续构建 LangChain Chain 时直接复用
4. **职责清晰**：AI 底层能力集中到 `AiModule`，业务模块（chat/rag）只需注入服务即可

## 后续阶段

参见《12-agentic-rag-detailed-design》的阶段二至阶段五：

- 阶段二：Dense/Sparse 检索 + RRF 融合 + Rerank
- 阶段三：Agent 工作流（Router/Rewrite/Decomposition/Relevance/Fact/Completeness Check）
- 阶段四：前端联调
- 阶段五：治理与优化
