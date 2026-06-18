# 后台管理系统 — 第一期实现文档

> 日期：2026-05-07
> 状态：已完成

## 概述

本系统基于 Linsor AI 构建，新增独立后台管理系统（`apps/admin`），用于管理员对 AI 模型、用户账号和系统管理员的管控。

## 项目结构

```
apps/
├── admin/                        # 新增：后台管理前端
│   ├── src/
│   │   ├── api/                 # API 请求层（auth, model-config, user, admin-user）
│   │   ├── components/layout/   # AdminLayout 布局组件
│   │   ├── router/              # 路由 + 导航守卫
│   │   ├── stores/              # Pinia auth store
│   │   ├── views/               # 页面
│   │   │   ├── login/           # 登录页
│   │   │   ├── dashboard/       # 数据概览
│   │   │   ├── model-config/    # 模型配置（列表/创建/编辑）
│   │   │   ├── user/            # 用户管理（列表/详情）
│   │   │   └── admin/           # 管理员管理（列表/创建/编辑）
│   │   └── types/               # 类型定义
│   └── vite.config.ts           # 代理 /api 到后端
│
└── server/src/modules/
    └── admin/                   # 新增：后台管理后端模块
        ├── admin-auth/           # 登录/登出/刷新/获取当前管理员
        ├── model-config/         # 模型配置 CRUD
        ├── user/                 # 前台用户查看/禁用/启用
        └── admin-user/           # 管理员账号 CRUD
```

## 启动方式

```bash
# 启动后端（端口 3000）
pnpm dev:server

# 启动前端（端口 5174，代理 /api 到 3000）
pnpm dev:admin
```

访问地址：http://localhost:5174/admin/

## 初始账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | super_admin |

> ⚠️ 请尽快修改默认密码。

## API 接口

所有接口统一前缀 `/api/admin/`，需要 JWT 认证（`Authorization: Bearer <token>`）。

### 认证接口

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | /api/admin/auth/login | 登录 | 公开 |
| POST | /api/admin/auth/refresh | 刷新 Token | 公开 |
| POST | /api/admin/auth/logout | 登出 | 需登录 |
| POST | /api/admin/auth/me | 获取当前管理员 | 需登录 |

### 模型配置接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/admin/model-config | 列表（支持 provider/type/isActive 筛选） |
| GET | /api/admin/model-config/:id | 详情 |
| POST | /api/admin/model-config | 创建 |
| PUT | /api/admin/model-config/:id | 更新 |
| PATCH | /api/admin/model-config/:id/toggle | 启用/禁用 |
| DELETE | /api/admin/model-config/:id | 删除 |

### 用户管理接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/admin/user | 列表（支持 email 搜索/状态筛选） |
| GET | /api/admin/user/:id | 详情 |
| PATCH | /api/admin/user/:id/disable | 禁用用户 |
| PATCH | /api/admin/user/:id/enable | 启用用户 |

### 管理员管理接口

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /api/admin/admin | 列表 | 仅 super_admin |
| GET | /api/admin/admin/:id | 详情 | 仅 super_admin |
| POST | /api/admin/admin | 创建 | 仅 super_admin |
| PUT | /api/admin/admin/:id | 更新 | 仅 super_admin |
| DELETE | /api/admin/admin/:id | 删除 | 仅 super_admin |

## 权限设计

- `@AdminAuth()` — 需要管理员登录
- `@RequireRole('super_admin')` — 仅 super_admin 可访问

| 功能 | super_admin | operator |
|------|------------|----------|
| 模型配置 | ✅ | ✅ |
| 用户管理 | ✅ | ✅ |
| 管理员管理 | ✅ | ❌（菜单隐藏）|

## 数据库

使用现有 `sys_admins`、`sys_admin_sessions`、`sys_model_configs`、`b_users` 表。

初始管理员通过种子脚本创建：

```bash
cd apps/server
npx ts-node -r dotenv/config prisma/seed.ts
```

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + Tailwind CSS + Pinia + Vue Router
- **后端**: NestJS + Prisma ORM + JWT + bcrypt
- **数据库**: MySQL 8.0

## 后续迭代

- 公开知识库管理
- 公开知识库文件管理
- 审计日志
- 系统字典管理
