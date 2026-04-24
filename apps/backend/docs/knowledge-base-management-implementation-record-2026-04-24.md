# 知识库模块后端实现记录

## 1. 文档说明

本文档用于记录当前已经在 `apps/backend` 中完成落地的知识库相关后端实现，重点说明以下三部分：

- 知识库基础管理
- 成员与邀请管理
- 基于 Guard 的知识库权限体系

本文档描述的是 2026-04-24 当前仓库中的**实际代码现状**，不再区分“仅规划、尚未编码”的目标项。

当前记录范围不包含：

- 文档上传、下载、删除、重解析
- Redis / BullMQ 队列
- 文档解析与切块
- Qdrant 向量写入与删除
- 基于知识库的问答接口

## 2. 当前模块结构

当前知识库模块已经拆分为主模块、成员子模块、权限基础设施三部分：

```text
apps/backend/src/modules/knowledge-base/
  dto/
    create-knowledge-base.dto.ts
    list-knowledge-bases.dto.ts
    update-knowledge-base.dto.ts
  interfaces/
    kb-permission.interface.ts
    knowledge-base-access.interface.ts
  member/
    dto/
      create-kb-invitation.dto.ts
      join-kb.dto.ts
    kb-member.controller.ts
    kb-member.module.ts
    kb-member.service.ts
  permission/
    kb-permission.decorator.ts
    kb-permission.guard.ts
    kb-permission.module.ts
    kb-permission.service.ts
  knowledge-base.controller.ts
  knowledge-base.module.ts
  knowledge-base.service.ts
```

模块接入位置：

- `apps/backend/src/app.module.ts`
  - 已注册 `KnowledgeBaseModule`

## 3. 已完成的接口

### 3.1 知识库管理接口

#### 1. 创建知识库

- 路径：`POST /api/knowledge-bases`
- 权限：登录用户
- 当前实现：
  - 校验 DTO 参数
  - 自动清理 `name`、`description`
  - 私有库自动关闭 `isPublic`、`allowPublicDownload`
  - 创建 `b_knowledge_bases`
  - 返回知识库详情与权限信息

#### 2. 获取我的知识库列表

- 路径：`GET /api/knowledge-bases`
- 权限：登录用户
- 当前实现：
  - 支持 `owned / joined / all`
  - 支持按 `visibility`、关键字筛选
  - 支持分页
  - 返回文档数、成员数、访问角色、权限标识

#### 3. 获取公开知识库列表

- 路径：`GET /api/public/knowledge-bases`
- 权限：登录用户
- 当前实现：
  - 仅返回 `shared + is_public = true + status = normal`
  - 支持关键字筛选
  - 支持分页
  - 支持 `latest / hot` 排序

#### 4. 获取知识库详情

- 路径：`GET /api/knowledge-bases/:kbId`
- 权限：声明式 `@KbPermission({ action: 'read' })`
- 当前实现：
  - 通过 `KbPermissionGuard` 统一做知识库级鉴权
  - 支持 `owner / manager / collaborator / member / publicVisitor`
  - 返回知识库基础信息、角色与权限标识

#### 5. 更新知识库

- 路径：`PATCH /api/knowledge-bases/:kbId`
- 权限：声明式 `@KbPermission({ action: 'manageKnowledgeBase' })`
- 当前实现：
  - 仅 owner 可更新知识库基础配置
  - 私有库自动关闭公开字段
  - 当共享库仍有成员时，禁止直接切回私有库

#### 6. 删除知识库

- 路径：`DELETE /api/knowledge-bases/:kbId`
- 权限：声明式 `@KbPermission({ action: 'manageKnowledgeBase' })`
- 当前实现：
  - 仅 owner 可删除
  - 删除 `b_knowledge_bases`
  - 依赖 Prisma 关系级联删除关联记录

### 3.2 成员与邀请接口

#### 7. 获取成员列表

- 路径：`GET /api/knowledge-bases/:kbId/members`
- 权限：声明式 `@KbPermission({ action: 'manageMembers' })`
- 当前实现：
  - 仅共享知识库支持
  - 仅 `owner / manager` 可查看
  - 返回 `owner + members`

#### 8. 创建邀请

- 路径：`POST /api/knowledge-bases/:kbId/invitations`
- 权限：声明式 `@KbPermission({ action: 'manageMembers' })`
- 当前实现：
  - 仅共享知识库支持
  - 支持角色 `manager / collaborator / member`
  - 默认角色为 `member`
  - 支持自定义过期小时数

#### 9. 获取邀请列表

- 路径：`GET /api/knowledge-bases/:kbId/invitations`
- 权限：声明式 `@KbPermission({ action: 'manageMembers' })`
- 当前实现：
  - 仅返回仍有效邀请
  - 对外统一返回 `active / used / expired / cancelled` 状态语义

#### 10. 取消邀请

- 路径：`DELETE /api/knowledge-bases/:kbId/invitations/:invitationId`
- 权限：声明式 `@KbPermission({ action: 'manageMembers' })`
- 当前实现：
  - 校验邀请是否属于当前知识库
  - 已使用、已过期、已取消邀请会给出明确异常

#### 11. 通过邀请码加入知识库

- 路径：`POST /api/knowledge-bases/join`
- 权限：登录用户
- 当前实现：
  - 校验邀请码存在、未取消、未过期、未使用
  - 校验知识库必须为共享库
  - 校验当前用户不是 owner，且尚未加入
  - 按邀请角色写入 `b_kb_members.role`
  - 同时回写邀请使用状态

#### 12. 移除成员

- 路径：`DELETE /api/knowledge-bases/:kbId/members/:memberUserId`
- 权限：声明式 `@KbPermission({ action: 'manageMembers' })`
- 当前实现：
  - 仅共享知识库支持
  - 禁止移除 owner
  - 仅允许移除已加入成员

## 4. 当前权限体系

### 4.1 角色模型

当前代码已经支持以下访问身份：

- `owner`
- `manager`
- `collaborator`
- `member`
- `publicVisitor`

说明：

- `owner` 由 `b_knowledge_bases.owner_id` 表示
- `manager / collaborator / member` 来自 `b_kb_members.role`
- `publicVisitor` 不写入成员表，而是由 `shared + is_public = true` 动态推导

### 4.2 权限动作

当前声明式权限动作定义为：

- `read`
- `ask`
- `manageKnowledgeBase`
- `manageMembers`
- `uploadDocument`
- `downloadDocument`
- `deleteAnyDocument`
- `deleteOwnDocument`
- `reparseAnyDocument`
- `reparseOwnDocument`

虽然文档管理与问答接口尚未落地，但权限动作已提前设计好，后续模块可以直接复用。

### 4.3 Guard 设计

当前知识库权限体系已采用 `Decorator + Guard + PermissionService` 的分层：

- `@KbPermission(...)`
  - 用于声明接口所需的知识库权限动作
- `KbPermissionGuard`
  - 负责从请求中提取 `kbId` 和当前用户，统一做知识库级鉴权
- `KbPermissionService`
  - 负责角色解析、权限位计算与动作映射

当前控制器接入方式：

- `KnowledgeBaseController`
  - 使用 `AuthGuard + KbPermissionGuard`
- `KbMemberController`
  - 使用 `AuthGuard + KbPermissionGuard`

### 4.4 权限标识

当前返回结构中的 `permissions` 已包含：

- `canView`
- `canAsk`
- `canEdit`
- `canDelete`
- `canInvite`
- `canUpload`
- `canReparse`
- `canDownload`
- `canManageKnowledgeBase`
- `canManageMembers`
- `canDeleteAnyDocument`
- `canDeleteOwnDocument`
- `canReparseAnyDocument`
- `canReparseOwnDocument`

## 5. 关键实现文件

### 5.1 知识库主模块

- `apps/backend/src/modules/knowledge-base/knowledge-base.module.ts`
  - 注册主控制器、成员子模块与权限模块

- `apps/backend/src/modules/knowledge-base/knowledge-base.controller.ts`
  - 定义知识库 CRUD 与查询接口
  - 接入 `@KbPermission(...)`

- `apps/backend/src/modules/knowledge-base/knowledge-base.service.ts`
  - 实现知识库创建、列表、详情、更新、删除
  - 组装统一的角色与权限返回结构

### 5.2 成员子模块

- `apps/backend/src/modules/knowledge-base/member/kb-member.module.ts`
  - 知识库成员子模块定义

- `apps/backend/src/modules/knowledge-base/member/kb-member.controller.ts`
  - 定义成员、邀请、加入、移除相关接口

- `apps/backend/src/modules/knowledge-base/member/kb-member.service.ts`
  - 实现成员列表、创建邀请、邀请列表、取消邀请、邀请码加入、移除成员

### 5.3 权限基础设施

- `apps/backend/src/modules/knowledge-base/permission/kb-permission.module.ts`
  - 统一导出权限 Guard 与权限服务

- `apps/backend/src/modules/knowledge-base/permission/kb-permission.decorator.ts`
  - 知识库动作声明装饰器

- `apps/backend/src/modules/knowledge-base/permission/kb-permission.guard.ts`
  - 统一知识库级权限拦截

- `apps/backend/src/modules/knowledge-base/permission/kb-permission.service.ts`
  - 统一角色解析、权限位计算、动作授权

### 5.4 认证配套

- `apps/backend/src/common/guards/auth.guard.ts`
  - 已支持类级与方法级 `@Auth()` 声明，便于与 `KbPermissionGuard` 组合复用

## 6. 已补充的异常语义

当前已围绕知识库成员与邀请流程补充更细粒度的异常码与异常消息，覆盖场景包括：

- 邀请已过期
- 邀请已使用
- 邀请已取消
- 用户已拥有该知识库
- 用户已加入该知识库
- 禁止移除 owner

相关文件：

- `apps/backend/src/common/utils/errorCodeMap.ts`
- `apps/backend/src/common/utils/errorMessageMap.ts`
- `apps/backend/src/common/utils/errorCodeHttpMap.ts`

## 7. 当前未完成项

当前尚未完成的部分包括：

- 文档管理模块
- 文件上传与存储抽象
- 文档状态流转与异步解析
- Redis / BullMQ 接入
- Qdrant 向量库写入与清理
- 基于知识库的问答接口
- 文档级资源权限校验

## 8. 下一步建议

建议后续按以下顺序继续推进：

1. 独立 `document` 业务模块，负责文档元数据与接口层
2. 独立 `document-processing` 或 `rag` 模块，负责解析、切块、向量化编排
3. 独立 `ai` 模块，负责 Embedding、LLM、Rerank 等模型能力封装
4. 文档接口统一复用当前 `KbPermissionGuard`
5. 文档服务内部补充“资源级权限”判断，例如 `uploader_id`
