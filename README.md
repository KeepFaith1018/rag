# Linsor AI - 灵索智能

> 灵动搜索个人知识 | 基于信息检索增强 (RAG) 的私有知识库问答系统

Linsor AI (灵索智能) 是一个专注于极致用户体验与高效信息检索的智能问答系统。用户可上传多种格式文档，系统自动进行解析、分段与向量化，结合大语言模型 (LLM) 实现基于私有知识库的高质量问答。

## ✨ 核心特性

- **极致的 UI/UX 体验**: 采用自主设计的 "Kinetic Blueprint" 设计规范，提供精密的暗色/浅色模式 (Dark/Light Mode) 无缝切换，搭配丝滑的过渡动画与类 ChatGPT 的交互体验。
- **多维度知识库管理**: 支持个人独享、私有共享（仅成员可见）、公域开放（广场可见）三种模式。
- **细粒度权限控制 (RBAC)**: 包含 Owner, Admin, Editor, Viewer 四级权限，支持邀请制成员管理。
- **RAG 智能问答**:
  - 支持 PDF/Word/TXT 文档解析与切片。
  - 基于 Qdrant 的语义检索。
  - 支持单库定向问答与引用溯源。
- **灵活的模型接入**: 后台支持 OpenAI/Ollama/DeepSeek 等多源 AI 模型动态配置。

## 🛠 技术栈

### Monorepo 架构

- **包管理器**: pnpm (Workspaces)

### 前端 (`apps/frontend`)

- **核心框架**: Vue 3 (Composition API) + Vite
- **开发语言**: TypeScript
- **路由与状态**: Vue Router 4 + Pinia
- **样式引擎**: Tailwind CSS v4 (原生 CSS 变量驱动的动态主题系统)
- **设计语言**: Kinetic Blueprint (高科技极简风，毛玻璃与弥散阴影)

### 后端 (`apps/backend`)

- **核心框架**: NestJS
- **开发语言**: TypeScript
- **ORM**: Prisma
- **数据库**: MySQL 8.0 (元数据)
- **向量库**: Qdrant (向量数据)
- **AI 编排**: LangChain

## 📖 项目文档

详细的设计与规范文档位于 `docs/` 目录下：

- [需求分析 (01-requirement-analysis.md)](docs/01-requirement-analysis.md): 核心需求与业务场景。
- [可行性分析 (02-feasibility-analysis.md)](docs/02-feasibility-analysis.md): 技术与业务可行性评估。
- [数据库设计 (03-database-design.md)](docs/03-database-design.md): 详细的表结构与数据流转。
- [后端架构与实现 (backend_infra_implementation.md)](docs/backend_infra_implementation.md): 后端服务划分与 RAG 核心链路。
- [前端设计规范 (DESIGN.md)](docs/ui/DESIGN.md): 核心 UI 设计理念 (The Kinetic Blueprint)。
- [前端页面实现规划 (ui-implementation-plan.md)](docs/ui-implementation-plan.md): 页面结构、组件拆分与主题配置方案。

## 🚀 快速开始

### 1. 环境准备

- Node.js >= 18
- pnpm
- Docker & Docker Compose (用于启动数据库)

### 2. 启动基础设施

```bash
docker compose up -d
```

此命令将启动 MySQL (端口 3306) 和 Qdrant (端口 6333/6334)。

### 3. 安装依赖

```bash
pnpm install
```

### 4. 数据库初始化

```bash
cd apps/backend
pnpm prisma generate
pnpm prisma migrate dev
```

### 5. 启动服务

```bash
# 启动后端 (开发模式)
pnpm --filter backend start:dev

# 启动前端 (开发模式)
pnpm --filter frontend dev
```

## 📝 更新日志 (Changelog)

### 2026-04: 品牌升级与前端体验重构 (当前阶段)

- **品牌重塑**: 项目正式命名为 "Linsor AI - 灵索智能"，确立 "灵动搜索个人知识" Slogan。
- **前端重构**:
  - 全面采用 Vue 3 + Tailwind CSS v4 构建前端页面，废弃原有的 Ant Design Vue 方案。
  - 基于 CSS 变量 (`@theme`) 实现了高定制化的明暗双色主题 (Light/Dark Mode)，取代硬编码颜色。
  - 移除冗余纹理背景，确立 Refined Minimalist (精致极简) 的 UI 风格。
  - 实现平滑的组件交互：增加 `color-mix` 动态透明度、弥散阴影 (`--shadow-glass`)、AI 思考呼吸灯 (`.ai-thinking-glow`)。
  - 优化导航结构，底部个人菜单重构为类 ChatGPT 的丝滑 Popover 弹出菜单。

### 2026-01: 项目初始化与后端架构

- 完成 Monorepo 仓库结构初始化 (NestJS + Vue3)。
- 确定 MySQL + Qdrant + LangChain 核心后端技术栈。
- 完成 RBAC 权限模型、知识库可见性及后台管理系统的需求分析与数据库设计。

## 📂 目录结构说明

```text
.
├── apps
│   ├── backend     # NestJS 后端服务
│   └── frontend    # Vue 3 前端应用
├── docs            # 架构与设计文档
├── packages        # 公共工具与类型库
├── docker-compose.yml # 基础设施编排
├── pnpm-workspace.yaml # Monorepo 配置
└── README.md       # 项目说明
```
