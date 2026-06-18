# 后台管理系统设计方案

> 日期：2026-05-07
> 状态：已确认

## 1. Context

当前系统（Linsor AI）仅有前台用户功能，缺少后台管理能力。运营人员无法管理 AI 模型配置、用户账号，也无法对管理员账号进行 CRUD。本设计旨在构建一个独立的后台管理系统，满足以下核心需求：

- 管理员可配置和管理 AI 模型（对话模型、Embedding 模型）
- 管理员可查看和管控前台用户账号
- 超级管理员可管理系统管理员账号
- 与前台完全隔离的认证体系

## 2. 整体架构

### 技术栈

- **前端**: `apps/admin` — 独立 Vite + Vue 3 + TypeScript + Tailwind CSS 项目
- **后端**: `apps/server/src/modules/admin/` — 新增 NestJS 模块，复用现有 PrismaService、Winston、BusinessException 等基础设施
- **数据库**: 复用现有 MySQL 和 `sys_admins`、`b_users`、`sys_model_configs` 等表

### 目录结构

```
apps/
├── admin/                    # 新增：后台管理前端
│   ├── src/
│   │   ├── api/             # API 请求层
│   │   ├── router/          # 路由 + 导航守卫
│   │   ├── stores/          # Pinia（auth store）
│   │   ├── views/           # 页面
│   │   ├── components/      # 通用组件
│   │   └── App.vue
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
└── server/src/modules/
    └── admin/               # 新增：后台管理后端模块
        ├── admin.module.ts
        ├── admin-auth/      # 管理员登录/登出/刷新
        ├── admin-user/      # 管理员账号 CRUD
        ├── model-config/    # 模型配置 CRUD
        └── user/            # 前台用户管理（只读）
```

## 3. 认证与鉴权

### JWT 结构

```typescript
interface AdminJwtUser {
  sub: string;                    // 管理员 ID
  username: string;
  role: 'super_admin' | 'operator';
  isAdmin: true;                  // 固定为 true，区分前台用户
}
```

### 鉴权装饰器

- `@AdminAuth()` — 需要登录
- `@RequireRole('super_admin')` — 仅 super_admin 可访问

### 权限矩阵

| 功能 | super_admin | operator |
|------|------------|----------|
| 模型配置管理 | ✅ | ✅ |
| 用户管理 | ✅ | ✅ |
| 管理员管理 | ✅ | ❌（菜单隐藏）|

## 4. API 接口设计

### 4.1 认证接口（`/api/admin/auth/*`）

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/admin/auth/login` | 管理员登录 | 公开 |
| POST | `/api/admin/auth/refresh` | 刷新 Token | 公开 |
| POST | `/api/admin/auth/logout` | 登出 | `@AdminAuth()` |

### 4.2 模型配置接口（`/api/admin/model-config/*`）

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/admin/model-config` | 分页列表（支持 provider/type 筛选） | `@AdminAuth()` |
| GET | `/api/admin/model-config/:id` | 详情 | `@AdminAuth()` |
| POST | `/api/admin/model-config` | 创建 | `@AdminAuth()` |
| PUT | `/api/admin/model-config/:id` | 更新 | `@AdminAuth()` |
| PATCH | `/api/admin/model-config/:id/toggle` | 启用/禁用 | `@AdminAuth()` |
| DELETE | `/api/admin/model-config/:id` | 删除 | `@AdminAuth()` |

### 4.3 用户管理接口（`/api/admin/user/*`）

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/admin/user` | 分页列表（支持 email/状态筛选） | `@AdminAuth()` |
| GET | `/api/admin/user/:id` | 详情 | `@AdminAuth()` |
| PATCH | `/api/admin/user/:id/disable` | 禁用用户 | `@AdminAuth()` |
| PATCH | `/api/admin/user/:id/enable` | 启用用户 | `@AdminAuth()` |

### 4.4 管理员管理接口（`/api/admin/admin/*`）

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/admin/admin` | 管理员列表 | `@RequireRole('super_admin')` |
| GET | `/api/admin/admin/:id` | 详情 | `@RequireRole('super_admin')` |
| POST | `/api/admin/admin` | 创建管理员 | `@RequireRole('super_admin')` |
| PUT | `/api/admin/admin/:id` | 更新管理员 | `@RequireRole('super_admin')` |
| DELETE | `/api/admin/admin/:id` | 删除管理员 | `@RequireRole('super_admin')` |

## 5. DTO 设计

### 5.1 模型配置 DTO

**创建/更新**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| provider | string | 是 | 服务商（max 50） |
| name | string | 是 | 模型名称（max 100） |
| type | 'chat' \| 'embedding' | 是 | 模型类型 |
| baseUrl | string | 否 | API 地址（max 255） |
| apiKey | string | 否 | API 密钥（max 500） |
| configJson | object | 否 | 模型参数 |
| isDefault | boolean | 否 | 是否默认 |
| isActive | boolean | 否 | 是否启用 |

**列表筛选**

| 字段 | 类型 | 说明 |
|------|------|------|
| page | number | 默认 1 |
| pageSize | number | 默认 20，最大 100 |
| provider | string | 按服务商筛选 |
| type | string | 按类型筛选 |
| isActive | boolean | 按状态筛选 |

### 5.2 用户管理 DTO

**列表筛选**

| 字段 | 类型 | 说明 |
|------|------|------|
| page | number | 默认 1 |
| pageSize | number | 默认 20，最大 100 |
| email | string | 模糊搜索 |
| isActive | boolean | 按状态筛选 |

**响应字段**: id, email, full_name, avatar_url, is_active, created_at（敏感字段 password_hash 不返回）

### 5.3 管理员管理 DTO

**创建**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名（unique, max 100） |
| password | string | 是 | 密码（min 6, max 50） |
| role | 'super_admin' \| 'operator' | 是 | 角色 |

**更新**

| 字段 | 类型 | 说明 |
|------|------|------|
| password | string | 密码（可选） |
| role | string | 角色（可选） |
| isActive | boolean | 是否启用 |

## 6. 前端页面结构

### 页面清单

| 路径 | 页面 | 说明 |
|------|------|------|
| `/admin/login` | 登录页 | 独立，无侧边栏 |
| `/admin` | 根路径 | 重定向到 /admin/dashboard |
| `/admin/dashboard` | 数据概览 | 统计卡片 + 快捷操作 |
| `/admin/model-config` | 模型配置列表 | 表格 + 筛选 + 分页 |
| `/admin/model-config/create` | 创建模型 | 表单页 |
| `/admin/model-config/:id/edit` | 编辑模型 | 表单页 |
| `/admin/user` | 用户管理列表 | 表格 + 筛选 |
| `/admin/user/:id` | 用户详情 | 用户信息查看 |
| `/admin/admin` | 管理员管理 | 表格 + CRUD（仅 super_admin） |
| `/admin/admin/create` | 创建管理员 | 表单页 |
| `/admin/admin/:id/edit` | 编辑管理员 | 表单页 |

### 导航菜单

```
- 数据概览（dashboard）
- 模型配置（model-config）
- 用户管理（user）
- 管理员管理（admin） ← 仅 super_admin 可见
```

### 通用组件

| 组件 | 用途 |
|------|------|
| AdminLayout | 侧边栏 + 顶部栏（管理员信息 + 登出） |
| AdminTable | 通用表格封装（分页、筛选、操作列） |
| AdminForm | 通用表单封装 |
| ConfirmDialog | 确认对话框（危险操作确认） |

## 7. 开发计划

### 第一期功能（当前迭代）

1. **模型配置管理** — 完整 CRUD
2. **用户管理** — 只读查看 + 禁用/启用
3. **管理员账号管理** — 完整 CRUD（仅 super_admin 可操作）

### 后续迭代（不在本期范围）

- 公开知识库管理
- 公开知识库文件管理
- 审计日志
- 系统字典管理

## 8. 验收标准

1. 管理员可通过独立登录页登录系统
2. 模型配置支持完整增删改查，支持启用/禁用
3. 用户管理支持查看列表、查看详情、禁用/启用用户
4. 管理员管理仅 super_admin 可访问，支持增删改查
5. operator 角色无法看到管理员管理菜单
6. 前端界面简洁专业，以表格和表单为主
7. 后端接口统一前缀 `/api/admin/*`
