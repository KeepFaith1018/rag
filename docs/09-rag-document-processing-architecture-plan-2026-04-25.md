# RAG 文档异步处理总体方案

## 1. 文档说明

- 本文档用于规划知识库系统下一阶段的 RAG 文档处理能力建设。
- 本文档承接当前已经完成的“知识库管理 + 权限体系 + 文档上传 + 分片上传增强”能力，重点设计后续的文档解析、分片、向量化、入向量库整体链路。
- 本文档当前只做总体技术方案设计，不展开到具体解析库选型、分片算法参数和模型调用细节实现。
- 本文档目标是先明确系统边界、处理流程、状态机、模块职责、队列方案与实施顺序，作为后续详细设计与编码实现依据。

相关文档：

- [01-requirement-analysis.md](file:///d:/Faith/Project/rag-knowledge-base/docs/01-requirement-analysis.md)
- [02-feasibility-analysis.md](file:///d:/Faith/Project/rag-knowledge-base/docs/02-feasibility-analysis.md)
- [03-database-design.md](file:///d:/Faith/Project/rag-knowledge-base/docs/03-database-design.md)
- [05-backend_infra_implementation.md](file:///d:/Faith/Project/rag-knowledge-base/docs/05-backend_infra_implementation.md)
- [06-chunk-upload-resume-fast-upload-solution.md](file:///d:/Faith/Project/rag-knowledge-base/docs/06-chunk-upload-resume-fast-upload-solution.md)
- [07-chunk-upload-implementation-plan-2026-04-24.md](file:///d:/Faith/Project/rag-knowledge-base/docs/07-chunk-upload-implementation-plan-2026-04-24.md)
- [08-upload-follow-up-todo-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/08-upload-follow-up-todo-2026-04-25.md)
- [document-module-development-progress-2026-04-24.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-module-development-progress-2026-04-24.md)
- [document-upload-implementation-record-2026-04-24.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-upload-implementation-record-2026-04-24.md)
- [document-chunking-strategy-upgrade-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-chunking-strategy-upgrade-plan-2026-04-25.md)

## 2. 当前现状与切入点

### 2.1 当前已经具备的能力

当前项目已经具备以下基础能力，可直接为 RAG 文档处理链路复用：

- 知识库模块已完成基础 CRUD、成员管理与权限体系
- 文档模块已完成上传、列表、详情、下载、删除、重解析入口
- 上传增强模块已完成分片上传、断点续传、知识库级秒传基础能力
- 本地文件存储抽象已经具备，后续可替换为 MinIO / OSS
- 统一异常治理、统一日志体系、统一响应结构已经具备
- 环境变量中已预留 `REDIS_URL`、`REDIS_PASSWORD`、`QDRANT_URL`
- Prisma 已预留 `b_documents`、`b_document_chunks` 等数据结构

### 2.2 当前尚未完成的能力

当前仍未完成的关键部分包括：

- 文档异步解析队列
- 文档文本提取能力
- 文档结构化分片能力
- Embedding 调用能力
- Qdrant 向量写入与删除能力
- 文档处理失败重试与任务治理能力
- 文档处理链路的日志、审计、进度跟踪能力

### 2.3 当前最合理的推进方式

基于现有进度，下一阶段不建议直接进入问答模块，而应优先补齐“文档真正可检索”的中间层能力。

推荐推进顺序如下：

1. 保持 `document` 模块继续只负责文档业务入口
2. 新增 `document-processing` 模块负责异步处理编排
3. 新增或完善 `ai` 模块负责 Embedding 能力封装
4. 新增 `vector` 模块负责 Qdrant 适配
5. 最后再接知识库问答与检索链路

## 3. 方案目标

本次方案设计的目标不是“上传后立即同步解析”，而是建立一套具备工程可扩展性的异步文档处理流水线。

总体目标如下：

1. 上传接口快速返回，不阻塞用户请求
2. 文档处理全链路异步化，适配中大文件
3. 处理链路具备阶段状态机和失败可追踪能力
4. 支持重解析与后续模型替换
5. 支持多知识库数据隔离与统一检索基础设施
6. 为后续问答引用溯源能力保留 chunk 元数据
7. 作为项目的一项核心技术亮点进行展示

## 4. 总体架构设计

### 4.1 架构分层

整体建议拆成四层：

1. 业务入口层
2. 文档处理编排层
3. 模型与向量基础设施层
4. 权限与治理层

对应职责如下：

- `document` 模块
  - 负责上传、列表、详情、下载、删除、重解析接口
  - 负责文档元数据管理
  - 负责文档资源级权限判断
  - 只负责入队，不直接执行耗时处理

- `document-processing` 模块
  - 负责 BullMQ 队列接入
  - 负责文档处理状态流转
  - 负责解析、分片、向量化、入库编排
  - 负责失败重试、幂等控制、重解析任务协调

- `ai` 模块
  - 负责 Embedding 模型调用能力封装
  - 屏蔽具体模型服务商差异
  - 为后续问答模块复用提供统一接口

- `vector` 模块
  - 负责 Qdrant 连接与集合管理
  - 负责向量写入、删除、过滤查询
  - 负责 payload 结构统一

- 公共基础设施层
  - `storage`
  - `exception`
  - `logging`
  - `config`
  - `prisma`

### 4.2 推荐目录结构

```text
apps/backend/src/modules/
  document/
  document-processing/
    document-processing.module.ts
    queue/
      document-queue.module.ts
      document-queue.service.ts
      document-processing.constants.ts
    processor/
      document-ingest.processor.ts
      document-parse.processor.ts
      document-chunk.processor.ts
      document-embed.processor.ts
      document-index.processor.ts
    services/
      document-processing.service.ts
      document-parser.service.ts
      document-chunk.service.ts
      document-task-log.service.ts
  ai/
    ai.module.ts
    embedding.service.ts
  common/
    vector/
      qdrant.module.ts
      qdrant.service.ts
```

## 5. 核心处理流程

### 5.1 业务主流程

推荐主流程如下：

1. 用户上传文件
2. `DocumentService.upload()` 保存文件并写入 `b_documents`
3. 文档状态设为 `uploaded`
4. 入队服务创建异步任务，状态更新为 `queued`
5. Worker 执行文本提取，状态更新为 `parsing`
6. Worker 执行分片持久化，状态更新为 `chunking`
7. Worker 执行向量化，状态更新为 `embedding`
8. Worker 写入 Qdrant 并回写结果
9. 成功则状态更新为 `ready`
10. 任意阶段失败则状态更新为 `failed`

### 5.2 重解析流程

重解析建议采用“版本化重解析”设计，而不是简单重复跑一次旧任务。

推荐流程如下：

1. 用户点击重解析
2. 校验文档级权限
3. 清理旧 `b_document_chunks`
4. 删除旧向量数据
5. 重置文档状态和统计字段
6. 递增文档处理版本号
7. 重新入队

这样可以避免以下问题：

- 旧任务和新任务并发执行时相互覆盖
- 旧向量残留导致结果混乱
- 重解析后无法区分当前数据是否为最新版本

## 6. BullMQ 异步编排设计

### 6.1 为什么使用 Redis + BullMQ

选择 `Redis + BullMQ` 的原因如下：

- 与 Node.js / Nest.js 技术栈契合度高
- 适合承载文档解析、向量化等耗时异步任务
- 支持延迟任务、重试、回退、并发控制、失败事件监听
- 易于后续扩展为多 Worker 部署
- 对当前项目复杂度较友好，工程落地成本低于独立 MQ 中间件

### 6.2 推荐队列拆分

推荐按处理阶段拆分队列，而不是把全流程放进一个超大 Worker。

推荐队列如下：

- `document-ingest`
- `document-parse`
- `document-chunk`
- `document-embed`
- `document-index`

各队列职责如下：

- `document-ingest`
  - 负责进入处理链路
  - 做前置幂等校验
  - 推动后续阶段任务

- `document-parse`
  - 负责从源文件提取纯文本和结构化信息

- `document-chunk`
  - 负责文本切块与 chunk 落库

- `document-embed`
  - 负责批量调用 Embedding

- `document-index`
  - 负责 Qdrant 写入与索引回写

### 6.3 首版简化策略

如果首版希望降低复杂度，可以先只注册一个主队列 `document-processing`，但内部仍然必须按阶段写入状态。

即使先做单队列，也建议保留以下设计：

- 清晰的阶段枚举
- 每阶段独立错误处理
- 每阶段独立日志记录
- 每阶段幂等判断

这样后续从单队列拆成多队列时不会推倒重来。

### 6.4 Job 标识与幂等

每个任务建议生成稳定 `jobId`，格式建议如下：

```text
doc:{documentId}:v:{processingVersion}:stage:{stage}
```

好处：

- 同阶段重复入队时可以自然去重
- 可明确区分重解析前后的任务
- 便于日志检索与问题排查

## 7. 文档状态机设计

### 7.1 对外状态定义

建议对外统一使用以下文档状态：

- `uploaded`
- `queued`
- `parsing`
- `chunking`
- `embedding`
- `ready`
- `failed`

说明：

- `uploaded` 表示文件已保存，但尚未进入真实处理阶段
- `queued` 表示任务已进入异步队列
- `parsing` 表示正在提取文本
- `chunking` 表示正在进行分片
- `embedding` 表示正在生成向量并准备索引
- `ready` 表示文档已可检索
- `failed` 表示处理失败，需要查看错误信息或重试

### 7.2 内部状态扩展建议

为便于治理，建议在内部补充以下信息：

- `processing_version`
- `current_stage`
- `last_error_stage`
- `retry_count`
- `last_error_code`

其中 `processing_version` 非常关键，建议作为正式设计的一部分。

## 8. 文档解析设计

### 8.1 解析层原则

文档解析层建议使用“适配器模式”，统一输出标准化结构，而不是让不同文件类型直接把文本丢给下游。

统一输出结构建议包含：

- `plainText`
- `sections`
- `pageMap`
- `metadata`

### 8.2 首版支持文件类型

建议首版先支持：

- `pdf`
- `docx`
- `md`
- `txt`

原因：

- 当前上传白名单已经基本覆盖这些格式
- 这几类文件最具代表性
- 能够快速形成可用闭环

### 8.3 暂不纳入范围

首版建议暂不纳入：

- OCR 识别
- 扫描版 PDF 图像文本恢复
- 表格结构深度还原
- 图片内容多模态理解

这些能力可以作为后续增强，不建议在当前阶段拉高实现复杂度。

## 9. 分片设计

### 9.1 分片原则

不建议只做固定字符数切片，建议采用“结构感知 + token 控制”的两段式切块策略。

补充说明：

- 当前工程中已经落地的首版实现，是基于 LangChain `RecursiveCharacterTextSplitter` 对 `plainText` 做字符级递归切分。
- 该实现适合作为首版可运行方案，但不是本项目后续推荐长期保持的最终方案。
- 后续应升级为“结构感知切分 + token 二次切分 + metadata 稳定保留”的主流 RAG 分片方案。

推荐策略：

1. 先按文档结构粗切
2. 再按 token 窗口细切

### 9.2 第一层粗切

优先按以下边界做结构切分：

- 标题
- 段落
- 页码
- 列表
- 代码块
- 表格块

工程落地建议：

- `md` 文档优先使用标题层级做切分
- `pdf / docx / txt` 优先基于解析器输出的 `sections` 做结构粗切
- 当结构信息缺失或质量不稳定时，允许回退到全文递归切分兜底

### 9.3 第二层细切

对过长文本再做 token 控制切分，建议参数区间如下：

- 单 chunk 目标长度：`500 - 800 tokens`
- overlap：`80 - 120 tokens`

说明：

- 该参数只作为当前规划阶段建议值
- 该参数更贴近当前百炼文本向量模型首版接入策略
- 后续详细设计时再根据实际模型上下文与效果微调

### 9.4 chunk 元数据设计

每个 chunk 建议至少保留以下信息：

- `kbId`
- `docId`
- `chunkIndex`
- `processingVersion`
- `pageNo`
- `charStart`
- `charEnd`
- `titlePath`
- `sourceFileName`
- `chunkStrategy`

这些字段将直接用于后续：

- 检索过滤
- 答案来源引用
- 文档跳转与高亮
- 重解析版本隔离

补充要求：

- `metadata_json` 中建议显式记录当前分片策略，例如 `plainText-recursive` 或 `structured-token-aware`
- 这样后续做召回质量评估、重解析回放和策略切换时，可以明确区分不同版本产物

## 10. 向量化与 Qdrant 设计

### 10.1 Embedding 能力设计

Embedding 不建议直接写在 Worker 中，建议通过 `ai` 模块统一封装，例如：

```ts
embedDocuments(texts: string[]): Promise<number[][]>
```

设计原则：

- 屏蔽不同模型供应商差异
- 统一限流、超时、异常包装
- 便于后续问答模块复用

### 10.2 为什么选择单集合 + payload 过滤

虽然业务上存在多个知识库，但当前更推荐在 Qdrant 中采用“单集合 + payload 过滤”方案，而不是“每个知识库一个集合”。

单集合方案含义如下：

- 所有知识库的 chunk 向量统一写入一个 collection
- 每条向量通过 payload 携带 `kbId`、`docId`、`chunkId` 等业务标识
- 检索时通过 filter 严格限制只查询当前知识库或当前允许访问的知识库集合

### 10.3 推荐单集合的原因

推荐原因如下：

- 集合管理更简单，不需要每新建知识库就新建一个 collection
- 统一维护索引参数、向量维度、距离策略
- 重解析、批量删除、模型迁移时治理成本更低
- 后续支持“多知识库联合检索”会更自然
- 更符合当前项目阶段的工程复杂度控制目标

### 10.4 多集合方案的问题

如果采用“每个知识库一个集合”，将面临以下问题：

- 集合数量随知识库数量持续增长
- 创建知识库时要联动建集合
- 删除知识库时要联动删集合
- 更换模型维度时需要重建大量集合
- 统一监控、统一备份、统一恢复更复杂

因此，当前阶段不推荐采用多集合。

### 10.5 推荐集合设计

建议统一 collection 名称，例如：

```text
kb_document_chunks
```

建议 payload 至少包含：

- `kbId`
- `docId`
- `chunkId`
- `chunkIndex`
- `uploaderId`
- `processingVersion`
- `visibility`
- `isPublic`
- `pageNo`
- `title`

### 10.6 检索过滤原则

检索时必须同时结合：

- `kbId`
- 当前用户可访问的知识库范围
- 知识库公开状态
- 业务权限规则

核心思想是：

- 数据统一入一个向量集合
- 访问控制依赖 payload 过滤和业务权限联动实现

## 11. 权限与隔离设计

### 11.1 为什么向量层不能脱离业务权限

后续检索时不能只做“语义相似度查询”，还必须结合知识库访问权限。

因此，向量检索必须遵循：

1. 先做知识库访问授权
2. 再生成允许访问的 `kbId` 过滤条件
3. 最后执行向量搜索

### 11.2 与当前权限体系的衔接方式

当前知识库模块已经存在 `owner / manager / collaborator / member / publicVisitor` 权限模型。

后续建议保持：

- HTTP 接口仍走 `KbPermissionGuard`
- 文档处理链路继续保留 `uploader_id` 资源级判断
- 向量检索时根据可访问知识库列表构造 filter

这样可以保证：

- 业务权限和向量权限一致
- 不会因为向量库独立而突破知识库边界

## 12. 可观测性与治理设计

### 12.1 为什么需要可观测性

文档处理是一个明显长链路任务，如果没有阶段日志和失败记录，后期会很难排查问题。

因此建议从一开始就设计以下能力：

- 文档处理阶段日志
- BullMQ 任务事件监听
- 每阶段耗时统计
- 每阶段失败原因记录
- 重试次数与最终失败记录

### 12.2 推荐治理项

建议后续逐步补齐：

- `document_task_logs` 任务日志表
- 文档处理耗时统计
- 文档处理失败重试记录
- 向量删除失败补偿机制
- Worker 崩溃后任务恢复策略
- 定时扫描 `queued / parsing / chunking / embedding` 超时任务

### 12.3 与现有异常治理衔接

当前项目已经有统一异常治理能力，后续应继续复用：

- `BusinessException`
- `wrapBusinessException()`
- `AllExceptionsFilter`
- Winston 结构化日志

尤其在以下场景必须保留根因：

- Redis 连接失败
- BullMQ 入队失败
- 解析库调用失败
- Embedding 服务异常
- Qdrant 写入失败

## 13. 数据结构调整建议

### 13.1 `b_documents`

当前已经具备多数字段，但建议继续评估补充：

- `processing_version`
- `current_stage`
- `last_error_stage`
- `retry_count`
- `last_error_code`

### 13.2 `b_document_chunks`

当前结构已经比较完善，建议继续确保以下字段真正被用起来：

- `page_no`
- `char_start`
- `char_end`
- `vector_id`
- `metadata_json`
- `embedding_status`

### 13.3 可选新增任务表

如果后续希望增强治理能力，建议新增：

- `b_document_processing_tasks`

用途：

- 记录每次处理任务
- 标记阶段状态
- 跟踪开始时间、结束时间、失败原因
- 区分不同 `processing_version`

## 14. 方案亮点总结

本方案可以作为项目亮点，重点体现在以下几个方面：

1. 文档处理全链路异步化
2. 基于 `Redis + BullMQ` 的工程化任务编排
3. 基于状态机的文档处理过程治理
4. 基于 `processing_version` 的版本化重解析设计
5. 基于“单集合 + payload 过滤”的统一向量索引方案
6. 保留页码、偏移、标题路径的结构化溯源 chunk 设计
7. 与知识库权限体系深度联动的安全检索方案
8. 分片策略支持从“首版字符级递归切分”平滑升级到“结构感知 + token 二次切分”

## 15. 推荐实施顺序

### 第一阶段：接入基础异步能力

目标：

- 接入 Redis 和 BullMQ
- 建立文档处理主队列
- 实现 `uploaded -> queued -> parsing -> ready / failed` 最小闭环

### 第二阶段：接入结构化分片

目标：

- 新增 `document-parser.service.ts`
- 新增 `document-chunk.service.ts`
- 让 chunk 数据真正落入 `b_document_chunks`

### 第三阶段：接入向量化与 Qdrant

目标：

- 实现 `ai` 模块 Embedding 能力
- 实现 `qdrant.service.ts`
- 完成 chunk 向量写入、删除与版本隔离

### 第四阶段：补齐治理能力

目标：

- 增加任务日志
- 增加失败重试
- 增加超时任务恢复
- 增加管理端可读的处理状态信息

### 第五阶段：对接问答链路

目标：

- 基于 `kbId` 和权限范围检索
- 返回引用来源
- 为流式问答输出提供基础数据

## 16. 当前建议确认项

在正式进入详细设计前，建议确认以下事项：

1. Embedding 首版采用哪类模型服务
2. 首版解析格式是否限定为 `pdf / docx / md / txt`
3. 是否接受“单集合 + payload 过滤”的 Qdrant 设计
4. 是否接受“`processing_version` 版本化重解析”设计
5. 首版是否只做本地文件存储，不同时接入对象存储

## 17. 结论

当前项目已经完成知识库、权限、文档上传和上传增强基础闭环，最适合的下一步不是直接进入问答，而是先建立一套工程化的异步文档处理流水线。

该流水线的核心设计结论如下：

- `document` 模块继续只负责业务入口
- `document-processing` 模块负责异步编排
- `ai` 模块负责 Embedding 模型调用
- `vector` 模块负责 Qdrant 适配
- 文档状态采用阶段状态机管理
- 重解析采用 `processing_version` 版本化设计
- Qdrant 采用“单集合 + payload 过滤”方案

这样设计既能控制当前开发复杂度，又能显著提升项目技术亮点，并为后续问答模块打下稳定基础。
