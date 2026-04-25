# 前端知识库、成员与权限对接实施文档

## 1. 文档说明

- 本文档用于指导 `apps/frontend` 完成知识库管理、成员管理、权限展示与前后端联调。
- 本文档重点解决以下问题：
  - 当前前端知识库页面哪些部分还是静态假数据
  - 需要新增哪些前端 API 封装、类型和状态管理
  - 列表页、详情页、成员页、设置页分别如何拆分
  - 后端权限字段如何映射到前端按钮显隐与禁用逻辑
  - 联调阶段应该如何安排顺序与验收
- 本文档承接以下现状：
  - 认证请求层与登录态恢复已完成
  - `KbListView.vue`、`KbDetailView.vue` 已有静态界面骨架
  - 后端知识库管理、成员邀请、权限体系已完成

相关文档：

- [认证请求层设计](./auth-api-design.md)
- [认证实现总结](./auth-implementation-summary-2026-04-22.md)
- [前端文档上传增强实现记录](./document-upload-implementation-record-2026-04-24.md)
- [知识库模块后端实现记录](../../../apps/backend/docs/knowledge-base-management-implementation-record-2026-04-24.md)
- [共享知识库角色与权限设计方案](../../../apps/backend/docs/knowledge-base-shared-role-permission-design-2026-04-24.md)

---

## 2. 当前前端现状

### 2.1 已有能力

当前前端已具备以下基础：

- 统一请求层 `src/api/api.ts`
- 认证业务 API `src/api/auth.ts`
- 登录态恢复、刷新、路由守卫
- 主布局 `MainLayout.vue`
- 知识库列表页 `src/views/kb/KbListView.vue`
- 知识库详情页 `src/views/kb/KbDetailView.vue`
- 上传增强能力层 `src/modules/document-upload`

### 2.2 当前缺口

当前知识库相关页面仍主要依赖静态数据或占位结构，缺口如下：

- 尚未新增知识库业务 API 封装
- 尚未新增成员与邀请 API 封装
- 尚未建立知识库业务类型定义
- 尚未建立知识库业务 store 或 composable
- `KbListView.vue` 仍使用本地 `ref([...])` 假数据
- `KbDetailView.vue` 仍是静态详情与静态成员头像
- 成员页、设置页目前只有 Tab 文案，没有真实内容
- 权限字段未驱动按钮显隐、禁用和空态
- 尚未完成与后端知识库、成员、权限接口联调

结论：

> 当前前端已经有“视觉骨架”，但还没有形成“知识库业务闭环”。

### 2.3 本轮已落地结果

截至本次实现，前端已完成以下落地：

- 已新增知识库业务类型文件 `src/types/knowledge-base.ts`
- 已新增知识库 API 文件 `src/api/knowledge-base.ts`
- 已新增成员邀请 API 文件 `src/api/kb-member.ts`
- 已新增文档列表与文档操作 API 文件 `src/api/document.ts`
- 已新增列表页、详情页、成员管理的组合式封装：
  - `src/composables/useKnowledgeBaseList.ts`
  - `src/composables/useKnowledgeBaseDetail.ts`
  - `src/composables/useKbMembers.ts`
- `KbListView.vue` 已从静态假数据切换为真实接口数据
- `KbListView.vue` 已接入：
  - 我的知识库 / 公开知识库切换
  - ownership 筛选
  - visibility 筛选
  - 关键字搜索
  - 创建知识库
  - 编辑知识库
  - 删除知识库
  - 邀请码加入知识库
- `KbDetailView.vue` 已接入：
  - 知识库详情接口
  - 文档列表接口
  - 文档下载
  - 文档删除
  - 文档重解析
  - 成员列表
  - 邀请列表
  - 创建邀请
  - 取消邀请
  - 移除成员
  - 知识库设置更新
- 权限字段已驱动列表页、详情页中的按钮显隐
- 已完成前端 `vue-tsc + vite build` 编译验证

当前仍保留的边界如下：

- 成员列表接口后端当前仅对 `owner / manager` 开放，因此 `collaborator / member / publicVisitor` 暂无法展示成员只读列表
- 页面截图尚未补录到 `apps/frontend/docs/screenshots/`
- 真实后端环境下的多角色联调仍需继续执行

---

## 3. 页面截图基线

### 3.1 当前实现截图基线

- 本文档以 `2026-04-25` 当前前端“知识库列表页运行截图”为第一版基线。
- 该截图体现当前页面已具备：
  - 左侧导航
  - 顶部搜索
  - “新建知识库”按钮
  - 知识库卡片栅格
  - 底部系统状态栏
- 但该页面当前仍是静态数据展示，尚未接后端真实数据。

### 3.2 仓库内可复用设计参考图

可作为前端对接与后续截图对照的设计参考：

- [知识库列表设计稿](../../../docs/ui/main-kb.png)
- [知识库详情设计稿](../../../docs/ui/main-kb-i.png)
- [知识库移动端列表设计稿](../../../docs/ui/main-kb-i-mb.png)

### 3.3 本轮建议补齐的页面截图清单

联调完成后，建议统一补齐以下真实页面截图并沉淀到前端文档中：

1. 知识库列表页
2. 新建知识库弹窗
3. 编辑知识库弹窗
4. 知识库详情页-文档 Tab
5. 知识库详情页-成员 Tab
6. 知识库详情页-设置 Tab
7. 邀请列表弹窗或抽屉
8. 邀请码加入页或加入入口反馈
9. 不同权限角色下的页面差异截图

说明：

- 当前仓库尚未保存“真实运行截图”文件。
- 建议联调完成后在 `apps/frontend/docs/screenshots/` 下统一归档。
- 本轮代码已完成列表页与详情页真实数据接入，但尚未执行截图归档。

---

## 4. 后端接口对接范围

根据后端已完成能力，前端本轮需要对接以下接口。

### 4.1 知识库管理

- `POST /api/knowledge-bases`
- `GET /api/knowledge-bases`
- `GET /api/public/knowledge-bases`
- `GET /api/knowledge-bases/:kbId`
- `PATCH /api/knowledge-bases/:kbId`
- `DELETE /api/knowledge-bases/:kbId`

### 4.2 成员与邀请管理

- `GET /api/knowledge-bases/:kbId/members`
- `POST /api/knowledge-bases/:kbId/invitations`
- `GET /api/knowledge-bases/:kbId/invitations`
- `DELETE /api/knowledge-bases/:kbId/invitations/:invitationId`
- `POST /api/knowledge-bases/join`
- `DELETE /api/knowledge-bases/:kbId/members/:memberUserId`

### 4.3 后续与详情页联动的文档接口

当前详情页文档区最终还要继续对接：

- `GET /api/knowledge-bases/:kbId/documents`
- `GET /api/knowledge-bases/:kbId/documents/:documentId`
- `GET /api/knowledge-bases/:kbId/documents/:documentId/processing-tasks`

说明：

- 本文档优先级聚焦在“知识库管理 + 成员管理 + 权限联调”。
- 文档上传增强、处理进度展示属于同页后续增强项。

---

## 5. 推荐前端目录拆分

建议在 `apps/frontend/src` 中新增以下目录：

```txt
src/
  api/
    knowledge-base.ts
    kb-member.ts
  types/
    knowledge-base.ts
  composables/
    useKnowledgeBaseList.ts
    useKnowledgeBaseDetail.ts
    useKbMembers.ts
  stores/
    kb.ts
```

职责建议如下：

- `src/api/knowledge-base.ts`
  - 负责知识库 CRUD、列表与详情接口
- `src/api/kb-member.ts`
  - 负责成员、邀请、加入接口
- `src/types/knowledge-base.ts`
  - 维护知识库、成员、权限相关类型
- `src/composables/useKnowledgeBaseList.ts`
  - 负责列表页查询、筛选、分页、刷新
- `src/composables/useKnowledgeBaseDetail.ts`
  - 负责详情页数据、编辑、删除、重载
- `src/composables/useKbMembers.ts`
  - 负责成员列表、邀请列表、创建邀请、移除成员
- `src/stores/kb.ts`
  - 如后续需要跨页面缓存、共享查询条件，可集中放这里

---

## 6. 建议新增的前端类型

建议在 `src/types/knowledge-base.ts` 中定义以下核心结构。

### 6.1 权限结构

```ts
export interface KnowledgeBasePermissions {
  canView: boolean;
  canAsk: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canInvite: boolean;
  canUpload: boolean;
  canReparse: boolean;
  canDownload: boolean;
  canManageKnowledgeBase: boolean;
  canManageMembers: boolean;
  canDeleteAnyDocument: boolean;
  canDeleteOwnDocument: boolean;
  canReparseAnyDocument: boolean;
  canReparseOwnDocument: boolean;
}
```

### 6.2 角色结构

```ts
export type KnowledgeBaseAccessRole =
  | "owner"
  | "manager"
  | "collaborator"
  | "member"
  | "publicVisitor";
```

### 6.3 知识库列表项

```ts
export interface KnowledgeBaseListItem {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "shared";
  isPublic: boolean;
  allowPublicDownload: boolean;
  role: KnowledgeBaseAccessRole;
  permissions: KnowledgeBasePermissions;
  documentCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
```

### 6.4 知识库详情

```ts
export interface KnowledgeBaseDetail extends KnowledgeBaseListItem {
  ownerId: string;
}
```

### 6.5 成员与邀请

```ts
export interface KnowledgeBaseMemberItem {
  userId: string;
  email: string;
  username: string;
  avatar: string | null;
  role: "owner" | "manager" | "collaborator" | "member";
  joinedAt?: string;
}

export interface KnowledgeBaseInvitationItem {
  id: string;
  inviteCode: string;
  role: "manager" | "collaborator" | "member";
  status: "active" | "used" | "expired" | "cancelled";
  expiredAt: string;
  createdAt: string;
}
```

---

## 7. 页面拆分建议

### 7.1 知识库列表页 `KbListView.vue`

当前页面应承担以下能力：

- 获取“我的知识库列表”
- 支持 `owned / joined / all`
- 支持按 `private / shared` 切换
- 支持关键字搜索
- 支持分页或下拉加载
- 支持新建知识库
- 可选增加“公开知识库”切换页签

建议拆分：

- `KbToolbar`
  - 搜索框
  - 新建按钮
- `KbFilterBar`
  - 私有 / 共享 / 全部
- `KbGrid`
  - 卡片栅格
- `CreateKnowledgeBaseModal`
  - 新建知识库弹窗

### 7.2 知识库详情页 `KbDetailView.vue`

当前详情页建议真正拆成 3 个业务 Tab：

1. 文档
2. 成员
3. 设置

建议拆分：

- `KbDetailHeader`
  - 标题
  - 角色标识
  - 返回按钮
  - 删除 / 编辑 / 重新索引按钮
- `KbDetailTabs`
  - `documents`
  - `members`
  - `settings`
- `KbDocumentPanel`
  - 文档列表
  - 上传入口
  - 文档处理概览
- `KbMemberPanel`
  - 成员列表
  - 创建邀请
  - 邀请列表
  - 移除成员
- `KbSettingsPanel`
  - 基础信息
  - 共享 / 公开配置
  - 允许公开下载开关

### 7.3 邀请与加入流程

建议补两个体验入口：

- 详情页中创建邀请并复制邀请码
- 独立的“通过邀请码加入知识库”轻交互入口

实现方式可二选一：

1. 在知识库列表页右上角增加“加入共享库”按钮
2. 在 Command Palette 或顶部菜单中提供“输入邀请码加入”

---

## 8. 权限在前端的落地规则

前端权限不负责安全兜底，但必须负责：

- 按钮显隐
- 按钮禁用
- 文案差异
- 空态提示

### 8.1 列表页权限

- `canEdit = true`
  - 卡片菜单显示“编辑知识库”
- `canDelete = true`
  - 卡片菜单显示“删除知识库”
- `canInvite = true`
  - 卡片或详情页显示“邀请成员”
- `canUpload = true`
  - 详情页显示上传入口

### 8.2 详情页头部权限

- `canManageKnowledgeBase = true`
  - 显示“编辑知识库”
- `canDelete = true`
  - 显示“删除知识库”
- `canManageMembers = true`
  - 成员 Tab 可显示邀请与移除入口
- `canUpload = true`
  - 文档 Tab 显示上传区

### 8.3 成员 Tab 权限

- `owner / manager`
  - 可查看成员列表
  - 可查看邀请列表
  - 可创建邀请
  - 可移除成员
- `collaborator / member`
  - 只展示成员信息，不展示管理按钮
- `publicVisitor`
  - 默认不显示成员 Tab，或进入后展示“无权查看成员”

### 8.4 设置 Tab 权限

- `owner`
  - 可编辑名称、描述、公开状态、下载策略
- `manager`
  - 只读展示，不允许修改
- 其余角色
  - 不显示设置 Tab，或仅显示只读摘要

---

## 9. 角色差异在页面上的表现建议

### 9.1 owner

- 显示完整入口：
  - 编辑知识库
  - 删除知识库
  - 邀请成员
  - 上传文档
  - 重解析
  - 设置

### 9.2 manager

- 显示：
  - 邀请成员
  - 管理成员
  - 上传文档
  - 删除任意文档
  - 重解析任意文档
- 不显示：
  - 删除知识库
  - 修改知识库核心设置

### 9.3 collaborator

- 显示：
  - 上传文档
  - 自己上传文档的操作按钮
- 不显示：
  - 邀请成员
  - 设置
  - 删除任意文档

### 9.4 member

- 显示：
  - 文档列表
  - 问答入口
  - 下载入口
- 不显示：
  - 上传
  - 邀请
  - 设置
  - 删除 / 重解析

### 9.5 publicVisitor

- 仅在共享知识库公开时可进入
- 建议展示：
  - 公共访问标识
  - 文档列表或知识库摘要
  - 问答入口
- 若 `allowPublicDownload = false`
  - 下载按钮隐藏或置灰

---

## 10. 推荐开发顺序

补充说明：

- 本轮已完成“第一阶段、第二阶段、第三阶段”的主体落地，并实现了第四阶段中的成员与邀请管理主链路。
- 但“第五阶段权限联调”仍需在真实后端环境中使用多角色账号完成验证。

### 第一阶段：补齐业务 API 与类型

目标：

- 新增 `knowledge-base.ts`
- 新增 `kb-member.ts`
- 新增 `knowledge-base.ts` 类型文件

任务：

- [x] 新增知识库列表、详情、创建、编辑、删除接口封装
- [x] 新增成员列表、邀请列表、创建邀请、取消邀请、加入、移除接口封装
- [x] 新增权限、角色、成员、邀请等类型

### 第二阶段：接通知识库列表页

目标：

- 让 `KbListView.vue` 从假数据切到真实接口

任务：

- [x] 替换当前静态 `kbs`
- [x] 接入搜索、筛选、分页
- [x] 接入“新建知识库”弹窗
- [x] 接入“公开知识库列表”入口或后续预留

### 第三阶段：接通知识库详情页

目标：

- 让 `KbDetailView.vue` 从视觉页变成真实业务页

任务：

- [x] 请求详情接口
- [x] 头部展示真实名称、角色、权限
- [x] 文档 Tab 与真实文档列表联动
- [x] 详情页按钮根据权限控制

### 第四阶段：接通成员与邀请管理

目标：

- 完成成员页和邀请页的前后端联调

任务：

- [x] 展示成员列表
- [x] 创建邀请
- [x] 查看邀请列表
- [x] 取消邀请
- [x] 移除成员
- [x] 接入邀请码加入知识库入口

### 第五阶段：完成权限驱动联调

目标：

- 同一页面在不同角色下表现正确

任务：

- [ ] owner 联调
- [ ] manager 联调
- [ ] collaborator 联调
- [ ] member 联调
- [ ] publicVisitor 联调

说明：

- 页面层已接入基础权限显隐。
- 上述 5 项当前仍表示“真实环境多账号联调未完成”，不是“前端未编码”。

---

## 11. 联调验收清单

### 11.1 知识库管理

- [ ] 可以创建私有知识库
- [ ] 可以创建共享知识库
- [ ] 共享知识库可配置是否公开
- [ ] 私有知识库列表展示正确
- [ ] 共享知识库列表展示正确
- [ ] 公开知识库列表展示正确
- [ ] 可以编辑知识库信息
- [ ] 可以删除知识库

### 11.2 成员与邀请

- [ ] owner 可查看成员列表
- [ ] manager 可查看成员列表
- [ ] collaborator 不显示成员管理操作
- [ ] member 不显示成员管理操作
- [ ] 可创建不同角色邀请
- [ ] 可取消邀请
- [ ] 可通过邀请码加入
- [ ] 可移除成员

### 11.3 权限渲染

- [ ] owner 显示设置和删除入口
- [ ] manager 不显示知识库删除与核心设置
- [ ] collaborator 仅显示上传与自身文档管理相关入口
- [ ] member 仅显示只读能力
- [ ] publicVisitor 在未公开知识库中无法访问
- [ ] publicVisitor 在公开知识库中行为符合公开策略

### 11.4 异常与边界

- [ ] 无权限访问详情时正确跳转或提示
- [ ] 邀请已过期时错误提示正确
- [ ] 邀请已取消时错误提示正确
- [ ] 空成员列表展示正确
- [ ] 空邀请列表展示正确
- [ ] 空知识库列表展示正确

---

## 12. 与当前页面截图的对应改造建议

结合当前知识库列表页截图，建议按以下方向演进：

### 12.1 保持不变的部分

- 左侧导航结构
- 顶部搜索 + 新建按钮布局
- 卡片式知识库列表布局
- 暗色主题与现有视觉语言

### 12.2 需要从静态改为真实数据的部分

- 卡片标题
- 文档数量
- 成员数量
- 知识库类型
- 创建时间
- 点击跳转详情页
- 角色标识和权限驱动的操作菜单

### 12.3 建议新增的视觉提示

- 当前角色徽标，例如 `owner / manager / collaborator / member`
- 公开状态徽标，例如“共享-公开”与“共享-成员可见”
- 无权限时的只读提示
- 成员管理面板中的邀请状态标签

---

## 13. 后续截图归档建议

建议后续在 `apps/frontend/docs/screenshots/` 下建立如下结构：

```txt
apps/frontend/docs/screenshots/
  kb-list/
  kb-detail/
  kb-members/
  kb-settings/
  permission-states/
```

推荐命名方式：

- `kb-list-owner.png`
- `kb-list-member.png`
- `kb-detail-documents-owner.png`
- `kb-detail-members-manager.png`
- `kb-detail-settings-owner.png`
- `kb-public-visitor-readonly.png`

---

## 14. 结论

当前前端知识库模块的核心问题不是“缺页面”，而是：

1. 页面仍以静态假数据为主
2. 缺少知识库与成员业务 API 层
3. 缺少权限驱动的真实页面逻辑
4. 尚未完成与后端能力的联调闭环

因此，最合理的前端推进顺序是：

1. 先补 API 与类型
2. 再接列表页与详情页
3. 再接成员与邀请管理
4. 再做权限联调
5. 最后补齐真实页面截图与文档归档

如果继续执行，下一步建议直接开始编码以下 3 个文件：

- `src/api/knowledge-base.ts`
- `src/api/kb-member.ts`
- `src/types/knowledge-base.ts`

## 15. 本轮实现回写

本轮实际已修改或新增的核心文件如下：

- `src/types/knowledge-base.ts`
- `src/api/knowledge-base.ts`
- `src/api/kb-member.ts`
- `src/api/document.ts`
- `src/composables/useKnowledgeBaseList.ts`
- `src/composables/useKnowledgeBaseDetail.ts`
- `src/composables/useKbMembers.ts`
- `src/components/kb/KbCard.vue`
- `src/components/kb/FilterBar.vue`
- `src/views/kb/KbListView.vue`
- `src/views/kb/KbDetailView.vue`
- `tsconfig.app.json`

本轮完成的工程检查：

- 已通过编辑器诊断检查
- 已通过 `pnpm --filter frontend build`

本轮尚未完成的联调事项：

- 真实后端环境下 owner / manager / collaborator / member / publicVisitor 五类身份联调
- 页面截图归档
- 协作者与普通成员的“只读成员列表”能力设计确认
