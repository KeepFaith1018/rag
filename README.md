# Linsor AI - 灵索智能

> 灵动搜索个人知识 | 基于信息检索增强 (RAG) 的多可见性知识库问答系统

Linsor AI (灵索智能) 是一个专注于极致用户体验与高效信息检索的智能问答系统。用户可上传多种格式文档，系统自动进行解析、分段与向量化，结合大语言模型 (LLM) 实现基于多种可见性知识库的高质量问答。

## 核心特性

- **极致的 UI/UX 体验**: 自主设计 "Kinetic Blueprint" 设计规范，精密暗色/浅色模式无缝切换，类 ChatGPT 交互体验。
- **多维度知识库管理**: 支持私有、共享两类知识库；共享知识库支持邀请协作、开源展示、公开下载配置。
- **细粒度权限控制 (RBAC)**: `owner / manager / collaborator / member / publicVisitor` 五类访问身份，基于 Guard 的声明式权限校验。
- **Agentic RAG 智能问答**:
  - 多重写 → 混合检索（稠密 + 稀疏 + Rerank）→ 事实核查 → 补充检索 的自校正闭环
  - 支持单库/多库定向问答与引用溯源
  - 三层粒度文档分块（Small-to-Big 检索）
  - AG-UI 流式通信协议，实时展示 Agent 步骤
- **文档处理流水线**: 上传 → 解析 → 分块 → 向量化 → 就绪，基于 BullMQ 的异步处理，支持版本化重解析与超时治理
- **灵活的模型接入**: 支持阿里云百炼 / OpenAI / DeepSeek 等多源模型动态配置，用户可自定义 API Key（AES-256-GCM 加密存储）
- **分片上传**: 支持断点续传、秒传（Web Worker 计算文件哈希）
- **后台管理系统**: 用户/模型/管理员 CRUD 管理端
- **RAGAS 评估体系**: 质量监控与回归测试

## 技术栈

### Monorepo 架构

- **包管理器**: pnpm (Workspaces)

### 前端 (`apps/web`)

- **核心框架**: Vue 3 (Composition API) + Vite
- **开发语言**: TypeScript
- **路由与状态**: Vue Router 4 + Pinia
- **样式引擎**: Tailwind CSS v4 (CSS 变量驱动的动态主题系统)
- **设计语言**: Kinetic Blueprint (高科技极简风，毛玻璃与弥散阴影)

### 后端 (`apps/server`)

- **核心框架**: NestJS
- **开发语言**: TypeScript
- **ORM**: Prisma
- **数据库**: MySQL 8.0 (元数据)
- **向量库**: Qdrant (稠密检索)
- **搜索引擎**: Elasticsearch (稀疏检索)
- **任务队列**: BullMQ (Redis-backed)
- **AI 编排**: LangChain / LangGraph

## 项目文档

详细的设计与规范文档位于 `docs/` 目录下，按以下结构组织：

| 目录 | 内容 |
|------|------|
| [01-requirements](docs/01-requirements/) | 需求分析报告 |
| [02-architecture](docs/02-architecture/) | 可行性分析、后端基础设施、数据库设计 |
| [03-design](docs/03-design/) | RAG/对话/上传模块详细设计、实施总结 |
| [04-changes](docs/04-changes/) | RAG 全链路优化 (4 阶段)、前端优化、测试数据 |
| [05-assets](docs/05-assets/) | Kinetic Blueprint 设计规范、UI Mockups |
| [06-reference](docs/06-reference/) | LLM/RAG/向量数据库学习笔记、数据流分析 |

完整索引见 [docs/README.md](docs/README.md)。

应用层专题文档：

- [前端文档](apps/web/docs/) — 认证请求层、双 Token 刷新、流式渲染
- [后端文档](apps/server/docs/) — 各模块实施记录、分片策略升级、Embedding 联调

## 快速开始

### 1. 环境准备

- Node.js >= 18
- pnpm
- Docker & Docker Compose (用于启动基础设施)

### 2. 启动基础设施

```bash
docker compose up -d
```

此命令将启动 MySQL (13306)、Qdrant (6333/6334)、Redis (16379)、Elasticsearch (9200)。

### 3. 安装依赖

```bash
pnpm install
```

### 4. 数据库初始化

```bash
cd apps/server
pnpm prisma generate
pnpm prisma migrate dev
```

### 5. 启动服务

```bash
# 启动后端 (开发模式)
pnpm --filter server start:dev

# 启动前端 (开发模式)
pnpm --filter web dev
```

## 更新日志

### 2026-05: RAG 全链路优化、后台管理系统与前端性能优化

- **RAG 全链路优化 (四阶段)**:
  - 阶段一 — 修复 + 性能提升：稠密/稀疏检索并行化、Embedding 批量优化、文件解析增强
  - 阶段二 — Agentic RAG 自校正闭环：多重写 → 混合检索 → 事实核查 → 补充检索
  - 阶段三 — 代码质量提升：共享类型抽离、健壮性加固
  - 阶段四 — 验收测试：7 个场景全部通过，RAGAS 评估体系搭建
- **前端优化**: 代码高亮引擎 highlight.js → Shiki 迁移，流式 Markdown 渲染方案调研与选型
- **后台管理系统** (`apps/admin`) 首期落地：用户/模型/管理员管理界面
- **Elasticsearch 混合检索**上线：稠密 + 稀疏 + Rescore 多路召回
- **文档三层粒度分块**策略落地：根/中/子块 + Small-to-Big 检索
- **提示词优化**方案调研完成

### 2026-04: 品牌升级、知识库能力扩展与 RAG 文档流水线落地

- **品牌重塑**: 项目正式命名为 "Linsor AI - 灵索智能"
- **前端重构**: Vue 3 + Tailwind CSS v4 全面重构，Kinetic Blueprint 设计规范落地
- **后端知识库能力**: 知识库 CRUD、成员邀请、声明式权限体系
- **RAG 文档处理**: 上传 → 解析 → 分块 → 向量化 异步流水线，BullMQ 驱动
- **文档分片策略升级**: 从全文字符级递归切分升级为结构感知 + 近似 token 二次切分

### 2026-01: 项目初始化

- Monorepo 仓库结构初始化 (NestJS + Vue3)
- MySQL + Qdrant + LangChain 技术栈确定
- RBAC 权限模型与数据库设计完成

## 目录结构

```text
.
├── apps
│   ├── server       # NestJS 后端服务
│   ├── web          # Vue 3 前端应用
│   └── admin        # 后台管理系统
├── docs             # 架构与设计文档
│   ├── 01-requirements/  # 需求分析
│   ├── 02-architecture/  # 架构设计
│   ├── 03-design/        # 详细设计
│   ├── 04-changes/       # 变更与优化记录
│   ├── 05-assets/        # 设计资产
│   └── 06-reference/     # 参考资料
├── packages         # 公共工具与类型库
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```
