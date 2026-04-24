# 文档异步处理第四阶段实现记录

## 1. 文档说明

- 本文档用于记录后端 `document-processing` 第四阶段实现过程。
- 本轮承接第三阶段文档：
  - [document-processing-phase3-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase3-implementation-record-2026-04-25.md)
  - [bailian-embedding-config-and-debug-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/bailian-embedding-config-and-debug-record-2026-04-25.md)
- 本轮继续遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮进入第四阶段，重点把文档处理链路从“能跑”提升到“可治理、可观测、可维护”。

本轮目标如下：

1. 新增文档处理任务表
2. 记录阶段开始、完成、失败、超时状态
3. 记录阶段耗时与尝试次数
4. 增加超时任务扫描
5. 补齐失败重试治理基础

## 3. 本轮范围边界

### 3.1 本轮会做

- 新增 `b_document_processing_tasks`
- 新增任务服务
- 在 `parsing / chunking / embedding` 阶段接入任务记录
- 增加超时任务扫描
- 增加阶段级结构化日志

### 3.2 本轮不会做

- 管理端 UI 展示
- 后台补偿删除任务
- 分布式多 Worker 锁治理

## 4. 当前状态

- 状态：已完成第四阶段编码、迁移与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 5. 本轮实际完成内容

### 5.1 新增文档处理任务表

已修改：

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260425193000_document_processing_task_governance/migration.sql`

本轮新增表：

- `b_document_processing_tasks`

当前表结构作用如下：

- `document_id`
  - 关联文档主键
- `processing_version`
  - 区分不同版本处理任务
- `job_id`
  - 记录 BullMQ Job 标识
- `stage`
  - 记录当前阶段，例如 `parsing / chunking / embedding`
- `status`
  - 记录阶段任务状态，例如 `running / completed / failed / timed_out`
- `attempt`
  - 记录当前重试次数
- `error_code`
  - 记录失败错误码
- `error_message`
  - 记录失败描述
- `started_at / finished_at`
  - 记录阶段开始结束时间
- `duration_ms`
  - 记录阶段耗时
- `heartbeat_at`
  - 记录阶段心跳时间，供超时扫描使用

索引与约束如下：

- `uk_doc_processing_stage_attempt`
  - 保证同文档、同版本、同阶段、同尝试次数只有一条记录
- `idx_processing_task_document_version`
  - 支撑按文档和版本回查
- `idx_processing_task_status_stage`
  - 支撑超时与失败治理扫描

### 5.2 新增阶段任务服务

已新增：

- `apps/backend/src/modules/document-processing/services/document-processing-task.service.ts`

本轮实现的方法如下：

- `startStageTask()`
- `touchStageTask()`
- `completeStageTask()`
- `failStageTask()`
- `findTimedOutRunningTasks()`
- `markTaskTimedOut()`

当前职责如下：

- 在阶段开始时创建或重置任务记录
- 在阶段执行中更新心跳
- 在阶段成功时记录耗时
- 在阶段失败时记录错误码和错误信息
- 为超时扫描提供运行中任务查询能力

### 5.3 将阶段任务记录接入真实处理链路

已修改：

- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`

当前接入方式如下：

- Worker 从 BullMQ 取到任务后，将 `job.id` 传入处理服务
- `parsing` 开始时创建任务记录
- `parsing` 完成时回写任务完成时间和耗时
- `chunking` 开始和完成时同样写任务记录
- `embedding` 开始和完成时同样写任务记录
- 任一阶段失败时，统一写入失败任务记录

当前阶段级状态流转如下：

1. `running`
2. `completed`

异常场景下：

1. `running`
2. `failed`

超时场景下：

1. `running`
2. `timed_out`

### 5.4 增加超时任务扫描服务

已新增：

- `apps/backend/src/modules/document-processing/services/document-processing-monitor.service.ts`

已接入：

- `@nestjs/schedule`
- `ScheduleModule.forRoot()`

当前扫描策略如下：

- 默认每 `60000ms` 检查一次
- 默认阶段超时时间为 `1800000ms`
- 扫描对象为 `status = running` 的阶段任务
- 若 `heartbeat_at` 或 `started_at` 超过超时时间，则判定为超时

扫描后的处理方式如下：

1. 将任务记录标记为 `timed_out`
2. 记录错误码 `DOCUMENT_PROCESSING_TIMEOUT`
3. 回写文档状态为 `failed`
4. 记录结构化超时日志

### 5.5 失败治理增强

已修改：

- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/.env`

本轮新增治理常量如下：

- `DOCUMENT_PROCESSING_TASK_STATUS`
- `DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE`
- `DOCUMENT_PROCESSING_TIMEOUT_MS`
- `DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS`

本轮新增标准环境变量如下：

- `DOCUMENT_PROCESSING_TIMEOUT_MS`
- `DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS`

当前默认值如下：

- `DOCUMENT_PROCESSING_TIMEOUT_MS=1800000`
- `DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS=60000`

### 5.6 防止超时后被旧执行结果覆盖

已修改：

- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`

本轮增强点如下：

- 原先只校验 `processing_version`
- 现在增加“版本一致且当前阶段未进入 `failed`”校验

这样可以避免：

- 阶段已经被超时扫描标记为失败
- 旧执行线程稍后恢复后又把文档推进到 `ready`

## 6. 本轮状态流转说明

### 6.1 文档状态

文档主状态流转保持不变：

1. `uploaded`
2. `queued`
3. `parsing`
4. `chunking`
5. `embedding`
6. `ready`

失败场景：

- 任意阶段异常 -> `failed`

超时场景：

- 任意阶段长时间未完成 -> 超时扫描标记任务 `timed_out`
- 对应文档状态推进为 `failed`

### 6.2 阶段任务状态

新增任务表后，每个阶段都具备独立状态流转：

- `running`
- `completed`
- `failed`
- `timed_out`

## 7. 本轮异常场景处理

本轮未忽略异常场景，已明确处理以下情况：

### 7.1 阶段执行失败

处理方式：

- 记录任务表失败状态
- 回写错误码和错误信息
- 文档主状态置为 `failed`

### 7.2 阶段执行超时

处理方式：

- 定时扫描任务表中的运行中任务
- 判定超时后置为 `timed_out`
- 回写文档主状态为 `failed`
- 输出结构化日志，便于后续排查

### 7.3 BullMQ 自动重试

处理方式：

- 当前仍复用 BullMQ 的 `attempts`
- 每次重试会生成同阶段新的 `attempt` 维度任务记录
- 可区分第几次尝试失败或成功

## 8. 本轮实际变更文件

### 8.1 新增文件

- `apps/backend/docs/document-processing-phase4-implementation-record-2026-04-25.md`
- `apps/backend/prisma/migrations/20260425193000_document_processing_task_governance/migration.sql`
- `apps/backend/src/modules/document-processing/services/document-processing-monitor.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-task.service.ts`

### 8.2 修改文件

- `apps/backend/.env`
- `apps/backend/package.json`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`

## 9. 本轮检查结果

已执行：

- [x] `pnpm --filter backend add @nestjs/schedule`
- [x] `pnpm --filter backend exec prisma generate`
- [x] `pnpm --filter backend exec prisma migrate deploy`
- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 调度依赖接入成功
- Prisma Client 生成成功
- 文档处理任务表迁移已成功应用
- 后端构建通过
- 关键新增与修改文件无诊断错误

## 10. 当前边界说明

本轮虽已完成第四阶段治理基础，但仍有明确边界：

- 当前未提供管理端查询接口
- 当前未提供任务日志分页接口
- 当前未实现后台补偿删除任务
- 当前未实现分布式多 Worker 的去重锁

## 11. 下一轮建议计划

下一轮建议进入“管理与观测输出”阶段，优先顺序如下：

1. 提供文档处理任务查询接口
2. 在文档详情中输出最近处理任务和阶段耗时
3. 增加管理端可读的失败原因和重试记录
4. 增加补偿清理任务
5. 进入真实文档端到端联调

原因：

- 当前已经具备“任务记录 + 耗时统计 + 超时扫描 + 失败治理”基础
- 下一轮最关键的是把这些治理能力暴露给管理端和排障流程使用
