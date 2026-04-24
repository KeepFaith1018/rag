# 文档异步处理第一阶段实现记录

## 1. 文档说明

- 本文档用于记录后端 `document-processing` 第一阶段实现过程。
- 本轮严格承接以下方案文档执行：
  - [09-rag-document-processing-architecture-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/09-rag-document-processing-architecture-plan-2026-04-25.md)
  - [10-rag-document-processing-detailed-design-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/10-rag-document-processing-detailed-design-2026-04-25.md)
- 本轮遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮只实现第一阶段最小闭环，不提前展开第二阶段及以后能力。

本轮目标如下：

1. 补齐 `b_documents` 的异步处理治理字段
2. 新增 `document-processing` 模块骨架
3. 接入 `Redis + BullMQ` 基础能力
4. 新增文档处理入队服务
5. 修改 `DocumentService.upload()`，实现上传后入队
6. 修改 `DocumentService.reparse()`，实现版本化重解析入队

## 3. 本轮范围边界

### 3.1 本轮会做

- Prisma `schema.prisma` 字段调整
- BullMQ 基础依赖接入
- `document-processing` 模块目录和核心文件骨架
- `DocumentQueueService`
- 文档状态从 `uploaded -> queued` 的最小闭环
- 重解析时的 `processing_version` 递增与重新入队

### 3.2 本轮不会做

- 实际文档文本解析
- `pdf / docx / md / txt` 解析库接入
- chunk 落库
- 阿里云百炼 Embedding 接入
- Qdrant 写入和删除
- 任务日志表落库

说明：

- 上述未实现项不是忽略，而是明确放到后续阶段处理。

## 4. 当前已知前提

- 后端当前尚未接入 BullMQ 依赖。
- 当前 `document` 模块已经完成上传、删除、重解析入口。
- 当前 `b_documents` 已具备基础状态字段，但尚未具备完整的版本化治理字段。
- 当前首版继续采用本地文件存储，不引入对象存储。

## 5. 计划实施文件

预计本轮会涉及以下文件：

- `apps/backend/package.json`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/interfaces/document-processing-job.interface.ts`
- `apps/backend/src/modules/document-processing/queue/document-queue.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

## 6. 风险与注意事项

- BullMQ 接入后，必须确保 Redis 配置读取正确，否则应用启动会失败。
- 重解析逻辑必须避免旧版本任务污染新版本状态。
- 本轮只实现最小闭环，因此 Worker 首版可只做状态流转和占位处理，不做真实解析。
- 所有新增代码需保留必要中文注释，并复用现有异常治理能力。

## 7. 当前状态

- 状态：已完成第一阶段编码与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 8. 本轮实际确认事项

本轮实现前，已补充确认以下关键决策：

- 第一阶段接入 BullMQ 后，采用“仅入队不消费”策略
- 当前阶段只完成队列基础设施与入队逻辑，不提前把文档标记为 `ready`
- 当前阶段不接入真实解析、分片、向量化和 Qdrant 写入

原因：

- 避免出现“未解析却标记为 ready”的错误业务语义
- 保持第一阶段目标清晰，只实现真正可落地的最小基础设施

## 9. 本轮实际完成内容

### 9.1 依赖接入

- 已在 `apps/backend/package.json` 中新增 `bullmq`

### 9.2 Prisma 字段调整

已在 `apps/backend/prisma/schema.prisma` 的 `b_documents` 中补充以下字段：

- `processing_version`
- `current_stage`
- `last_error_stage`
- `retry_count`
- `last_error_code`

作用：

- 支撑版本化重解析
- 支撑异步处理阶段状态治理
- 支撑后续失败排障与重试统计

### 9.3 新增 `document-processing` 模块骨架

已新增：

- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/interfaces/document-processing-job.interface.ts`
- `apps/backend/src/modules/document-processing/queue/document-queue.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

本轮职责划分如下：

- `DocumentQueueService`
  - 负责 BullMQ 队列初始化
  - 负责文档任务入队
  - 负责统一生成 `jobId`
- `DocumentProcessingStateService`
  - 负责 `queued` 状态回写
  - 负责重解析状态重置
  - 负责入队失败错误信息回写
- `DocumentProcessingService`
  - 当前仅保留骨架
- `DocumentProcessingProcessor`
  - 当前仅保留消费入口骨架，未启动真实消费

### 9.4 文档模块接入入队能力

已修改：

- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`
- `apps/backend/src/app.module.ts`

实际落地行为：

- 上传文档后：
  - 先保存文件和文档元数据
  - 再创建 BullMQ 任务
  - 入队成功后将文档状态回写为 `queued`
- 重解析文档后：
  - 先清理旧 chunk
  - 再重置文档状态和版本号
  - 再重新入队
  - 入队成功后将状态回写为 `queued`

### 9.5 返回结构增强

`DocumentService` 返回的文档信息已补充以下字段：

- `processingVersion`
- `currentStage`
- `lastErrorStage`
- `retryCount`
- `lastErrorCode`

用途：

- 便于前端后续展示处理版本和当前阶段
- 便于管理端或排障时查看失败上下文

## 10. 本轮状态流转说明

### 10.1 上传场景

本轮实际状态流转如下：

1. 上传请求进入
2. 创建 `b_documents`，初始状态为 `uploaded`
3. 创建 BullMQ 任务
4. 入队成功后更新为 `queued`

### 10.2 重解析场景

本轮实际状态流转如下：

1. 用户触发重解析
2. 清理旧 `b_document_chunks`
3. 文档 `processing_version + 1`
4. 文档状态重置为 `uploaded`
5. 入队成功后更新为 `queued`

### 10.3 当前阶段不消费任务

本轮不会自动把任务推进到：

- `parsing`
- `chunking`
- `embedding`
- `ready`

说明：

- 这些状态需要在第二阶段真实解析能力接入后再推进

## 11. 本轮异常场景处理

本轮没有忽略异常场景，已明确处理以下情况：

### 11.1 上传后入队失败

处理方式：

- 回滚已创建的 `b_documents` 记录
- 删除已保存的本地源文件
- 向上抛出明确业务异常

原因：

- 避免出现“接口报错但数据库和文件已残留”的脏数据

### 11.2 重解析入队失败

处理方式：

- 保留已重置后的文档记录
- 回写：
  - `status = uploaded`
  - `current_stage = uploaded`
  - `last_error_stage = queued`
  - `last_error_code = DOCUMENT_QUEUE_ENQUEUE_FAILED`
  - `error_msg`
- 允许后续人工再次触发重解析

原因：

- 重解析是后续可重试操作，不适合直接删除文档

### 11.3 Redis 配置异常

处理方式：

- 在队列服务初始化连接参数时校验 `REDIS_URL`
- 地址缺失或格式错误时抛出明确异常

## 12. 本轮实际变更文件

### 12.1 新增文件

- `apps/backend/docs/document-processing-phase1-implementation-record-2026-04-25.md`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/interfaces/document-processing-job.interface.ts`
- `apps/backend/src/modules/document-processing/queue/document-queue.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

### 12.2 修改文件

- `apps/backend/package.json`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/modules/document/document.module.ts`
- `apps/backend/src/modules/document/document.service.ts`

## 13. 本轮检查结果

已执行：

- [x] `pnpm --filter backend add bullmq`
- [x] `pnpm --filter backend exec prisma generate`
- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 后端 Prisma Client 生成成功
- 后端构建通过
- 已修改的关键文件无诊断错误

## 14. 当前边界说明

本轮虽已完成第一阶段基础设施接入，但仍有明确未完成项：

- 未启动真实 BullMQ Worker 消费
- 未实现文档文本提取
- 未实现 chunk 落库逻辑
- 未接入阿里云百炼 Embedding
- 未接入 Qdrant 写入与删除
- 未新增任务日志表

## 15. 下一轮建议计划

下一轮建议严格进入第二阶段，优先顺序如下：

1. 实现 `DocumentParserService`
2. 实现 `DocumentChunkService`
3. 将 chunk 写入 `b_document_chunks`
4. 推进状态从 `queued -> parsing -> chunking`
5. 回写 token 统计

原因：

- 当前第一阶段的入队边界、版本化字段和状态治理基础已经具备
- 下一轮最关键的是让文档真正开始从“已入队”进入“可解析”状态
