# 文档异步处理第三阶段实现记录

## 1. 文档说明

- 本文档用于记录后端 `document-processing` 第三阶段实现过程。
- 本轮承接第二阶段文档：
  - [document-processing-phase2-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase2-implementation-record-2026-04-25.md)
- 本轮继续遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮进入第三阶段，重点让文档从“已切块”推进到“已向量化、已写入向量库、可检索”。

本轮目标如下：

1. 新增 `AiModule`
2. 实现百炼 Embedding 服务
3. 增加批量提交、限频、重试控制
4. 新增 `QdrantService`
5. 将 chunk 向量写入 Qdrant
6. 推进文档状态从 `chunking -> embedding -> ready`
7. 在删除文档与重解析时补齐向量删除

## 3. 本轮确认事项

本轮已确认以下关键决策：

1. 百炼接入先按标准环境变量实现
2. 不猜测用户本地真实 API Key
3. Qdrant 继续沿用现有环境变量

## 4. 本轮范围边界

### 4.1 本轮会做

- 百炼文本向量化接入
- Embedding 批量、重试、限频控制
- Qdrant collection 初始化
- chunk 向量写入与删除
- 文档状态推进到 `ready`

### 4.2 本轮不会做

- 任务日志表落库
- 管理端处理进度展示
- 超时任务恢复
- 百炼异步批量作业接口

## 5. 计划实施文件

预计本轮会涉及以下文件：

- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/src/common/vector/qdrant.constants.ts`
- `apps/backend/src/common/vector/qdrant.module.ts`
- `apps/backend/src/common/vector/qdrant.service.ts`
- `apps/backend/src/modules/ai/ai.module.ts`
- `apps/backend/src/modules/ai/embedding.service.ts`
- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

## 6. 风险与注意事项

- 百炼 API Key 和模型编码当前未在项目环境变量中提供，本轮只能按标准变量名落地。
- 若 `BAILIAN_API_KEY` 或 `BAILIAN_EMBEDDING_MODEL` 未配置，Embedding 阶段必须明确失败，不能静默跳过。
- Qdrant collection 的向量维度需要与实际 Embedding 返回维度一致。
- 重解析时必须先删除旧版本向量，避免新旧版本混杂。

## 7. 当前状态

- 状态：已完成第三阶段编码与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 8. 本轮实际完成内容

### 8.1 环境变量与配置校验

已修改：

- `apps/backend/src/common/config/env.validation.ts`

本轮新增或补充的配置项如下：

- `QDRANT_SERVICE_API_KEY`
- `BAILIAN_API_KEY`
- `BAILIAN_BASE_URL`
- `BAILIAN_EMBEDDING_MODEL`
- `BAILIAN_EMBEDDING_DIMENSIONS`
- `BAILIAN_EMBED_BATCH_SIZE`
- `BAILIAN_EMBED_RETRY_COUNT`
- `BAILIAN_EMBED_REQUEST_INTERVAL_MS`

说明：

- 本轮按用户确认，先定义标准环境变量名，不强行绑定用户本地真实值
- 当前仅 `QDRANT_URL` 仍为必填
- 百炼相关变量为可选，但若缺失，运行到 Embedding 阶段会明确失败

### 8.2 新增 `AiModule`

已新增：

- `apps/backend/src/modules/ai/ai.module.ts`
- `apps/backend/src/modules/ai/embedding.service.ts`

`EmbeddingService` 实现内容如下：

- 基于百炼 OpenAI 兼容接口调用 Embedding
- 统一入口：`embedDocuments(texts: string[])`
- 内部按批次分组提交
- 单批最大文本条数通过 `BAILIAN_EMBED_BATCH_SIZE` 控制
- 批次间通过 `BAILIAN_EMBED_REQUEST_INTERVAL_MS` 控制请求节流
- 对 `429 / 500 / 502 / 503` 执行自动重试
- 对配置缺失、返回数据不完整等情况明确抛出异常

### 8.3 新增 Qdrant 基础设施

已新增：

- `apps/backend/src/common/vector/qdrant.constants.ts`
- `apps/backend/src/common/vector/qdrant.module.ts`
- `apps/backend/src/common/vector/qdrant.service.ts`

`QdrantService` 实现内容如下：

- 统一 collection 名称：`kb_document_chunks`
- collection 不存在时自动创建
- 默认使用 `Cosine` 距离
- 支持批量 upsert 向量点
- 支持按 `docId` 删除全部向量
- 支持按 `docId + processingVersion` 删除旧版本向量

### 8.4 文档处理主流程推进到 `ready`

已修改：

- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`

当前主流程如下：

1. `queued`
2. `parsing`
3. `chunking`
4. 查询当前文档全部 chunk
5. `embedding`
6. 调用百炼获取向量
7. 写入 Qdrant
8. 分片 `embedding_status` 标记为 `completed`
9. 文档状态推进到 `ready`

### 8.5 分片向量写入结构

当前写入 Qdrant 的 payload 字段如下：

- `kbId`
- `docId`
- `chunkId`
- `chunkIndex`
- `uploaderId`
- `processingVersion`
- `pageNo`
- `title`
- `charStart`
- `charEnd`

说明：

- `id` 使用稳定 `vector_id`
- 格式为 `doc:{docId}:chunk:{chunkIndex}:v:{processingVersion}`
- 这样可直接支持删除文档、删除旧版本和后续检索溯源

### 8.6 分片状态推进

已在 `DocumentChunkService` 中新增：

- `getChunksByDocument()`
- `markEmbeddingProcessing()`
- `markEmbeddingCompleted()`
- `markEmbeddingFailed()`

当前 `embedding_status` 流转如下：

- `pending`
- `processing`
- `completed`
- `failed`

### 8.7 删除文档与重解析补齐向量清理

已修改：

- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`

当前行为如下：

- 删除文档时：
  - 先删除 Qdrant 中该文档全部向量
  - 再删除数据库记录
  - 再删除本地文件
- 重解析时：
  - 先删除 Qdrant 中当前版本向量
  - 再删除旧 chunk
  - 再递增 `processing_version`
  - 再重新入队

这样可以避免：

- 向量残留
- 新旧版本混杂
- 数据库删除成功但向量未清理的问题

## 9. 当前状态流转说明

### 9.1 上传后的主流程

第三阶段完成后，完整状态流转如下：

1. `uploaded`
2. `queued`
3. `parsing`
4. `chunking`
5. `embedding`
6. `ready`

### 9.2 重解析场景

重解析时的主流程如下：

1. 查询当前文档版本
2. 删除旧版本向量
3. 删除旧 chunk
4. `processing_version + 1`
5. 重置文档状态
6. 重新入队
7. 再次走 `queued -> parsing -> chunking -> embedding -> ready`

## 10. 本轮异常场景处理

本轮未忽略异常场景，已明确处理以下情况：

### 10.1 百炼配置缺失

处理方式：

- 当 `BAILIAN_API_KEY` 或 `BAILIAN_EMBEDDING_MODEL` 缺失时
- 在 `EmbeddingService` 内直接抛出明确异常
- 回写文档状态为 `failed`
- 记录内部错误码 `DOCUMENT_EMBEDDING_CONFIG_MISSING`

### 10.2 百炼限流或服务异常

处理方式：

- 对 `429 / 500 / 502 / 503` 自动重试
- 每次重试采用指数退避
- 批次间强制节流

### 10.3 Embedding 返回数量不完整

处理方式：

- 若向量数量和 chunk 数量不一致，则直接失败
- 不继续写入 Qdrant
- 分片状态回写为 `failed`

### 10.4 Qdrant collection 初始化失败

处理方式：

- 明确抛出 `VECTOR_INDEX_FAILED`
- 记录内部错误码 `DOCUMENT_VECTOR_INDEX_FAILED`
- 文档状态回写为 `failed`

### 10.5 Qdrant 写入失败

处理方式：

- 不将文档推进到 `ready`
- 分片状态回写为 `failed`
- 文档状态回写为 `failed`

### 10.6 删除向量失败

处理方式：

- 删除文档和重解析都先删向量
- 若 Qdrant 删除失败，则本次操作整体失败
- 避免出现数据库已删但向量残留

## 11. 本轮实际变更文件

### 11.1 新增文件

- `apps/backend/docs/document-processing-phase3-implementation-record-2026-04-25.md`
- `apps/backend/src/common/vector/qdrant.constants.ts`
- `apps/backend/src/common/vector/qdrant.module.ts`
- `apps/backend/src/common/vector/qdrant.service.ts`
- `apps/backend/src/modules/ai/ai.module.ts`
- `apps/backend/src/modules/ai/embedding.service.ts`

### 11.2 修改文件

- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

## 12. 本轮检查结果

已执行：

- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 第三阶段相关代码构建通过
- 关键新增与修改文件无诊断错误

## 13. 当前边界说明

本轮虽已完成第三阶段核心实现，但仍有明确边界：

- 百炼配置当前只定义了标准变量名，尚未写入真实值
- 若未配置百炼变量，运行到 Embedding 阶段会明确失败
- 当前未新增任务日志表
- 当前未实现超时任务恢复
- 当前未实现后台补偿任务

## 14. 下一轮建议计划

下一轮建议进入治理增强阶段，优先顺序如下：

1. 新增任务日志表
2. 持久化记录每次处理任务和阶段耗时
3. 增加超时任务扫描
4. 增加失败重试治理与补偿删除
5. 增加管理端可读的处理进度与错误原因

原因：

- 当前已经具备“上传 -> 入队 -> 解析 -> 切块 -> 向量化 -> 入向量库 -> ready”的业务闭环
- 下一轮最关键的是把这条链路从“能跑”提升到“可治理、可观测、可维护”
