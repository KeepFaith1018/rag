# Linsor AI 项目全面审计报告

> **审计日期**: 2026-06-17
> **审计范围**: 配置合理性、文档可读性、初始化脚本、数据库表设计

---

## 一、配置文件评估



### 1.2 .env.example (server)

| 维度 | 评价 | 详情 |
|------|------|------|
| 分组清晰度 | ✅ 优秀 | 按模块分段，带装饰线，一目了然 |
| 变量覆盖 | ✅ 完整 | 覆盖了数据库/缓存/向量库/JWT/加密/LLM/邮件/ES/文档处理/Tavily/CORS |
| 安全提示 | ⚠️ 不足 | 缺少对 `ENCRYPTION_KEY`、`TRANSMISSION_SECRET` 最小长度/复杂度的注释 |
| 与 Joi 校验对齐 | ❌ 不一致 | `.env.example` 有 `DATABASE_HOST/PORT/USER/PASSWORD/NAME`，但 Joi 校验要求 `DATABASE_URL`（根据安全加固设计文档所述） |

**问题清单**:

1. **数据库名不一致**: `.env.example` 写 `DATABASE_NAME=rag_db`，`docker-compose.yml` 创建的是 `rag_kb`。
2. **缺少 `admin` 应用的 `.env.example`**: `apps/admin` 目录不存在。
3. **`BAILIAN_EMBEDDING_DIMENSIONS`** 等高级配置缺少注释说明含义和取值范围。

### 1.3 .env.example (web)

仅 2 行，简洁合理。但 `VITE_TRANSMISSION_SECRET` 嵌入客户端 bundle 不是真正秘密，缺少注释说明安全边界。

### 1.4 package.json (根)

| 维度 | 评价 | 详情 |
|------|------|------|
| 脚本覆盖 | ⚠️ 不完整 | 缺少 `db:generate`、`db:migrate`、`db:seed`、`init` 等初始化脚本 |
| `dev:admin` | ❌ 无效 | `apps/admin` 目录不存在，脚本会报错 |
| `clean` | ✅ 有 | `pnpm -r exec rm -rf dist node_modules` |
| `prepare` | ✅ 有 | `husky` git hooks |

---

## 二、文档评估

### 2.1 README.md

| 维度 | 评分 | 说明 |
|------|------|------|
| 项目定位 | ⭐⭐⭐⭐⭐ | 一句话说清"是什么"，核心特性列表全面 |
| 技术栈表格 | ⭐⭐⭐⭐⭐ | 清晰分层，一表概览 |
| 快速开始 | ⭐⭐⭐⭐ | 步骤清晰，但缺少"一键初始化"脚本 |
| 项目结构 | ⭐⭐⭐ | 提到 `apps/admin` 和 `apps/experiment` 但实际不存在 |
| 文档索引 | ⭐⭐⭐⭐⭐ | 完整链接到 docs/ 下所有文档 |
| 徽章/截图 | ⭐⭐ | 缺少 CI 状态徽章、截图/GIF 演示 |

**关键问题**:

- `apps/admin` 和 `apps/experiment` 在 README 中列出但目录不存在，对新开发者造成困惑。
- 缺少"一键初始化"命令（如 `pnpm init:dev`），新开发者需要手动执行多个步骤。
- 没有生产部署指南。

### 2.2 docs/ 目录

| 维度 | 评分 | 说明 |
|------|------|------|
| 组织结构 | ⭐⭐⭐⭐⭐ | 6 个分类目录（需求/架构/设计/变更/资产/参考），层次清晰 |
| 文档数量 | ⭐⭐⭐⭐⭐ | 40+ 篇文档，覆盖需求→设计→实现→优化全链路 |
| 数据库设计文档 | ⭐⭐⭐⭐ | 与实际 Prisma schema 基本一致，但有几处过时（见下文） |
| docs/README.md | ⭐⭐⭐⭐⭐ | 完整索引，分类清晰，链接正确 |
| 时效性 | ⭐⭐⭐ | 部分文档提到的字段与实际 schema 不一致 |

### 2.3 数据库设计文档 vs 实际 Schema 差异

| 文档描述 | 实际 Schema | 状态 |
|----------|-------------|------|
| `b_users` 有 `daily_chat_limit`/`token_quota`/`used_tokens` | 已迁移到 `b_user_daily_quotas` 表 | 文档过时 |
| `sys_model_configs` 有 `api_key` 字段 | 实际已移除（密钥从 .env 读取），改名 `api_key` → 无 | 文档过时 |
| `b_documents` 缺少 `uploader_id` | 实际已有 | 文档建议已实现 |
| `b_document_chunks` 缺少 `page_no`/`char_start`/`char_end`/`vector_id`/`metadata_json` | 实际已有 | 文档建议已实现 |
| 未提及 `b_upload_sessions`/`b_upload_chunks` | 实际存在 | 文档缺失 |
| 未提及 `b_document_processing_tasks` | 实际存在 | 文档缺失 |
| 未提及 `b_agent_runs`/`b_agent_steps` | 实际存在 | 文档缺失 |
| 未提及 `b_document_chunk_search_index` | 实际存在 | 文档缺失 |
| 未提及 `b_chat_message_citations` | 实际存在 | 文档缺失 |
| 未提及 `b_user_daily_quotas` | 实际存在 | 文档缺失 |

---

## 三、初始化脚本评估

### 3.1 现状

当前项目**没有**一键初始化脚本。新开发者需要：

1. `docker compose up -d`
2. `pnpm install`
3. `cd apps/server && pnpm prisma generate && pnpm prisma migrate dev`
4. 手动创建 `.env` 文件（从 `.env.example` 复制）
5. 分别在 3 个终端启动 server/web/admin

**缺失项**:

| 缺失脚本 | 重要性 | 说明 |
|----------|--------|------|
| `pnpm init:dev` | 🔴 高 | 一键初始化：复制 .env → docker up → prisma generate + migrate → seed |
| `pnpm db:seed` | 🔴 高 | 种子数据：创建默认管理员、系统模型配置、字典数据 |
| `pnpm db:reset` | 🟡 中 | 重置数据库（prisma migrate reset） |
| `pnpm db:studio` | 🟡 中 | 打开 Prisma Studio 可视化管理 |
| `Makefile` 或 `scripts/` | 🟡 中 | 集装常用运维命令 |
| 生产部署脚本 | 🟡 中 | Dockerfile / docker-compose.prod.yml |

### 3.2 建议的脚本设计

```bash
# package.json 新增脚本
"scripts": {
  "init:dev": "cp -n apps/server/.env.example apps/server/.env && cp -n apps/web/.env.example apps/web/.env && docker compose up -d && pnpm install && pnpm --filter server prisma generate && pnpm --filter server prisma migrate dev && pnpm db:seed",
  "db:generate": "pnpm --filter server prisma generate",
  "db:migrate": "pnpm --filter server prisma migrate dev",
  "db:seed": "pnpm --filter server prisma db seed",
  "db:reset": "pnpm --filter server prisma migrate reset",
  "db:studio": "pnpm --filter server prisma studio"
}
```


---

## 四、数据库表完整性与设计分析

### 4.1 表清单总览

当前 Prisma schema 共定义 **21 个模型（表）**：

| 模块 | 表名 | 前缀 | 必要性 |
|------|------|------|--------|
| 用户与认证 | `b_users` | b_ | ✅ 核心 |
| | `sys_admins` | sys_ | ✅ 核心 |
| | `sys_email_codes` | sys_ | ✅ 核心 |
| | `b_user_sessions` | b_ | ✅ 核心 |
| | `sys_admin_sessions` | sys_ | ✅ 核心 |
| 大模型配置 | `sys_model_configs` | sys_ | ✅ 核心 |
| | `b_user_model_configs` | b_ | ✅ 核心 |
| | `b_user_daily_quotas` | b_ | ✅ 核心 |
| 知识库与协作 | `b_knowledge_bases` | b_ | ✅ 核心 |
| | `b_kb_members` | b_ | ✅ 核心 |
| | `b_kb_invitations` | b_ | ✅ 核心 |
| 文档与分块 | `b_documents` | b_ | ✅ 核心 |
| | `b_upload_sessions` | b_ | ✅ 核心 |
| | `b_upload_chunks` | b_ | ✅ 核心 |
| | `b_document_chunks` | b_ | ✅ 核心 |
| | `b_document_chunk_search_index` | b_ | ❌ 冗余（代码零引用） |
| | `b_document_processing_tasks` | b_ | ✅ 核心 |
| 聊天与溯源 | `b_chat_sessions` | b_ | ✅ 核心 |
| | `b_chat_messages` | b_ | ✅ 核心 |
| | `b_chat_message_citations` | b_ | ✅ 核心 |
| | `b_agent_runs` | b_ | ✅ 核心 |
| | `b_agent_steps` | b_ | ✅ 核心 |
| 系统与审计 | `sys_audit_logs` | sys_ | ✅ 核心 |
| | `sys_dict_type` | sys_ | ✅ 核心 |
| | `sys_dict_item` | sys_ | ✅ 核心 |

### 4.2 冗余/可疑表分析

#### `b_document_chunk_search_index` — ⚠️ 可能冗余

```prisma
model b_document_chunk_search_index {
  chunk_id      BigInt   @id
  doc_id        BigInt
  kb_id         BigInt
  title         String?  @db.VarChar(255)
  title_path    String?  @db.VarChar(500)
  content_plain String   @db.LongText
  keyword_text  String?  @db.Text
  created_at    DateTime @default(now()) @db.DateTime(0)
}
```

**问题**:
- 该表存储 chunk 的纯文本副本，但 `b_document_chunks.content` 已经存储了相同内容。
- 项目已使用 Elasticsearch 作为稀疏检索引擎，ES 本身就有全文索引能力。
- 该表没有外键约束，没有 Prisma relation，孤立存在。
- **代码搜索确认**: 在整个 `apps/server/src` 中搜索 `document_chunk_search_index` / `chunk_search_index` / `search_index`，**零引用**。此表完全未被使用。
- **结论**: 此表为**确认冗余**，可安全移除。

#### `b_agent_steps` — ✅ 有价值但缺少外键

该表记录 LangGraph 每个节点的执行详情，对调试和可观测性很有价值。但：
- `run_id` 字段没有 Prisma relation 关联到 `b_agent_runs`，也没有外键约束。
- 建议添加 `@@index([run_id])` 外的 relation 声明，确保数据一致性。

### 4.3 表设计问题

#### 问题 1: `b_chat_sessions.kb_id` 冗余

```prisma
model b_chat_sessions {
  kb_id BigInt?  // ← 可选，关联单个知识库
  ...
}
```

当前 Agentic RAG 支持多知识库检索，`b_chat_messages` 已有 `selected_kb_ids_json` 和 `resolved_kb_ids_json` 字段存储多知识库选择。`b_chat_sessions.kb_id` 只能存一个，语义不完整。建议：
- 保留 `kb_id` 作为"默认知识库"（兼容单库场景）
- 或移除，统一使用 message 级别的多库字段

#### 问题 2: 枚举值使用字符串而非数据库枚举

所有状态/角色字段（`status`、`role`、`visibility`、`embedding_status` 等）都是 `String` 类型，依赖应用层校验。

**优点**: 灵活，无需 migration 即可扩展枚举值。
**缺点**: 数据库层面无约束，脏数据可直接插入。`sys_dict_type`/`sys_dict_item` 表存在但未被这些字段引用。

**建议**: 至少在 Prisma schema 中使用 `@db.VarChar(N)` 限制长度，并在应用层用 Joi/class-validator 严格校验。或者考虑将关键枚举（如 `role`、`status`）迁移到字典表管理。

#### 问题 3: `b_user_daily_quotas` 无清理机制

该表每天每个用户产生一条记录，长期运行会持续增长。建议添加定时任务清理超过 90 天的历史配额记录。

#### 问题 4: BigInt 主键的 JSON 序列化

所有 `BigInt` 主键在通过 API 返回时需要转为 string，否则 `JSON.stringify` 会报错。确认全局有 `BigInt.prototype.toJSON` polyfill 或统一的序列化拦截器。

#### 问题 5: 缺少 `deleted_at` 软删除字段

所有表都是硬删除。`b_users`、`b_knowledge_bases`、`b_documents` 等核心表没有软删除支持。当前通过 `CASCADE` 删除关联数据，数据一旦删除不可恢复。

**建议**: 对 `b_users`、`b_knowledge_bases` 添加 `deleted_at` 字段，配合全局过滤器实现软删除。

### 4.4 索引设计评估

| 表 | 索引覆盖 | 评价 |
|----|----------|------|
| `b_users` | `uk_email` | ✅ 够用 |
| `b_kb_members` | `uk_kb_user` + `fk_member_user` | ✅ 完善 |
| `b_documents` | `idx_kb_id` + `idx_doc_uploader_id` + `idx_doc_kb_uploader` | ✅ 完善 |
| `b_document_chunks` | `idx_doc_chunk` + `idx_chunk_vector_id` + `idx_chunk_parent` + `idx_chunk_root` | ✅ 完善 |
| `b_chat_messages` | `idx_session_msg` + `idx_session_msg_created` + `idx_msg_trace` + `idx_msg_status` | ✅ 完善 |
| `b_document_processing_tasks` | 4 个索引覆盖主要查询场景 | ✅ 完善 |
| `b_agent_steps` | `idx_agent_step_run` + `idx_agent_step_agent` | ✅ 够用 |

**缺失索引**:
- `b_chat_messages`: 缺少 `idx_session_role`（按会话+角色查询消息）
- `b_user_daily_quotas`: `idx_daily_quota_date` 存在，但缺少 `idx_user_quota`（按用户查配额历史）

### 4.5 外键约束评估

大部分外键已正确设置 `onDelete: Cascade` 或 `SetNull`。两个例外：

1. **`b_agent_steps.run_id`**: 无外键约束，孤立步骤记录不会随 `b_agent_runs` 删除而清理。
2. **`b_document_chunk_search_index`**: 无外键，chunk 删除后搜索索引记录会残留。

---

## 五、总结与建议优先级

### 🔴 高优先级（影响开发效率）

| # | 问题 | 建议 |
|---|------|------|
| 1 | 无一键初始化脚本 | 添加 `pnpm init:dev` 脚本 + Makefile |
| 2 | 无数据库种子脚本 | 创建 seed.ts（默认管理员 admin/admin123 + 系统模型配置 + 基础字典数据） |
| 3 | `apps/admin` 目录不存在 | 要么创建，要么从 README/CLAUDE.md/package.json 中移除引用 |
| 4 | `.env.example` 数据库名不一致 | 统一为 `rag_kb`（与 docker-compose.yml 一致） |

### 🟡 中优先级（影响数据一致性）

| # | 问题 | 建议 |
|---|------|------|
| 5 | `b_document_chunk_search_index` 冗余（已确认零引用） | 移除该表，减少存储和维护成本 |
| 6 | `b_agent_steps.run_id` 无外键 | 添加 Prisma relation |
| 7 | 数据库设计文档过时 | 同步更新 `docs/02-architecture/数据库设计.md` |
| 8 | `b_user_daily_quotas` 无清理 | 添加定时清理任务 |

### 🟢 低优先级（改善工程质量）

| # | 问题 | 建议 |
|---|------|------|
| 9 | 核心表缺少软删除 | 对 `b_users`/`b_knowledge_bases` 添加 `deleted_at` |
| 10 | 字符串枚举无 DB 约束 | 在应用层加强校验，或引入字典表联动 |
| 11 | README 缺少截图/GIF | 添加项目截图提升第一印象 |
| 12 | 缺少生产部署文档 | 添加 Dockerfile + 部署指南 |

---

## 附录：建议的种子数据 (seed.ts)

```typescript
// prisma/seed.ts
import { PrismaClient } from './generated/client';
import { hashSync } from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // 1. 默认超级管理员
  await prisma.sys_admins.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password_hash: hashSync('admin123', 10),
      role: 'super_admin',
    },
  });

  // 2. 系统模型配置
  await prisma.sys_model_configs.createMany({
    data: [
      { provider: 'bailian', name: 'deepseek-v4-pro', type: 'main', is_default: true },
      { provider: 'bailian', name: 'deepseek-v4-flash', type: 'light' },
      { provider: 'bailian', name: 'text-embedding-v4', type: 'embedding' },
      { provider: 'bailian', name: 'qwen3-rerank', type: 'rerank' },
    ],
    skipDuplicates: true,
  });

  // 3. 基础字典数据
  await prisma.sys_dict_type.createMany({
    data: [
      { code: 'doc_status', name: '文档状态' },
      { code: 'kb_visibility', name: '知识库可见性' },
      { code: 'member_role', name: '成员角色' },
      { code: 'chat_mode', name: '对话模式' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seed completed');
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

---

*本报告基于 2026-06-17 代码快照生成，不修改任何源代码。*
