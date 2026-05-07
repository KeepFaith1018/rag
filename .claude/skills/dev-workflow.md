---
name: dev-workflow
description: 开发工作流规范 — 当用户要求实现功能、修复bug、重构代码时使用。涵盖 TDD、TypeScript类型、注释规范、提交风格、文档回写等完整开发流程。
---

# 开发工作流

## 核心原则

### TDD（测试先行）
- 先写测试用例 → 确认测试失败 → 实现代码 → 确认测试通过
- 测试优先级：单元测试 > E2E 测试
- 运行测试：
  ```bash
  pnpm --filter server test                    # 全量测试
  pnpm --filter server test -- -t "TestName"   # 按名称筛选
  npx jest -t "TestName"                       # 在 apps/server 目录下
  ```
- 测试覆盖要求：正常路径 + 边界情况 + 退化输入（空值/空数组）

### TypeScript 类型
- 类型必须完备，禁止使用 `any` 除非有充分理由
- 新增 interface/type 必须声明完整字段和类型
- 使用 `Record<string, unknown>` 处理未知 JSON 数据
- 使用 `??` 和可选链安全处理可能为 null/undefined 的值

### 注释规范
- 函数/类级别使用 `/** */` JSDoc 格式（中文）
- 关键代码逻辑使用 `//` 单行注释（中文）
- 不解释代码做了什么（WHAT），只解释为什么这样做（WHY）
- 特殊标记用：`// O7: 标题路径加权` 等优化编号标记

## 开发流程

### 1. 规划阶段
- 复杂任务（>3 文件变更或多模块改动）必须先出计划
- 计划内容：背景 → 架构设计 → 实施步骤 → 测试策略 → 验证方案
- 使用 `EnterPlanMode` 让用户审查计划
- 计划通过后再开始写代码

### 2. 实现阶段
- 遵循项目已有模式复用，避免引入新抽象
- 代码分层：Controller → Service → Prisma / 外部 API
- 错误处理：统一使用 `BusinessException(ErrorCode, { message, context })`
- 日志：通过 `@Inject(WINSTON_MODULE_PROVIDER)` 注入 Winston logger
- NestJS DI：所有依赖通过 constructor 注入

### 3. 验证阶段
- 运行相关测试套件，确认无回归
- 运行 `pnpm --filter server build` 确认编译通过
- ESLint：运行 `pnpm --filter server lint` 或确保 pre-commit hook 通过

### 4. 文档阶段
- 更新 `docs/` 下对应的优化/功能文档
- 记录：日期、改动文件、变更要点、验收结果

### 5. 提交阶段
- 提交格式：`feat: <简短描述>`
- 描述用中文，关键英文术语保留（如 TDD, ESLint）
- 多层变更用列表总结（`P0: ... P1: ... P2: ...`）
- 不要 amend 已有提交，始终创建新提交
- 提交前运行完整测试

## 项目约定

### 技术栈
- pnpm monorepo：`apps/server` (NestJS) + `apps/web` (Vue 3)
- 数据库：MySQL 8.0 (Prisma ORM)，表名前缀 `b_` / `sys_`
- 向量库：Qdrant + Elasticsearch
- 队列：BullMQ (Redis-backed)
- Embedding/Rerank：阿里云百炼 API

### 关键路径
```
apps/server/src/modules/          # 业务模块
  document/                       # 文档模块（解析/切块/向量化流水线）
  rag/                            # RAG 核心（Embedding/ChatModel/检索）
    retrieval/                    # 检索流水线（Dense → Sparse → RRF → Rerank）
  chat/                           # 对话模块（AG-UI 流式协议）
common/                           # 通用基础设施
  prisma/                         # PrismaService
  vector/                         # QdrantService / ElasticsearchService
  utils/                          # Result<T> / ErrorCode / BusinessException
```

### 检索加权原则
- 所有权重单项 ≤ 1.10，组合最高 ≤ 1.15
- 对缺失元数据安全回退到 ×1.0（不改变原有分数）
- 加权逻辑放在 Fusion（融合阶段）和 Rerank（精排阶段）
- 新字段通过 Qdrant payload 和 ES metadata 传递

### 分块原则
- 三层粒度：L1(~1200t) → L2(~600t) → L3(~300t)，仅 L3 做 embedding
- Token 计数：tiktoken `cl100k_base`
- 中文分隔符优先（15 级）：`\n\n` → `\n` → `。` → `！` → ...
- 代码块/表格块作为原子单元不拆分
- 自适应 Profile：default / code-heavy / verbose / compact

## 工具使用

### 本地通知
- Windows Hook：`PermissionRequest` 事件触发 PowerShell 通知
- 脚本位置：`~/.claude/hooks/notify.ps1`
- 通知只在系统弹权限确认框时触发，Bypass 模式不触发

### 测试常用命令
```bash
# chunk service 测试
npx jest -t "DocumentChunkService"
# fusion 服务测试
npx jest -t "FusionService"
# rerank 服务测试
npx jest -t "RerankService"
# 全量
npx jest
```
