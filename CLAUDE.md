# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 基础设施 (MySQL 13306, Qdrant 6333/6334, Redis 16379)
docker compose up -d

# 根目录
pnpm install                                  # 安装所有依赖
pnpm dev:server                              # 启动后端 (开发)
pnpm dev:web                                 # 启动前端 (开发)
pnpm build                                    # 构建所有子包

# 后端 (apps/server)
pnpm --filter server start:dev               # NestJS 开发模式
pnpm --filter server build                   # 编译
pnpm --filter server test                    # 运行所有单元测试
pnpm --filter server test -- -t "name"       # 运行单个测试
pnpm --filter server test:e2e                # E2E 测试
pnpm --filter server lint                    # ESLint
pnpm --filter server prisma generate         # 生成 Prisma Client
pnpm --filter server prisma migrate dev      # 执行迁移
pnpm --filter server debug:bailian-embedding # 百炼 Embedding 冒烟测试

# 前端 (apps/web)
pnpm --filter web dev                    # Vite 开发服务器
pnpm --filter web build                  # 类型检查 + 构建
pnpm --filter web preview                # 预览生产构建
```

## 架构概览

**Linsor AI (灵索智能)** — 基于 RAG 的多知识库智能问答系统。pnpm monorepo，`apps/server` (NestJS) + `apps/web` (Vue 3)。

### 后端分层

```
modules/           # 业务模块 (每个模块自含 controller/service/dto)
  auth/            # JWT 登录/注册/刷新/验证码
  user/            # 用户信息/密码管理
  email/           # 邮件发送
  knowledge-base/  # 知识库 CRUD
    member/        #   成员管理 + 邀请码加入
    permission/    #   声明式权限 (@KbPermission + Guard)
  chat/            # 对话模块 (会话/消息/流式/Agent 编排)
  rag/             # RAG 核心 (Embedding/ChatModel/检索流水线)
  document/        # 文档模块 (元数据/分片上传/处理流水线)
common/
  prisma/          # PrismaService (全局 DB 连接)
  vector/          # QdrantService (向量存储)
  storage/         # FileStorageService (本地文件存储)
  guards/          # AuthGuard (JWT), KbPermissionGuard (知识库 RBAC)
  interceptors/    # ResponseInterceptor (统一 Result 格式), LoggingInterceptor
  filter/          # AllExceptionsFilter (全局异常收口)
  decorators/      # @CurrentUser, @KbPermission
  utils/           # Result<T>, ErrorCode, BusinessException
  config/          # Winston 日志, env 校验 (Joi)
```

### API 约定

- 全局前缀 `/api`，CORS 允许所有来源
- 统一响应体: `{ success: boolean, code: number, message: string, data?: T }` (`Result<T>`)
- 业务异常统一抛出 `BusinessException(ErrorCode, message?)`，ErrorCode 枚举在 [errorCodeMap.ts](apps/server/src/common/utils/errorCodeMap.ts)
- 入参校验失败统一转为 `ErrorCode.PARAM_ERROR` (40000)
- 分片上传走 multipart，其余 JSON

### 文档处理流水线

`uploaded → parsing → chunking → embedding → ready`

- 由 BullMQ (Redis-backed) 驱动异步处理
- 状态机 + 版本号机制支持重解析 (`processing_version`)
- 每个阶段记录到 `b_document_processing_tasks` 表
- 超时扫描: `@Cron` 定时任务每隔一段时间检查心跳超时的任务

### 知识库权限模型

五类访问身份: `owner > manager > collaborator > member > publicVisitor`。
通过 `@KbPermission(...)` 装饰器 + `KbPermissionGuard` 声明式校验，角色层级比较逻辑在 `KbPermissionService`。

### 前端分层

```
src/
  api/             # 请求层: 自动注入 token、双 token 刷新、刷新排队
  stores/          # Pinia: auth, app, chat, kb
  router/          # Vue Router: guestOnly/requiresAuth 路由守卫
  views/           # 页面: auth (登录/忘记密码), chat, kb (列表/详情)
  modules/         # 功能模块: document-upload (分片上传 + Web Worker 计算文件哈希)
  components/      # 通用组件
  composables/     # 通用组合式函数
  layout/          # MainLayout
```

- 样式: Tailwind CSS v4 + "Kinetic Blueprint" 设计规范 (CSS 变量驱动的明暗双色主题)
- 请求层核心文件: [api.ts](apps/web/src/api/api.ts) — `apiRequest<T>` 自动处理 token 注入、401 刷新排队、二进制下载 (`apiRequestBlob`)

### 数据库

- MySQL 8.0 存储元数据，Prisma ORM，表名前缀: `b_` (业务表), `sys_` (系统表)
- Qdrant 存储文档分块向量
- Redis 用于 BullMQ 队列 + 会话缓存

### 流式通信协议 (AG-UI)

对话流式端点 `POST /api/chat/stream` 使用 **AG-UI (Agent-User Interaction Protocol)** 标准事件格式，原生 SSE 推送。

事件类型定义在 [agui-events.ts](apps/server/src/modules/chat/types/agui-events.ts)（后端）和 [stream.ts](apps/web/src/modules/chat/types/stream.ts)（前端）。

核心事件序列（RAG 模式）：
```
RUN_STARTED
  STEP_STARTED("route")   → STEP_FINISHED (intent, questionType)
  STEP_STARTED("rewrite") → STEP_FINISHED (queries)
  TOOL_CALL_START("search_knowledge_base") → TOOL_CALL_RESULT (hitCount, durationMs)
  TOOL_CALL_START("web_search")            → TOOL_CALL_RESULT (条件)
  STEP_STARTED("writer")  → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT × N → TEXT_MESSAGE_END
  STEP_FINISHED("writer")
RUN_FINISHED
```

- 非流式节点 (route, rewrite, tools) 发 `STEP_STARTED` → 等待完成 → `STEP_FINISHED`（带结果）
- 流式节点 (writer) 发 `TEXT_MESSAGE_CONTENT` 逐 token 推送，前端通过 [useStreamingMarkdown](apps/web/src/modules/chat/composables/useStreamingMarkdown.ts) 累积渲染
- Agent 步骤面板在 [AIMessageItem.vue](apps/web/src/components/chat/AIMessageItem.vue) 中渲染

