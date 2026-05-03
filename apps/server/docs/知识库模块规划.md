# 知识库模块后端规划方案

## 1. 文档目标

本文档用于在**规划阶段**明确知识库模块的后端实现范围，输出以下内容：

- 基于需求分析与可行性分析，梳理知识库模块需要承载的业务能力
- 设计知识库模块所需的后端接口
- 规划需要新增的 Nest.js 文件、职责划分与核心实现逻辑
- 标记当前仓库与目标方案之间的差距，以及需要进一步确认的决策点

本文档**不包含具体编码实现**，仅作为后续开发排期与接口落地的设计依据。

## 2. 设计依据

本方案主要基于以下文档与当前仓库现状：

- `docs/01-requirement-analysis.md`
- `docs/02-feasibility-analysis.md`
- `docs/05-backend_infra_implementation.md`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/modules/auth`
- `apps/backend/src/modules/user`

## 3. 当前后端现状与差距

### 3.1 已具备能力

当前后端已经具备以下基础设施，可以直接复用：

- Nest.js + Prisma 基础项目结构
- 统一响应包装 `ResponseInterceptor`
- 统一异常治理 `BusinessException` + `AllExceptionsFilter`
- JWT 鉴权、`@Auth()`、`@CurrentUser()`
- 用户、认证、邮件验证码模块
- 环境变量中已预留 `QDRANT_URL`、`REDIS_URL`、`REDIS_PASSWORD`
- Prisma 中已预留知识库、成员、邀请、文档、分块等表结构

### 3.2 当前缺失能力

知识库模块真正落地前，当前仓库还缺少以下关键实现：

- 知识库 Nest 模块本身尚未创建
- 文件上传能力尚未接入
- 文档异步解析队列尚未接入
- Redis / BullMQ 尚未接入业务代码
- Qdrant 向量写入与检索能力尚未封装
- 文档解析 Worker 尚未实现
- SSE 问答流式能力尚未实现

### 3.3 现有数据结构与目标能力的差距

当前 `schema.prisma` 虽已预留核心表，但仍有几个需要注意的点：

- 可行性文档推荐 `PostgreSQL`，但当前 Prisma `datasource` 仍为 `mysql`
- `b_knowledge_bases` 已新增 `is_public`、`allow_public_download` 字段，但业务文档、DTO 设计与接口入参必须保持一致
- `b_document_chunks` 已补充页码、字符区间、向量主键等溯源字段，后续重点应转向统一写入与回填流程
- `b_kb_invitations` 已补充取消、接受人、接受时间等追踪字段，后续重点应转向状态归一化与接口语义统一
- `b_documents.status` 当前语义过粗，后续建议细化为异步解析状态机

结论：知识库模块可以按现有骨架继续规划，但正式开发前建议先确认**数据库选型**与**文档解析元数据字段**。

## 4. 知识库模块业务边界

本次规划中的“知识库模块”建议覆盖以下四类能力：

1. **知识库管理**
   - 创建知识库
   - 编辑知识库信息
   - 查看知识库详情
   - 删除知识库
   - 获取我的知识库列表

2. **成员与邀请管理**
   - 共享知识库发起邀请
   - 使用邀请码加入共享知识库
   - 查看成员列表
   - 移除成员
   - 查看/取消未失效邀请

3. **文档管理**
   - 上传文档
   - 查看文档列表
   - 查看文档详情与解析状态
   - 下载文档
   - 删除文档
   - 手动触发重新解析

4. **解析与向量化编排**
   - 文档入库
   - 异步解析
   - Chunk 切分
   - Embedding 调用
   - Qdrant 写入
   - 状态回写

说明：

- **问答对话模块**、**会话消息模块**、**联网搜索模块**不属于本文档的主体，但知识库模块需要为后续 RAG 提供干净的文档与权限边界。
- 后台管理对共享知识库的封禁、统计、审计属于后台模块，不放入本次前台知识库模块 API 清单。

## 5. 功能拆解

### 5.1 知识库管理

知识库分为两类：

- `private`：私有知识库，仅创建者可见，不可被搜索
- `shared`：共享知识库，支持邀请成员协作

其中，共享知识库还需要支持一个公开开关：

- `isPublic = false`：仅创建者与受邀成员可见，不可被搜索
- `isPublic = true`：登录用户可搜索、查看并基于知识库发起问答

建议本期支持的字段：

- `name`
- `description`
- `visibility`
- `isPublic`
- `allowPublicDownload`

建议不在本期纳入的字段：

- 封面图
- 标签体系
- 自定义排序权重
- 多级目录

### 5.2 成员与邀请

根据需求文档，共享知识库场景需要满足：

- 创建者可邀请成员加入共享知识库
- 成员角色需要区分 `manager / collaborator / member`
- 成员体系默认可访问共享知识库内容并下载文件
- `manager` 可管理成员并管理全部文件
- `collaborator` 可上传文件，但仅能管理自己上传的文件
- `member` 为只读角色
- 共享知识库即使开启开源，仍可继续维护协作者关系
- 公开访问者 `publicVisitor` 不进入成员关系模型

本期推荐的共享协作模型：

- 创建者身份直接由 `b_knowledge_bases.owner_id` 表示
- 成员身份使用 `b_kb_members`
- 邀请通过 `invite_code` 完成加入，用于 `shared`
- `b_kb_members.role` 使用 `manager / collaborator / member`
- `b_kb_invitations.role` 记录受邀后的目标角色，默认 `member`
- `publicVisitor` 由 `visibility = shared` 且 `isPublic = true` 的业务规则动态判定，不写入成员表

### 5.3 文档管理

文档上传后不应同步完成所有处理，而应采用异步状态流转：

1. 用户上传文件
2. 服务端保存文件元数据并落盘/存储
3. 创建 `b_documents` 记录，状态记为 `uploaded`
4. 投递 `parse-document` 队列任务
5. Worker 执行文本提取、切分、Embedding、Qdrant 写入
6. 状态更新为 `ready` 或 `failed`

### 5.4 权限与隔离

知识库模块权限建议按以下规则执行：

- 私有知识库：只有所有者可访问，不可被搜索
- 共享知识库（未开源）：
  - `owner`：完全控制
  - `manager`：可查看、可下载、可参与问答、可管理成员、可上传、可删除和重解析任意文档，但不可修改知识库设置
  - `collaborator`：可查看、可下载、可参与问答、可上传、仅可删除和重解析自己上传的文档
  - `member`：可查看、可下载、可参与问答，不可上传、不可管理成员、不可删除文档、不可重解析
  - 非成员：不可访问、不可搜索
- 共享知识库（已开源）：
  - `owner / manager / collaborator / member`：保持各自成员权限
  - `publicVisitor`：可搜索、可查看、可参与问答，文件下载由知识库配置 `allowPublicDownload` 决定
- 向量检索时必须同时结合 `kbId`、`visibility`、`isPublic`、当前用户身份进行过滤
- 若未来增加后台监控，只允许后台读取**共享知识库**统计信息，不直接进入私有知识库内容

## 6. 角色权限矩阵

| 场景           | 私有库创建者 | 共享库 owner | 共享库 manager | 共享库 collaborator | 共享库 member | 已开源共享库 publicVisitor |
| -------------- | ------------ | ------------ | --------------- | ------------------- | ------------- | -------------------------- |
| 查看知识库详情 | 是           | 是           | 是              | 是                  | 是            | 是                         |
| 搜索发现知识库 | 否           | 由开源状态决定 | 由开源状态决定 | 由开源状态决定      | 由开源状态决定 | 是                         |
| 编辑知识库信息 | 是           | 是           | 否              | 否                  | 否            | 否                         |
| 删除知识库     | 是           | 是           | 否              | 否                  | 否            | 否                         |
| 查看成员列表   | 否           | 是           | 是              | 否                  | 否            | 否                         |
| 发起邀请       | 否           | 是           | 是              | 否                  | 否            | 否                         |
| 取消邀请       | 否           | 是           | 是              | 否                  | 否            | 否                         |
| 移除成员       | 否           | 是           | 是              | 否                  | 否            | 否                         |
| 上传文档       | 是           | 是           | 是              | 是                  | 否            | 否                         |
| 查看文档列表   | 是           | 是           | 是              | 是                  | 是            | 是                         |
| 下载文档       | 是           | 是           | 是              | 是                  | 是            | 由公开策略决定             |
| 删除任意文档   | 是           | 是           | 是              | 否                  | 否            | 否                         |
| 删除自己文档   | 是           | 是           | 是              | 是                  | 否            | 否                         |
| 重解析任意文档 | 是           | 是           | 是              | 否                  | 否            | 否                         |
| 重解析自己文档 | 是           | 是           | 是              | 是                  | 否            | 否                         |
| 发起知识库问答 | 是           | 是           | 是              | 是                  | 是            | 是                         |

说明：

- `publicVisitor` 不属于成员体系，公开访问不等于加入知识库。
- 成员体系默认可下载，`allowPublicDownload` 只控制公开访客下载。
- `collaborator` 的文档删除与重解析权限依赖 `b_documents.uploader_id` 判断。

## 7. 推荐状态设计

### 7.1 知识库状态

- `normal`：正常可用
- `disabled`：前台不可用，保留数据
- `banned`：后台封禁

### 7.2 邀请状态

当前表结构是 `is_used + expired_at`，规划阶段建议统一抽象为：

- `active`
- `used`
- `expired`
- `cancelled`

即使数据库暂不新增枚举字段，业务层也应统一对外输出该语义。

### 7.3 文档状态

建议将 `b_documents.status` 细化为：

- `uploaded`：已上传，待入队
- `queued`：已进入解析队列
- `parsing`：正在抽取文本
- `chunking`：正在切片
- `embedding`：正在生成向量
- `ready`：可检索
- `failed`：处理失败
- `deleted`：逻辑删除时可选

说明：

- 如果本期只做物理删除，可以不使用 `deleted`
- 前端主要关注 `queued / parsing / ready / failed`

## 8. 后端接口设计

统一约定：

- 所有接口均挂在 `/api`
- 所有成功响应均由全局拦截器统一包装
- 所有需要登录的接口统一使用 `@UseGuards(AuthGuard)` + `@Auth()`
- 下面仅列出业务数据结构与核心逻辑，不重复描述统一响应壳

### 8.1 知识库管理接口

#### 1. 创建知识库

- `POST /api/knowledge-bases`
- 权限：登录用户
- 请求体：
  - `name: string`
  - `description?: string`
  - `visibility: 'private' | 'shared'`
  - `isPublic?: boolean`
  - `allowPublicDownload?: boolean`
- 核心逻辑：
  - 校验名称长度与可见性
  - 当 `visibility = private` 时，强制 `isPublic = false`
  - 创建 `b_knowledge_bases`
  - `owner_id` 取当前用户
  - 默认 `status = normal`

#### 2. 获取我的知识库列表

- `GET /api/knowledge-bases`
- 权限：登录用户
- 查询参数建议：
  - `ownership?: 'owned' | 'joined' | 'all'`
  - `visibility?: 'private' | 'shared'`
  - `keyword?: string`
  - `page`
  - `pageSize`
- 核心逻辑：
  - 查询本人创建的知识库
  - 查询本人加入的共享知识库
  - 聚合返回基础统计：
    - 文档数量
    - 成员数量
    - 最近更新时间

#### 3. 获取公开知识库列表

- `GET /api/public/knowledge-bases`
- 权限：登录用户
- 查询参数建议：
  - `keyword?: string`
  - `page`
  - `pageSize`
  - `sortBy?: 'latest' | 'hot'`
- 核心逻辑：
  - 仅返回 `visibility = shared`、`isPublic = true` 且 `status = normal` 的知识库
  - 返回基础信息与公开访问统计

#### 4. 获取知识库详情

- `GET /api/knowledge-bases/:kbId`
- 权限：所有者、共享成员、普通登录用户（仅当知识库为已开源共享库）
- 核心逻辑：
  - 校验知识库是否存在
  - 校验当前用户是否可访问
  - 返回基础信息、权限标识、统计信息

#### 5. 更新知识库信息

- `PATCH /api/knowledge-bases/:kbId`
- 权限：创建者
- 请求体：
  - `name?: string`
  - `description?: string`
  - `visibility?: 'private' | 'shared'`
  - `isPublic?: boolean`
  - `allowPublicDownload?: boolean`
- 核心逻辑：
  - 校验当前用户是否为 owner
  - 若从 `shared -> private`，需先确认是否存在成员
  - 若 `visibility = private`，强制 `isPublic = false` 且 `allowPublicDownload = false`
  - 若关闭开源开关，需同步调整公开搜索暴露范围
  - 更新知识库基本信息

#### 6. 删除知识库

- `DELETE /api/knowledge-bases/:kbId`
- 权限：创建者
- 核心逻辑：
  - 删除知识库记录
  - 级联删除成员、邀请、文档、Chunk
  - 同步删除 Qdrant 中 `kbId` 对应向量
  - 同步删除对象存储/本地文件

说明：

- 删除知识库是高风险操作，建议后续增加二次确认字段，例如 `confirmName`

### 8.2 成员与邀请接口

说明：

- 本节接口适用于所有共享知识库
- 共享知识库是否开源，不影响成员与邀请管理

#### 7. 获取成员列表

- `GET /api/knowledge-bases/:kbId/members`
- 权限：共享库创建者、共享库成员
- 核心逻辑：
  - 私有库直接返回仅 owner
  - 共享库返回 owner + members
  - 标记当前用户角色

#### 8. 创建邀请

- `POST /api/knowledge-bases/:kbId/invitations`
- 权限：共享库创建者
- 请求体建议：
  - `expiredInHours?: number`
- 核心逻辑：
  - 校验当前知识库必须为 `shared`
  - 生成随机 `invite_code`
  - 写入 `b_kb_invitations`
  - 返回邀请码与过期时间

#### 9. 获取邀请列表

- `GET /api/knowledge-bases/:kbId/invitations`
- 权限：共享库创建者
- 核心逻辑：
  - 仅返回未删除、未使用、未过期邀请
  - 便于前端管理分享链接

#### 10. 取消邀请

- `DELETE /api/knowledge-bases/:kbId/invitations/:invitationId`
- 权限：共享库创建者
- 核心逻辑：
  - 校验邀请归属
  - 将邀请标记为失效

#### 11. 通过邀请码加入知识库

- `POST /api/knowledge-bases/join`
- 权限：登录用户
- 请求体：
  - `inviteCode: string`
- 核心逻辑：
  - 校验邀请码存在、未使用、未过期
  - 校验知识库为 `shared`
  - 校验当前用户不是 owner，且尚未加入
  - 创建 `b_kb_members`
  - 将邀请置为已使用

#### 12. 移除成员

- `DELETE /api/knowledge-bases/:kbId/members/:memberUserId`
- 权限：共享库创建者
- 核心逻辑：
  - 不允许移除 owner
  - 删除成员关系
  - 该成员后续对知识库与检索内容立即失去访问权限

### 8.3 文档管理接口

#### 13. 上传文档

- `POST /api/knowledge-bases/:kbId/documents`
- 权限：知识库创建者
- 请求类型：`multipart/form-data`
- 表单字段建议：
  - `file`
- 核心逻辑：
  - 校验知识库权限
  - 校验文件类型与大小
  - 计算 `file_hash`
  - 保存源文件
  - 创建 `b_documents`
  - 推送 `parse-document` 任务
  - 返回文档记录与当前状态

#### 14. 获取文档列表

- `GET /api/knowledge-bases/:kbId/documents`
- 权限：所有者、共享成员、普通登录用户（仅已开源共享库）
- 查询参数建议：
  - `keyword?: string`
  - `status?: string`
  - `page`
  - `pageSize`
- 核心逻辑：
  - 返回文档基础信息
  - 包含上传时间、状态、大小、类型、失败原因

#### 15. 获取文档详情

- `GET /api/knowledge-bases/:kbId/documents/:documentId`
- 权限：所有者、共享成员、普通登录用户（仅已开源共享库）
- 核心逻辑：
  - 返回文档详情
  - 可附带解析进度、Chunk 数量、Token 统计

#### 16. 下载文档

- `GET /api/knowledge-bases/:kbId/documents/:documentId/download`
- 权限：所有者、共享成员、普通登录用户（仅当公开策略允许下载）
- 核心逻辑：
  - 校验文档归属与访问权限
  - 从存储层读取源文件并回传

#### 17. 删除文档

- `DELETE /api/knowledge-bases/:kbId/documents/:documentId`
- 权限：知识库创建者
- 核心逻辑：
  - 删除数据库记录
  - 删除本地/对象存储源文件
  - 删除 `b_document_chunks`
  - 删除 Qdrant 中对应向量

#### 18. 重新解析文档

- `POST /api/knowledge-bases/:kbId/documents/:documentId/reparse`
- 权限：知识库创建者
- 核心逻辑：
  - 将旧 Chunk 与旧向量清理
  - 重置文档状态
  - 重新推入队列

### 8.4 预留内部接口或内部服务能力

以下能力建议作为**服务内部调用**，而不是对前台暴露 HTTP API：

- `enqueueDocumentParse(documentId)`
- `parseDocument(documentId)`
- `splitDocument(documentId)`
- `embedChunks(documentId)`
- `upsertChunksToQdrant(documentId, kbId)`
- `deleteVectorsByDocument(documentId)`
- `assertKnowledgeBaseReadable(userId, kbId)`
- `assertKnowledgeBaseWritable(userId, kbId)`

## 9. 接口实现逻辑规划

### 9.1 知识库查询逻辑

核心要求：

- “我的知识库”列表必须同时兼容：
  - 我创建的私有库
  - 我创建的共享库
  - 我加入的共享库
- 公开知识库列表必须独立于“我的知识库”列表，不与成员关系耦合
- 返回数据时应明确前端可用权限，例如：
  - `canEdit`
  - `canDelete`
  - `canInvite`
  - `canUpload`
  - `canReparse`

建议不要把权限判断散落在每个 Service 方法里，而是抽出统一权限服务。

### 9.2 成员与邀请逻辑

说明：

- 仅共享知识库进入本节逻辑
- 是否开源不影响邀请码、成员校验链路

邀请链路的关键校验顺序建议固定为：

1. 邀请码是否存在
2. 是否过期
3. 是否已使用
4. 是否属于共享知识库
5. 当前用户是否已经是 owner
6. 当前用户是否已经加入

这样可以避免错误提示混乱，也便于异常码统一。

### 9.3 文档上传逻辑

上传接口建议只做三件事：

1. 权限与文件校验
2. 文件保存与元数据落库
3. 投递异步任务

不要在 Controller 或同步请求中执行以下耗时操作：

- PDF 全量解析
- Chunk 切分
- Embedding
- Qdrant 写入

### 9.4 异步解析逻辑

建议采用以下流水线：

1. `DocumentService.upload()` 创建文档记录
2. `DocumentParseQueueService.enqueue(documentId)` 入队
3. `DocumentParseProcessor.process(documentId)` 消费任务
4. `DocumentParserService.extractText(filePath)` 抽取文本
5. `DocumentChunkService.createChunks(documentId, text)` 保存分块
6. `VectorService.upsertDocumentChunks(documentId, kbId)` 写入向量库
7. 回写文档状态、Token 数、失败原因

### 9.5 溯源与引用逻辑

为了支撑后续“回答附带来源引用”的需求，建议从现在开始保留以下元数据：

- 文档名
- 文档 ID
- 知识库 ID
- Chunk 序号
- 页码
- 字符范围或段落偏移
- 原始文件路径或对象存储 key

其中：

- 关系型数据库保存结构化记录
- Qdrant Payload 保存检索所需过滤与引用字段

## 10. 建议新增或调整的数据字段

### 10.1 `b_documents`

建议补充评估以下字段：

- `uploader_id`
- `storage_type`
- `original_filename`
- `mime_type`
- `parse_started_at`
- `parse_finished_at`
- `last_reparse_at`

### 10.2 `b_document_chunks`

建议补充以下字段：

- `page_no`
- `char_start`
- `char_end`
- `vector_id`
- `metadata_json`

### 10.3 `b_kb_invitations`

建议补充以下字段：

- `cancelled_at`
- `accepted_by`
- `accepted_at`

### 10.4 错误码

当前项目已预留部分知识库与文件错误码，但建议补充更细粒度错误码，例如：

- `KNOWLEDGE_INVITATION_EXPIRED`
- `KNOWLEDGE_INVITATION_USED`
- `KNOWLEDGE_MEMBER_REMOVE_SELF_FORBIDDEN`
- `DOCUMENT_PARSE_FAILED`
- `DOCUMENT_REPARSE_CONFLICT`
- `DOCUMENT_VECTOR_DELETE_FAILED`

## 11. 文件创建规划

考虑到知识库模块后续会继续扩展，建议不要把所有逻辑都塞进一个 `knowledge-base.service.ts`，而采用“单模块、多控制器、多服务”的结构。

### 11.1 模块目录规划

建议新增：

```text
apps/backend/src/modules/knowledge-base/
  knowledge-base.module.ts
  controllers/
    knowledge-base.controller.ts
    kb-member.controller.ts
    kb-document.controller.ts
  services/
    knowledge-base.service.ts
    kb-member.service.ts
    kb-document.service.ts
    kb-permission.service.ts
  dto/
    create-knowledge-base.dto.ts
    update-knowledge-base.dto.ts
    list-knowledge-bases.dto.ts
    create-kb-invitation.dto.ts
    join-kb.dto.ts
    list-kb-documents.dto.ts
  interfaces/
    knowledge-base-access.interface.ts
```

### 11.2 文档处理与基础设施规划

建议新增：

```text
apps/backend/src/modules/document-processing/
  document-processing.module.ts
  document-parse.queue.ts
  document-parse.processor.ts
  document-parser.service.ts
  document-chunk.service.ts

apps/backend/src/common/storage/
  file-storage.module.ts
  file-storage.service.ts

apps/backend/src/common/vector/
  qdrant.module.ts
  qdrant.service.ts
```

### 11.3 各文件职责说明

- `knowledge-base.controller.ts`
  - 负责知识库 CRUD 接口
- `kb-member.controller.ts`
  - 负责成员、邀请、加入等接口
- `kb-document.controller.ts`
  - 负责文档上传、列表、删除、下载、重解析接口
- `knowledge-base.service.ts`
  - 负责知识库主业务逻辑
- `kb-member.service.ts`
  - 负责成员关系与邀请码逻辑
- `kb-document.service.ts`
  - 负责文档元数据、状态流转、任务投递
- `kb-permission.service.ts`
  - 负责统一权限断言，避免重复代码
- `document-parse.processor.ts`
  - 负责队列消费与异步解析执行
- `document-parser.service.ts`
  - 负责不同文件类型的文本抽取
- `document-chunk.service.ts`
  - 负责文本切块与分块持久化
- `file-storage.service.ts`
  - 负责本地文件或 OSS 抽象
- `qdrant.service.ts`
  - 负责向量写入、删除、检索过滤封装

## 12. 代码实现阶段建议

建议按以下顺序落地，避免一次性并发过多模块：

### 第一阶段：先完成知识库管理

- 知识库 CRUD
- 我的知识库列表
- 统一权限校验

目标：先让私有库/共享库实体跑通。

### 第二阶段：完成成员与邀请

- 创建邀请
- 加入共享库
- 成员列表
- 移除成员

目标：先打通协作闭环。

### 第三阶段：完成文档管理

- 上传
- 列表
- 详情
- 删除
- 下载

目标：先打通“文档记录 + 文件存储”。

### 第四阶段：完成异步解析与向量化

- BullMQ
- Redis
- 文档解析 Worker
- Chunk 入库
- Qdrant 同步

目标：让知识库具备真正可检索能力。

### 第五阶段：对接问答模块

- 按 `kbId` 过滤检索
- 返回溯源引用
- SSE 流式输出

目标：接入 Agentic RAG 问答链路。

## 13. 需要你确认的事项

以下决策会直接影响接口与数据结构，建议在正式编码前确认：

### 13.1 数据库是否继续使用 MySQL

当前仓库实际是 MySQL，但可行性文档推荐 PostgreSQL。

建议你确认：

- 是继续沿用当前 MySQL 方案快速推进
- 还是在知识库模块开发前先切换到 PostgreSQL

推荐：

- **如果当前目标是优先完成毕设可用版本，先沿用 MySQL**
- 后续如需更复杂 JSON 过滤与统计，再评估迁移

### 13.2 邀请方式是否只使用邀请码

当前表结构天然适合“共享知识库的邀请码/邀请链接加入”。

建议你确认：

- 是否本期只做邀请码加入
- 是否后续要扩展为“指定邮箱邀请”

推荐：

- **本期只做共享知识库的邀请码加入**
- 后续如要做定向邀请，再补 `invitee_email`

### 13.3 文件存储方式

建议你确认：

- 本期是否直接落本地磁盘
- 还是一开始就接入 OSS / MinIO

推荐：

- **本期先落本地磁盘**
- 通过 `file-storage.service.ts` 做抽象，后续再替换存储实现

### 13.4 成员是否允许上传文件

需求文档当前更偏向：

- 成员可读、可下载
- 文件操作仅创建者执行

建议你确认是否坚持该规则。

推荐：

- **本期成员不允许上传、删除、重解析**

## 14. 结论

知识库模块的后端方案已经可以明确拆成三层：

- **业务层**：知识库、成员、文档管理接口
- **基础设施层**：文件存储、队列、解析、向量库
- **安全层**：统一鉴权、权限断言、异常治理、向量过滤

从当前仓库现状看，最适合的落地方式不是一步把 RAG 全部做完，而是按以下顺序推进：

1. 先完成知识库实体与权限模型
2. 再完成协作成员机制
3. 再完成文档管理
4. 最后接入异步解析与 Qdrant

这样既符合当前项目的开发节奏，也能最大化复用现有 `Nest.js + Prisma + 统一异常治理` 的基础建设。
