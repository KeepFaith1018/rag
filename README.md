# Linsor AI - 灵索智能

> 灵动搜索个人知识 | 基于 RAG 的多知识库智能问答系统

Linsor AI (灵索智能) 是一个面向极致用户体验与高效信息检索的智能问答系统。支持多格式文档上传、自动解析分块与向量化，结合 LLM 实现基于多知识库的高质量 RAG 问答。

## 核心特性

- **Kinetic Blueprint 设计**: 自研设计规范，暗色/浅色模式无缝切换，类 ChatGPT 交互体验
- **多知识库管理**: 私有/共享两类知识库，共享库支持邀请协作、开源展示、公开下载
- **五级权限控制**: `owner / manager / collaborator / member / publicVisitor`，12 个声明式权限标记位
- **Agentic RAG 自校正闭环**: 路由 → 多重写 → 混合检索（稠密 + 稀疏 + Rerank）→ 事实核查 → 补充检索，14 个 LangGraph 节点编排
- **文档处理流水线**: 上传 → 解析 → 三层粒度分块 → 向量化 → 就绪，BullMQ 异步驱动，支持版本化重解析与超时治理
- **分片上传**: 断点续传、秒传（Web Worker SHA-256 哈希），SSE 实时进度推送
- **Elasticsearch 混合检索**: 稠密向量 + IK 分词稀疏检索 + RRF 融合（香农熵加权）+ qwen3-rerank 重排序
- **AG-UI 流式协议**: 标准 SSE 事件格式，实时展示 Agent 思考步骤、工具调用与检索结果
- **离线评估**: LLM-as-Judge 自动评估忠实度/答案相关性/上下文召回率，结果回写 agent run
- **后台管理系统**: 仪表盘、模型配置、用户/管理员 CRUD、公开知识库管理、审计日志、字典管理
- **灵活模型接入**: 百炼/OpenAI/DeepSeek/Zhipu/自定义，用户可配置自己的 API Key（AES-256-GCM 加密）

## 技术栈

| 层 | 技术 |
|------|------|
| 包管理 | pnpm (Monorepo) |
| 前端 | Vue 3 + TypeScript + Vite + Tailwind CSS v4 + Pinia + Incremark + Shiki |
| 后端 | NestJS 11 + TypeScript + Prisma + LangChain/LangGraph |
| 数据库 | MySQL 8.0 (元数据) |
| 向量库 | Qdrant (稠密) + Elasticsearch (稀疏) |
| 任务队列 | BullMQ (Redis-backed) |

## 快速开始

### 1. 环境要求

- Node.js >= 18
- pnpm >= 10
- Docker & Docker Compose

### 2. 启动基础设施

```bash
docker compose up -d
```

启动 MySQL (13306)、Qdrant (6333/6334)、Redis (16379)、Elasticsearch (9200)。

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
# 后端
pnpm dev:server

# 前端 (另一个终端)
pnpm dev:web
```

## 项目结构

```text
├── apps
│   ├── server       # NestJS 后端 (API + RAG + 文档处理)
│   └── web          # Vue 3 前端 (主用户界面)
├── docs             # 设计文档 (6 个分类目录)
├── docker-compose.yml
├── pnpm-workspace.yaml
└── CLAUDE.md        # AI 开发指引
```

## 文档索引

完整文档见 [docs/](docs/)：

| 目录 | 内容 |
|------|------|
| [01-requirements](docs/01-requirements/) | 需求分析报告 |
| [02-architecture](docs/02-architecture/) | 可行性分析、后端基础设施、数据库设计 |
| [03-design](docs/03-design/) | RAG/对话/上传模块详细设计、实施总结 |
| [04-changes](docs/04-changes/) | RAG 全链路优化 (4 阶段)、前端优化、测试数据 |
| [05-assets](docs/05-assets/) | Kinetic Blueprint 设计规范、UI Mockups |
| [06-reference](docs/06-reference/) | LLM/RAG/向量数据库学习笔记、数据流分析 |
