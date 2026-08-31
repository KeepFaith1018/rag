# AGENTS.md

此文件为 Codex 提供本仓库的工作指引。

## AI 临时文档工作区

- 仓库根目录下的 `.ai-workspace/` 是 coding 过程中与 AI 协作产生文档的临时工作区。
- 除非用户明确指定其他路径，对话过程中新增的 `.md` 文档必须写入 `.ai-workspace/`。
- `.ai-workspace/` 已被 Git 忽略，其中的内容不得作为项目正式文档提交。
- 需要长期保留的文档，应在用户明确确认后移动到 `docs/` 或对应模块的 `docs/` 目录。
- 不要创建或恢复已删除的 `.ai/` 目录。

## 正式文档规范

- `docs/` 只保存描述当前系统的正式文档，不保存 coding 计划、实施步骤、阶段总结、调研过程或临时 TODO。
- `docs/` 下的文件夹和 Markdown 文件必须以两位数字和连字符作为排序前缀，例如 `10-部署/`、`05-RAG检索设计.md`。
- `docs/` 中每份 Markdown 必须在文件开头包含 YAML Front Matter，至少包含以下字段：

```yaml
---
title: 文档标题
type: index | requirements | architecture | data-model | engineering-guide | technical-design | design-system
status: draft | active | deprecated
maintainer: project-team
updated: YYYY-MM-DD
source_of_truth: repository-or-code-path
---
```

- 新建、重命名或删除正式文档时，必须同步更新 `docs/00-文档索引.md` 和所有受影响的链接。
- 正式文档只描述当前事实、稳定约定和关键设计决策；已经完成的计划和实施过程由 Git 历史追溯。
- 代码、Prisma Schema 与文档冲突时，以代码和数据库迁移为准，并在同一变更中更新文档。

## 常用命令

```bash
# 基础设施 (MySQL 13306 / Qdrant 16333-16334 / Redis 16379 / ES 19200 / MinIO 19000-19001)
docker compose up -d

# 安装与构建
pnpm install                       # 安装所有依赖
pnpm build                         # 构建所有子包

# 开发
pnpm dev:server                    # 后端 NestJS 开发模式
pnpm dev:web                       # 前端 Vue 3 开发模式

# 后端 (apps/server)
pnpm --filter server start:dev     # NestJS 开发
pnpm --filter server build         # 编译
pnpm --filter server test          # 单元测试 (Jest)
pnpm --filter server test:e2e      # E2E 测试
pnpm --filter server lint          # ESLint
pnpm --filter server prisma generate   # 生成 Prisma Client
pnpm --filter server prisma migrate dev # 执行迁移

# 前端 (apps/web)
pnpm --filter web dev              # Vite 开发
pnpm --filter web build            # 类型检查 + 构建
```

## 架构概览

**Linsor AI (灵索智能)** — 基于 RAG 的多知识库智能问答系统。pnpm monorepo，`apps/server` (NestJS)、`apps/web` (Vue 3)。

### 后端模块

```
modules/
  auth/               # JWT 认证 (登录/注册/刷新/验证码)
  user/               # 用户信息/密码管理/重置密码
  email/              # Nodemailer SMTP 邮件验证码
  knowledge-base/     # 知识库 CRUD + 邀请码加入
    member/           #   成员管理 (owner/manager/collaborator/member)
    permission/       #   声明式权限 (@KbPermission + Guard)
  chat/               # 对话模块
    services/         #   multi-agent-orchestrator (14 节点 LangGraph)
                      #   chat-stream (AG-UI SSE 流式)
                      #   eval-pipeline/eval-queue/eval-processor (LLM-as-Judge 评估)
  rag/                # RAG 核心
    ai/               #   Embedding (百炼 text-embedding-v4) + ChatModel + 模型配置
    retrieval/        #   dense (Qdrant) + sparse (ES) + fusion (RRF + 香农熵)
                      #   + rerank (qwen3-rerank) + small-to-big 扩展
  document/           # 文档模块
    upload/           #   分片上传 (断点续传/秒传)
    services/         #   解析 → 分块 → 嵌入 → 索引 流水线
                      #   处理监控 (超时扫描) + SSE 进度推送
    processor/        #   BullMQ Worker (文档处理消费者)
    queue/            #   BullMQ Queue (文档处理入队)
  admin/              # 后台管理模块 (后端 API)
    auth/             #   管理员认证
    admin-user/       #   管理员 CRUD (super_admin 权限)
    user/             #   前台用户管理
    model-config/     #   系统模型配置管理
    public-kb/        #   公开知识库管理
    public-kb-doc/    #   公开知识库文档管理
    audit-log/        #   审计日志
    dict/             #   字典管理
common/
  prisma/             # PrismaService (全局)
  vector/             # QdrantService + ElasticsearchService
  storage/            # FileStorageService (本地文件存储)
  cache/              # RedisCacheService
  guards/             # AuthGuard (JWT), KbPermissionGuard, AdminAuthGuard
  interceptors/       # ResponseInterceptor, LoggingInterceptor
  filter/             # AllExceptionsFilter
  decorators/         # @CurrentUser, @KbPermission
  config/             # Winston 日志, Joi env 校验
  utils/              # Result<T>, ErrorCode, BusinessException, AES 加密, tiktoken
```

### API 约定

- 全局前缀 `/api`，CORS 允许所有来源
- 统一响应体: `{ success: boolean, code: number, message: string, data?: T }` (`Result<T>`)
- 业务异常: `throw new BusinessException(ErrorCode, message?)`
- 入参校验: 由 `ValidationPipe` 统一处理，失败返回 `ErrorCode.PARAM_ERROR` (40000)
- 分片上传走 multipart，其余 JSON

### 文档处理流水线

`uploaded → parsing → chunking → embedding → ready`

- BullMQ (Redis-backed) 异步驱动，每阶段落 `b_document_processing_tasks` 记录
- 状态机 + `processing_version` 支持重解析（旧版本向量/ES 先删再重新入队）
- `DocumentProcessingMonitorService` 定时扫描心跳超时任务

### 知识库权限模型

五类访问身份: `owner > manager > collaborator > member > publicVisitor`。
通过 `@KbPermission(...)` 装饰器 + `KbPermissionGuard` 声明式校验。
12 个权限标记位 (canUploadDocument, canDeleteAnyDocument, canManageMembers 等)。

### RAG 检索流水线

```
用户问题 → 路由 (route) → 分解/重写 (decompose/rewrite)
  → 稠密检索 (Qdrant) + 稀疏检索 (ES/Tavily)
  → RRF 融合 (香农熵置信度加权)
  → 重排序 (qwen3-rerank)
  → Small-to-Big 扩展
  → 生成 (writer)
  → 事实核查 (fact_check) → 补充检索 (supplement_retrieval) [条件]
  → 完整性检查 (completeness) → 补充回答 [条件]
```

共 14 个 LangGraph 节点，由 `MultiAgentOrchestratorService` 编排。

### 流式通信协议 (AG-UI)

对话流式端点 `POST /api/chat/stream` 使用 **AG-UI** 标准事件格式，原生 SSE 推送。

事件序列（RAG 模式）：
```
RUN_STARTED
  STEP_STARTED("route") → STEP_FINISHED
  STEP_STARTED("rewrite") → STEP_FINISHED
  TOOL_CALL_START("search_knowledge_base") → TOOL_CALL_RESULT
  TOOL_CALL_START("web_search") → TOOL_CALL_RESULT (条件)
  STEP_STARTED("writer") → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT × N → TEXT_MESSAGE_END
  VALIDATION_STARTED → VALIDATION_COMPLETED
RUN_FINISHED
```

### 离线评估

每次 RAG 对话完成后自动入队评估任务 (BullMQ)，用轻量 LLM 打分三项指标：
- **Faithfulness** — 回答是否基于检索上下文（有无幻觉）
- **Answer Relevancy** — 回答是否切题完整
- **Context Recall** — 检索上下文是否覆盖回答所需信息

结果回写到 `b_agent_runs.metadata_json.evalMetrics`。

### 前端分层

```
src/
  api/             # 请求层: apiRequest<T> + 双 token 刷新 + 刷新排队
  stores/          # Pinia: auth, chat, app, model-config
  router/          # Vue Router: guestOnly/requiresAuth 守卫
  views/           # auth (登录/忘记密码) / chat / kb (列表/详情)
  modules/
    chat/          # 对话模块: composables (useAgentChat, useStreamingMarkdown)
                   #           types (AG-UI 事件, 消息类型)
                   #           utils (Shiki 高亮)
    document-upload/  # 分片上传: useChunkUpload + Web Worker 哈希
  components/      # 通用组件: chat (17), ui (6), kb (2), layout (6)
  composables/     # 通用组合式函数: useMessage, useConfirmDialog, useVerificationCountdown 等
  layout/          # MainLayout (侧边栏 + 主内容区)
```

- 样式: Tailwind CSS v4 + "Kinetic Blueprint" 设计规范
- 流式 Markdown: `@incremark/core` 增量解析 → `MarkdownRenderer.vue` 块级渲染
- 代码高亮: Shiki (按需加载, 11 种语言, 双主题)
- 字体: Inter + Space Grotesk + Material Symbols 图标

### 数据库

- MySQL 8.0 存储元数据，Prisma ORM，表名前缀: `b_` (业务表), `sys_` (系统表)
- Qdrant 存储稠密向量，Elasticsearch 存储稀疏索引
- Redis 用于 BullMQ 队列 + 会话缓存 + Embedding 缓存

### 基础设施 (docker compose)

| 服务 | 端口 | 说明 |
|------|------|------|
| MySQL | 13306 | rag_mysql (root:rag_mysql) |
| Qdrant | 16333/16334 | rag_qdrant (api-key: rag_qdrant) |
| Redis | 16379 | rag_redis (password: rag_redis) |
| Elasticsearch | 19200 | rag_es (单节点, 安全已禁用) |
| MinIO | 19000/19001 | rag_minio (API/控制台, root:rag_minio) |
