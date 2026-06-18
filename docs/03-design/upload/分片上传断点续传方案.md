# 分片上传、断点续传、秒传与前端 Worker 多线程方案

## 1. 文档目标

本文档用于为当前项目设计一套完整的文件上传增强方案，使其不仅能满足文档管理模块的功能需求，还能作为项目中的一个技术亮点进行展示。

本方案重点覆盖以下能力：

- 大文件分片上传
- 断点续传
- 秒传
- 前端多线程哈希计算
- 前端 Worker 并发调度
- 后端上传会话管理
- 本地存储与文件服务 / 对象存储的取舍
- 与后续文档解析、向量化、RAG 问答流程的衔接

本文档目标不是只给出一个“能跑”的实现思路，而是输出一套：

- 可先快速落地
- 可逐步演进
- 可作为毕业设计 / 项目亮点陈述
- 可兼容后续 RAG 架构扩展

## 2. 方案结论

先给出结论：

1. 不建议继续只使用“单文件直传 + 后端同步落盘”的简单模式
2. 应新增“上传会话机制”，把上传过程从文档业务中拆出来
3. 前端应使用 `Web Worker` 计算文件哈希，并负责任务并发调度
4. 后端应使用“初始化上传 -> 上传分片 -> 查询状态 -> 完成合并”四段式协议
5. 文档业务层只在“合并成功”后创建正式文档记录
6. 存储层必须做抽象，业务代码不能直接依赖磁盘路径
7. 开发期可先用本地存储，设计上优先按对象存储 / 文件服务思路实现

一句话总结：

> 推荐采用“前端 Worker 多线程哈希 + 分片并发上传 + 后端上传会话 + 存储抽象 + 合并后入文档业务”的方案。

## 3. 为什么这会成为技术亮点

如果你要把这部分作为项目亮点介绍，建议强调以下几点：

### 3.1 用户体验层面

- 大文件上传不再因为单次请求失败而全量重传
- 用户刷新页面或网络中断后可继续上传
- 已存在文件可直接秒传，显著减少等待时间
- 上传过程可展示进度、剩余分片、失败重试状态

### 3.2 工程能力层面

- 前端使用 Worker 解决大文件哈希阻塞主线程问题
- 后端通过上传会话和分片状态实现幂等与恢复
- 存储层和业务层解耦，支持本地到对象存储的平滑切换
- 与文档解析、向量化、RAG 流程形成完整工程闭环

### 3.3 可扩展性层面

- 后续可扩展到视频、音频、图片等更多大文件场景
- 后续可替换为 `MinIO / OSS / COS / S3`
- 后续可接入 CDN、签名直传、上传审计、配额控制

## 4. 整体架构建议

### 4.1 模块分层

建议将这套能力拆成四层：

1. **前端上传编排层**
   - 文件切片
   - 哈希计算
   - 并发控制
   - 重试调度
   - 上传恢复

2. **后端上传会话层**
   - 初始化上传
   - 分片状态记录
   - 查询续传状态
   - 合并确认
   - 取消上传

3. **存储抽象层**
   - 本地文件系统
   - MinIO / OSS / S3
   - 临时分片目录 / 正式文件目录

4. **文档业务层**
   - 创建 `b_documents`
   - 权限校验
   - 投递解析任务
   - 与 `document-processing`、`ai`、`rag` 衔接

### 4.2 推荐依赖关系

```text
frontend upload client
  -> upload worker
  -> backend upload api

backend upload api
  -> upload session service
  -> file storage service
  -> document service

document service
  -> document-processing
  -> ai
  -> vector store
```

### 4.3 在当前项目中的建议目录

后端建议：

```text
apps/backend/src/modules/
  document/
    document.module.ts
    document.controller.ts
    document.service.ts

  upload/
    dto/
    upload.module.ts
    upload.controller.ts
    upload.service.ts

  document-processing/
    document-processing.module.ts
    document-parse.queue.ts
    document-parse.processor.ts
    document-parser.service.ts
    document-chunk.service.ts

apps/backend/src/common/storage/
  file-storage.module.ts
  file-storage.service.ts
```

前端建议：

```text
apps/frontend/src/
  modules/document-upload/
    api/
    composables/
    workers/
    types/
    utils/
```

## 5. 核心流程设计

### 5.1 全流程概览

完整上传流程建议拆为 7 步：

1. 前端选择文件
2. Worker 计算文件哈希
3. 前端请求初始化上传
4. 后端返回上传会话和已上传分片信息
5. 前端并发上传缺失分片
6. 前端请求完成上传
7. 后端合并分片、校验哈希、创建文档记录、投递解析任务

### 5.2 初始化上传流程

前端提交：

- `kbId`
- `fileName`
- `fileSize`
- `mimeType`
- `fileHash`
- `chunkSize`
- `totalChunks`

后端处理：

1. 校验当前用户是否具备 `uploadDocument` 权限
2. 判断是否命中秒传
3. 若未命中，则创建或恢复上传会话
4. 返回 `uploadId`
5. 返回已上传分片列表

### 5.3 分片上传流程

前端针对每个分片上传：

- `uploadId`
- `chunkIndex`
- `chunkHash`
- `chunkSize`
- 分片二进制内容

后端处理：

1. 校验上传会话存在
2. 校验会话属于当前用户、当前知识库
3. 校验分片索引合法
4. 幂等写入临时分片
5. 记录分片上传成功状态

### 5.4 断点续传流程

前端重新上传同一文件时：

1. 根据 `fileHash` 调用初始化接口
2. 后端查询已有上传会话
3. 返回已上传分片数组
4. 前端跳过已完成分片，仅补传缺失分片

### 5.5 秒传流程

后端在初始化阶段先判断：

- 当前知识库是否已有相同 `fileHash`
- 或系统中是否已有相同底层文件

若命中秒传：

1. 直接创建新的文档业务记录
2. 复用已有物理文件路径或对象存储 key
3. 返回“秒传成功”

说明：

- 秒传判定必须以**完整文件哈希**为准
- 不能仅依赖文件名和大小

### 5.6 完成上传流程

当前端确认所有缺失分片都上传成功后：

1. 调用完成上传接口
2. 后端校验分片是否齐全
3. 后端按顺序合并分片
4. 后端对合并结果重新计算完整文件哈希
5. 校验与前端 `fileHash` 一致
6. 移动到正式存储区
7. 创建 `b_documents`
8. 投递文档解析任务
9. 删除临时分片

## 6. 前端完整方案

### 6.1 前端职责划分

前端建议负责：

- 文件选择与校验
- 文件切片
- 文件哈希计算
- 上传任务调度
- 并发控制
- 重试控制
- 断点恢复
- 上传进度展示
- 状态同步

前端不建议负责：

- 分片合并
- 秒传最终判定
- 分片完整性最终校验
- 文档正式入库

### 6.2 为什么要用 Worker

大文件哈希计算会明显阻塞主线程，导致：

- 页面卡顿
- 进度条不流畅
- 用户误以为页面失去响应

因此建议把以下任务放进 Worker：

- 文件分片遍历
- 每片哈希计算
- 完整文件哈希计算

### 6.3 Worker 设计建议

建议拆两类 Worker：

1. **Hash Worker**
   - 专门负责文件哈希计算
   - 返回 `fileHash`
   - 可选返回 `chunkHash[]`

2. **Upload Scheduler Worker**
   - 专门负责上传任务调度
   - 管理并发队列、失败重试、暂停恢复

如果你想降低复杂度，也可以先只做一个 `hash.worker.ts`，上传调度仍放在主线程的 composable / store 中。

### 6.4 前端建议目录

```text
apps/frontend/src/modules/document-upload/
  api/
    upload.api.ts
  composables/
    useChunkUpload.ts
  workers/
    file-hash.worker.ts
  types/
    upload.ts
  utils/
    fileChunk.ts
    hash.ts
    retry.ts
```

### 6.5 前端状态模型建议

建议前端维护如下状态：

- `idle`
- `hashing`
- `initializing`
- `uploading`
- `paused`
- `merging`
- `completed`
- `instantCompleted`
- `failed`

### 6.6 分片参数建议

首版建议：

- `chunkSize = 5MB`
- 并发上传数：`3 ~ 5`
- 失败重试次数：`2 ~ 3`

原因：

- 分片太小，请求数量过多
- 分片太大，失败重传成本过高
- 并发过高容易让服务端和浏览器连接池压力增大

### 6.7 哈希方案建议

建议：

- 使用 `SparkMD5` 或 `crypto.subtle` + Worker
- 先按分片迭代计算完整文件 hash
- 可选同时生成每个分片的 `chunkHash`

推荐展示时可强调：

- “采用 Worker 在后台线程计算文件哈希，避免主线程阻塞”
- “支持秒传和断点续传的前提校验”

### 6.8 前端上传时序建议

```text
选择文件
-> worker 计算 fileHash
-> init upload
-> 获取 uploadId + uploadedChunks
-> 并发上传缺失 chunk
-> complete upload
-> 显示上传完成
```

## 7. 后端完整方案

### 7.1 后端职责划分

后端建议负责：

- 上传权限校验
- 上传会话管理
- 分片状态管理
- 分片幂等写入
- 文件合并
- 最终哈希校验
- 文档记录创建
- 异步解析任务投递

### 7.2 推荐接口设计

建议至少设计以下 5 个接口：

#### 1. 初始化上传

- `POST /api/knowledge-bases/:kbId/uploads/init`

请求体：

- `fileName`
- `fileSize`
- `mimeType`
- `fileHash`
- `chunkSize`
- `totalChunks`

返回：

- `uploadId`
- `isInstantUploaded`
- `documentId?`
- `uploadedChunks`
- `chunkSize`
- `totalChunks`

#### 2. 上传单个分片

- `POST /api/knowledge-bases/:kbId/uploads/:uploadId/chunks`

表单字段：

- `chunkIndex`
- `chunkHash`
- `file`

#### 3. 查询上传状态

- `GET /api/knowledge-bases/:kbId/uploads/:uploadId/status`

返回：

- `status`
- `uploadedChunks`
- `totalChunks`

#### 4. 完成上传

- `POST /api/knowledge-bases/:kbId/uploads/:uploadId/complete`

请求体可选：

- `fileHash`
- `totalChunks`

#### 5. 取消上传

- `DELETE /api/knowledge-bases/:kbId/uploads/:uploadId`

### 7.3 为什么不建议继续只用现有 `POST /documents`

因为现有单接口上传模式存在天然限制：

- 不能稳定支持大文件
- 不能断点恢复
- 不能优雅支持秒传
- 上传失败必须整文件重传
- 前后端状态难以协同管理

因此建议：

- 保留现有 `POST /documents` 作为兼容入口
- 新增分片上传专用接口
- 中后期逐步把前端上传流量迁移到新接口

### 7.4 上传会话机制

上传会话的本质是：

- 把“文件上传过程”从“文档业务记录”中独立出来

这样做的好处：

- 断点续传有状态可查
- 分片上传可以幂等
- 上传失败可以恢复
- 会话过期后可以统一清理

## 8. 数据库设计建议

### 8.1 建议新增上传会话表

建议表名：

- `b_upload_sessions`

建议字段：

| 字段名 | 类型 | 说明 |
| :-- | :-- | :-- |
| `id` | BigInt / String | 上传会话 ID |
| `kb_id` | BigInt | 知识库 ID |
| `user_id` | BigInt | 发起上传的用户 |
| `file_name` | String | 原始文件名 |
| `file_size` | BigInt | 文件大小 |
| `mime_type` | String | MIME 类型 |
| `file_hash` | String | 完整文件哈希 |
| `chunk_size` | Int | 分片大小 |
| `total_chunks` | Int | 分片总数 |
| `uploaded_count` | Int | 已上传分片数 |
| `status` | String | 上传状态 |
| `storage_type` | String | 存储类型 |
| `temp_dir` | String | 临时目录 / 前缀 |
| `created_at` | DateTime | 创建时间 |
| `updated_at` | DateTime | 更新时间 |
| `expired_at` | DateTime | 过期时间 |

建议状态：

- `init`
- `uploading`
- `completed`
- `merged`
- `cancelled`
- `expired`
- `failed`

### 8.2 建议新增上传分片表

建议表名：

- `b_upload_chunks`

建议字段：

| 字段名 | 类型 | 说明 |
| :-- | :-- | :-- |
| `id` | BigInt | 主键 |
| `upload_id` | BigInt / String | 上传会话 ID |
| `chunk_index` | Int | 分片序号 |
| `chunk_size` | Int | 分片大小 |
| `chunk_hash` | String | 分片哈希 |
| `storage_path` | String | 临时分片路径 |
| `status` | String | 分片状态 |
| `created_at` | DateTime | 创建时间 |

约束建议：

- `upload_id + chunk_index` 唯一

### 8.3 与现有 `b_documents` 的关系

当前建议：

- 上传会话完成前，不创建正式 `b_documents`
- 合并成功后，再创建 `b_documents`
- `b_documents.file_hash` 用于秒传判定和去重

### 8.4 秒传复用策略

可以分两种层级：

1. **知识库级秒传**
   - 当前知识库下已存在相同 `file_hash`

2. **系统级秒传**
   - 全系统底层已存在相同文件

推荐实施顺序：

1. 先做知识库级秒传
2. 再做系统级物理文件复用

## 9. 秒传设计细节

### 9.1 秒传判定原则

秒传必须基于：

- 完整文件哈希 `fileHash`

不应基于：

- 文件名
- 文件大小
- MIME 类型

因为这些信息都可能碰撞或被篡改。

### 9.2 秒传成功后的处理方式

后端若命中秒传：

1. 不走分片上传
2. 直接创建文档记录
3. 复用底层物理文件引用
4. 直接返回成功

### 9.3 秒传的价值陈述

作为项目亮点可以这样描述：

> 系统通过前端 Worker 计算完整文件哈希，在上传初始化阶段完成内容级去重判断，从而实现秒传，避免重复文件的网络传输和磁盘写入。

## 10. 断点续传设计细节

### 10.1 核心思路

断点续传的关键不是“浏览器记住传到哪了”，而是：

- 后端必须可靠记录每个分片的持久化状态

### 10.2 恢复方式

建议恢复依据：

- `kbId + userId + fileHash`

即：

- 同一个用户
- 在同一个知识库下
- 上传同一个文件

可恢复同一个上传会话。

### 10.3 续传时后端返回内容

后端应返回：

- `uploadId`
- `uploadedChunks`
- `missingChunks`
- 当前会话状态

### 10.4 会话过期策略

建议设置：

- `24h ~ 72h` 自动过期

同时配套：

- 定时清理过期分片
- 清理过期会话记录

## 11. 本地存储 vs 文件服务 / 对象存储

这是本方案里最重要的取舍点之一。

### 11.1 本地存储方案

指：

- 后端把分片和正式文件直接存到应用服务器磁盘

优点：

- 实现简单
- 调试方便
- 本地开发成本低
- 首版落地速度快

缺点：

- 不适合多实例部署
- 扩容困难
- 迁移和备份麻烦
- 大文件容易压垮应用机磁盘
- 分片临时文件清理需要自己严格维护

适用场景：

- 本地开发
- 单机演示
- 早期原型

### 11.2 文件服务 / 对象存储方案

包括：

- `MinIO`
- `阿里云 OSS`
- `腾讯云 COS`
- `AWS S3`
- 独立文件服务网关

优点：

- 更适合大文件
- 更适合分片和断点续传
- 更适合多实例部署
- 存储与业务解耦
- 更利于备份、清理、审计和扩展

缺点：

- 初期接入成本更高
- 本地开发需要额外环境
- 需要处理访问控制和签名策略

适用场景：

- 计划长期维护
- 后续会部署线上
- 文件量较大
- 有多实例或容器部署需求

### 11.3 对当前项目的建议

建议分阶段：

#### 第一阶段

- 代码层必须实现 `FileStorageService` 抽象
- 开发环境可先使用本地磁盘实现

#### 第二阶段

- 在不改接口协议的前提下切到 `MinIO`

#### 第三阶段

- 如果需要更接近生产，可演进为：
  - 前端直传对象存储
  - 后端只负责签发上传凭证和最终确认

### 11.4 最终推荐

如果你希望这部分成为技术亮点，推荐的对外表述是：

- **实现层面先支持本地存储**
- **架构层面按对象存储优先设计**

这样既能快速实现，又能体现完整的工程思考。

## 12. 权限与安全设计

### 12.1 上传权限

上传相关接口建议统一使用知识库权限体系：

- `init upload`：`uploadDocument`
- `upload chunk`：`uploadDocument`
- `query status`：`uploadDocument`
- `complete upload`：`uploadDocument`
- `cancel upload`：`uploadDocument`

### 12.2 资源归属校验

上传会话必须校验：

- 会话属于当前用户
- 会话属于当前知识库
- 会话状态允许继续上传

### 12.3 文件校验

建议至少校验：

- 文件类型白名单
- 文件大小上限
- 分片大小合法性
- 分片索引合法性
- 完整文件哈希最终一致性

### 12.4 幂等性设计

必须保证：

- 同一分片重复上传不会导致错误状态
- 同一完成上传请求重复提交不会重复创建文档

## 13. 与当前 RAG 架构的衔接

当前项目后续还要接：

- `document-processing`
- `ai`
- `qdrant`
- `rag`

因此推荐上传完成后的链路为：

```text
complete upload
-> merge file
-> verify hash
-> create b_documents
-> set status = uploaded
-> enqueue parse task
-> document-processing parse
-> chunk
-> embedding
-> qdrant upsert
-> set status = ready
```

这样上传链路和解析链路清晰分离，后续维护成本最低。

## 14. 推荐实施顺序

建议按以下顺序落地：

### 第一阶段：打通上传会话闭环

- 新增上传会话表
- 新增上传分片表
- 实现初始化、分片上传、状态查询、完成上传、取消上传接口
- 先用本地存储

### 第二阶段：前端接入 Worker

- 实现哈希计算 Worker
- 实现前端分片上传 composable
- 实现上传进度、失败重试、断点恢复

### 第三阶段：接入秒传

- 初始化上传阶段加入 `fileHash` 判重
- 先做知识库级秒传

### 第四阶段：接入解析链路

- 合并成功后投递解析任务
- 接入 `document-processing`

### 第五阶段：切换对象存储

- 保持接口协议不变
- 只替换 `FileStorageService` 实现

## 15. 风险点与规避建议

### 15.1 哈希计算过慢

风险：

- 大文件在主线程计算哈希会导致页面卡顿

建议：

- 必须使用 Worker

### 15.2 分片重复上传

风险：

- 网络抖动或重试导致重复写入

建议：

- 后端按 `uploadId + chunkIndex` 做幂等

### 15.3 合并过程中出现脏数据

风险：

- 分片不全仍开始合并
- 合并完成后哈希不一致

建议：

- 合并前先校验齐全性
- 合并后重新计算完整文件哈希

### 15.4 临时分片堆积

风险：

- 取消上传、失败上传、过期上传会不断积累垃圾文件

建议：

- 增加定时清理任务

### 15.5 本地存储扩展性不足

风险：

- 后期多实例部署时本地磁盘方案失效

建议：

- 从第一天就做存储抽象

## 16. 最终推荐方案

综合当前项目阶段、实现成本、技术亮点展示效果和后续 RAG 扩展需求，推荐如下：

### 推荐实现策略

1. 前端：
   - `Worker + 分片 + 并发上传 + 断点恢复`
2. 后端：
   - `上传会话 + 分片状态 + 合并确认 + 文档入库`
3. 存储：
   - `代码先抽象`
   - `开发环境可本地`
   - `设计优先面向 MinIO / OSS`
4. 解析：
   - 合并完成后再进入 `document-processing`

### 推荐对外表达

如果你后续要写答辩材料或项目亮点介绍，可以这样表述：

> 本系统设计并实现了面向大文件场景的上传增强方案，采用前端 Web Worker 进行多线程文件哈希计算，支持分片上传、断点续传与秒传；后端通过上传会话与分片状态管理实现幂等恢复，并通过存储抽象兼容本地磁盘与对象存储，为后续文档解析、向量化和 RAG 问答链路提供稳定入口。

## 17. 结论

这套方案的核心价值不只是“上传更快”，而是把文档上传从一个简单接口升级成了一个完整工程能力：

- 前端更流畅
- 上传更稳定
- 后端更可控
- 存储更可扩展
- 与后续 RAG 解析链路衔接更自然

对当前项目来说，最佳实践不是一开始就全量上云，而是：

1. 先把协议、会话机制、Worker、多线程调度设计正确
2. 先用本地或 MinIO 跑通
3. 再逐步切换到更完整的文件服务架构

这样既能快速落地，也能真正体现系统设计能力。
