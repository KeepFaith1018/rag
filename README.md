# Linsor AI - 灵索智能

> 灵动搜索个人知识 | 基于信息检索增强 (RAG) 的多可见性知识库问答系统

Linsor AI (灵索智能) 是一个专注于极致用户体验与高效信息检索的智能问答系统。用户可上传多种格式文档，系统自动进行解析、分段与向量化，结合大语言模型 (LLM) 实现基于多种可见性知识库的高质量问答。

## ✨ 核心特性

- **极致的 UI/UX 体验**: 采用自主设计的 "Kinetic Blueprint" 设计规范，提供精密的暗色/浅色模式 (Dark/Light Mode) 无缝切换，搭配丝滑的过渡动画与类 ChatGPT 的交互体验。
- **多维度知识库管理**: 支持私有、共享两类知识库；共享知识库支持邀请协作，并可配置是否开源、是否允许公开下载。
- **细粒度权限控制 (RBAC)**: 当前后端已落地 `owner / manager / collaborator / member / publicVisitor` 五类知识库访问身份，并基于 Guard 实现声明式权限校验。
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

前端应用内的专题实现文档位于 `apps/frontend/docs/`：

- [前端认证请求层设计 (auth-api-design.md)](apps/frontend/docs/auth-api-design.md): 基于 `fetch` 的双 token、自动刷新与请求排队设计。
- [前端认证实现总结 (auth-implementation-summary-2026-04-22.md)](apps/frontend/docs/auth-implementation-summary-2026-04-22.md): 本次认证链路落地、验证结果与后续建议。

后端专题实现文档位于 `apps/backend/docs/`：

- [异常治理与认证邮件联调总结 (exception-governance-and-auth-email-joint-debug-2026-04-24.md)](apps/backend/docs/exception-governance-and-auth-email-joint-debug-2026-04-24.md): 记录统一异常模型增强、全局异常日志收口、认证与邮件验证码联调中的问题定位与修复结果。
- [知识库模块规划方案 (knowledge-base-module-planning-2026-04-24.md)](apps/backend/docs/knowledge-base-module-planning-2026-04-24.md): 记录知识库、成员、文档、RAG 基础设施的后端规划与分阶段落地建议。
- [共享知识库角色权限设计 (knowledge-base-shared-role-permission-design-2026-04-24.md)](apps/backend/docs/knowledge-base-shared-role-permission-design-2026-04-24.md): 说明共享知识库角色模型、权限矩阵与成员体系边界。
- [知识库模块实现记录 (knowledge-base-management-implementation-record-2026-04-24.md)](apps/backend/docs/knowledge-base-management-implementation-record-2026-04-24.md): 汇总当前已落地的知识库管理、成员邀请管理和 Guard 权限体系实现。

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
  - 完成前端认证基础设施：统一请求层、双 token、自动刷新、刷新排队、`auth store`、启动恢复登录态、路由守卫。
  - 完成认证页面联调：登录、注册、发送验证码、忘记密码、重置密码、全局消息提示、验证码倒计时与基础表单校验。
  - 完成前后端认证联调修复：统一前端 API 基础地址为 `/api` 前缀，修复认证接口 `404` 问题。
  - 完成后端异常治理增强：`BusinessException` 支持 `cause/context/logLevel`，全局异常过滤器支持记录根因堆栈与结构化上下文。
  - 完成认证与邮件验证码链路排障：定位并暴露数据库连接池超时、SMTP 连接超时、SMTP 发件人与授权账号不一致等问题。
- **后端知识库能力落地**:
  - 完成知识库管理接口：创建、我的列表、公开列表、详情、更新、删除。
  - 完成共享知识库成员与邀请接口：成员列表、创建邀请、邀请列表、取消邀请、邀请码加入、移除成员。
  - 完成知识库模块拆分：主模块、`member` 子模块、`permission` 权限基础设施目录。
  - 完成声明式知识库权限体系：`@KbPermission(...) + KbPermissionGuard + KbPermissionService`。
  - 完成共享知识库五类访问身份落地：`owner / manager / collaborator / member / publicVisitor`。

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
