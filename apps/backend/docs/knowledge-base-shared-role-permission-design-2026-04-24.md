# 共享知识库角色与权限设计方案

## 1. 文档目标

本文档用于明确共享知识库场景下的角色模型、权限边界、数据设计建议与后端实现约束，作为后续成员管理、文档管理与权限校验落地的统一依据。

本文档聚焦以下问题：

- 共享知识库需要划分哪些角色
- 各角色分别具备哪些知识库级、成员级、文档级权限
- 公开访问者是否属于成员体系
- 下载权限应如何设计
- 当前 Prisma 结构需要如何承接这套权限模型

## 2. 设计结论

共享知识库统一采用以下 `5` 类访问身份：

1. `owner`
2. `manager`
3. `collaborator`
4. `member`
5. `publicVisitor`

其中：

- `owner / manager / collaborator / member` 属于成员体系
- `publicVisitor` 不属于成员体系，只是因为知识库公开而获得访问资格

统一规则如下：

- 受邀加入共享知识库时，默认角色为 `member`
- 创建邀请时可指定目标角色为 `manager / collaborator / member`
- 成员体系默认可下载文件
- `publicVisitor` 是否可下载文件，由知识库 `allowPublicDownload` 控制
- `manager` 可以管理成员
- `collaborator` 可以上传文件，但只能管理自己上传的文件
- `member` 为只读角色

## 3. 角色定义

### 3.1 owner

知识库所有者，也即创建者。

职责与定位：

- 负责知识库的最终控制权
- 负责知识库设置管理
- 负责成员管理
- 负责全部文件管理

### 3.2 manager

共享知识库中的高级协作者，具备成员管理与全部文件管理能力，但不拥有知识库所有权。

职责与定位：

- 负责协助 owner 管理成员
- 负责全部文档管理
- 不具备 owner 级别的知识库核心控制权

### 3.3 collaborator

共享知识库中的内容协作者，具备上传能力，但仅能管理自己上传的文件。

职责与定位：

- 负责协作上传文档
- 负责维护自己上传的文件
- 不负责成员管理与知识库设置管理

### 3.4 member

共享知识库中的默认加入角色，定位为只读成员。

职责与定位：

- 负责查看与使用知识库内容
- 不参与文件维护
- 不参与成员管理

### 3.5 publicVisitor

公开共享知识库的普通访问者，不属于成员体系。

职责与定位：

- 因知识库公开而获得查看和问答资格
- 不具有成员身份
- 不参与成员管理、文档上传和文档维护

说明：

- 公开可见不等于已加入知识库
- `publicVisitor` 不应写入 `b_kb_members`

## 4. 权限矩阵

| 操作                  | owner          | manager        | collaborator   | member         | publicVisitor                 |
| --------------------- | -------------- | -------------- | -------------- | -------------- | ----------------------------- |
| 查看知识库详情        | 是             | 是             | 是             | 是             | 公开时是                      |
| 搜索发现知识库        | 由公开状态决定 | 由公开状态决定 | 由公开状态决定 | 由公开状态决定 | 公开时是                      |
| 修改知识库名称/描述   | 是             | 否             | 否             | 否             | 否                            |
| 修改公开状态/下载策略 | 是             | 否             | 否             | 否             | 否                            |
| 删除知识库            | 是             | 否             | 否             | 否             | 否                            |
| 查看成员列表          | 是             | 是             | 否             | 否             | 否                            |
| 邀请成员              | 是             | 是             | 否             | 否             | 否                            |
| 移除成员              | 是             | 是             | 否             | 否             | 否                            |
| 上传文件              | 是             | 是             | 是             | 否             | 否                            |
| 查看文档列表          | 是             | 是             | 是             | 是             | 公开时是                      |
| 下载文档              | 是             | 是             | 是             | 是             | 由 `allowPublicDownload` 决定 |
| 删除任意文件          | 是             | 是             | 否             | 否             | 否                            |
| 删除自己上传的文件    | 是             | 是             | 是             | 否             | 否                            |
| 重解析任意文件        | 是             | 是             | 否             | 否             | 否                            |
| 重解析自己上传的文件  | 是             | 是             | 是             | 否             | 否                            |
| 发起知识库问答        | 是             | 是             | 是             | 是             | 公开时是                      |

## 5. 关键权限规则

### 5.1 成员体系与公开访问必须分离

必须明确区分以下两类身份：

- 成员体系身份：`owner / manager / collaborator / member`
- 公开访问身份：`publicVisitor`

这意味着：

- 用户可以因为知识库公开而访问，但并不自动成为成员
- 用户只有在邀请码加入或明确执行“加入知识库”后，才会进入成员体系

### 5.2 manager 可以管理成员，但不具备 owner 级权限

`manager` 具备以下能力：

- 查看成员列表
- 发起邀请
- 移除成员
- 上传文档
- 删除任意文档
- 重解析任意文档

但不具备以下能力：

- 修改知识库核心设置
- 修改公开状态
- 删除知识库
- 转移所有权

### 5.3 collaborator 只能管理自己上传的文件

`collaborator` 具备以下能力：

- 上传文档
- 删除自己上传的文档
- 重解析自己上传的文档

`collaborator` 不具备以下能力：

- 删除他人上传的文档
- 重解析他人上传的文档
- 管理成员
- 修改知识库设置

### 5.4 member 为默认只读角色

`member` 用作最安全的默认加入角色：

- 可读
- 可下载
- 可问答
- 不可上传
- 不可删除文档
- 不可管理成员

### 5.5 下载策略只控制公开访客

为避免协作体验被过度限制，下载策略建议如下：

- 成员体系默认可下载
- `publicVisitor` 是否可下载，由 `allowPublicDownload` 控制

这意味着：

- `allowPublicDownload = false` 时，不影响 `owner / manager / collaborator / member`
- `allowPublicDownload = true` 时，公开访客才可下载文件

## 6. 数据设计建议

### 6.1 `b_kb_members.role`

该字段应从“预留字段”升级为“真实生效字段”。

建议值：

- `manager`
- `collaborator`
- `member`

说明：

- `owner` 不写入 `b_kb_members`
- `owner` 直接由 `b_knowledge_bases.owner_id` 表示

### 6.2 `b_documents.uploader_id`

该字段必须参与权限判断。

用途：

- 判断文档是否由当前用户上传
- 支撑 `collaborator` 删除自己上传的文件
- 支撑 `collaborator` 重解析自己上传的文件

### 6.3 `b_kb_invitations.role`

邀请记录建议直接带目标角色。

用途：

- owner / manager 发起邀请时指定加入角色
- 用户接受邀请后，将该角色写入 `b_kb_members.role`

### 6.4 `b_knowledge_bases`

继续保留以下字段：

- `visibility`
- `is_public`
- `allow_public_download`

其含义分别为：

- `visibility`：知识库基础类型，例如 `private / shared`
- `is_public`：共享知识库是否向普通登录用户公开
- `allow_public_download`：公开访客是否允许下载文件

## 7. 后端权限判断建议

后端实现时，不建议仅判断“是否成员”，而应按具体动作判断。

建议抽象为统一权限判断函数：

- `canReadKnowledgeBase`
- `canManageKnowledgeBase`
- `canManageMembers`
- `canUploadDocument`
- `canDeleteAnyDocument`
- `canDeleteOwnDocument`
- `canReparseAnyDocument`
- `canReparseOwnDocument`
- `canDownloadDocument`

这样可以避免：

- Controller 中散落大量权限 if/else
- 文档删除和重解析逻辑混乱
- 不同接口使用不一致的权限标准

## 8. 接口语义建议

### 8.1 邀请接口

创建邀请时：

- 默认角色为 `member`
- 可由 owner / manager 指定为 `manager / collaborator / member`

### 8.2 加入接口

用户加入共享知识库时：

- 根据邀请记录中的 `role` 写入成员关系
- 如果后续支持“公开加入”，则默认写入 `member`

### 8.3 文档删除接口

删除文档时应区分：

- `owner / manager`：可删除任意文档
- `collaborator`：仅可删除 `uploader_id = currentUserId` 的文档
- `member / publicVisitor`：不可删除

### 8.4 文档重解析接口

重解析文档时应区分：

- `owner / manager`：可重解析任意文档
- `collaborator`：仅可重解析自己上传的文档
- `member / publicVisitor`：不可重解析

## 9. 当前版本落地建议

如果下一阶段准备从现有简单角色模型升级到本方案，建议按以下顺序落地：

1. 启用 `b_kb_members.role`
2. 补齐成员与邀请接口
3. 在文档接口中接入 `uploader_id` 权限判断
4. 抽出统一权限服务
5. 再扩展公开访问者与下载策略

## 10. 最终结论

共享知识库的确定方案如下：

- 成员体系采用 `owner / manager / collaborator / member`
- 公开访问者单独定义为 `publicVisitor`
- `manager` 可以管理成员，但不具备 owner 级知识库设置权限
- `collaborator` 可以上传，并且只能管理自己上传的文件
- `member` 作为默认加入角色，仅具备只读能力
- 下载策略只控制公开访客，不影响成员体系

该方案兼顾了：

- 协作灵活性
- 权限边界清晰性
- 后端实现可控性
- 当前项目阶段下的复杂度可接受性
