# 文档异步处理第五阶段实现记录

## 1. 文档说明

- 本文档用于记录后端 `document-processing` 第五阶段实现过程。
- 本轮承接第四阶段文档：
  - [document-processing-phase4-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase4-implementation-record-2026-04-25.md)
- 本轮继续遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮进入第五阶段，重点把文档处理治理能力暴露给管理端与排障流程。

本轮目标如下：

1. 提供文档处理任务查询接口
2. 在文档详情中输出最近处理任务和阶段耗时
3. 增加管理端可读的失败原因和重试记录

## 3. 本轮范围边界

### 3.1 本轮会做

- 新增文档处理任务查询 DTO
- 新增文档处理任务查询接口
- 在文档详情中追加处理概览和最近任务信息

### 3.2 本轮不会做

- 管理端页面开发
- 手动重试接口
- 补偿清理任务

## 4. 当前状态

- 状态：已完成第五阶段编码与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 5. 本轮实际完成内容

### 5.1 新增文档处理任务查询 DTO

已新增：

- `apps/backend/src/modules/document/dto/list-document-processing-tasks.dto.ts`

当前支持的查询参数如下：

- `status`
- `stage`
- `processingVersion`
- `page`
- `pageSize`

当前用途如下：

- 支持管理端按阶段状态过滤任务
- 支持按版本筛选当前或历史处理任务
- 支持分页读取任务日志

### 5.2 新增文档处理任务查询接口

已修改：

- `apps/backend/src/modules/document/document.controller.ts`
- `apps/backend/src/modules/document/document.service.ts`

当前新增接口如下：

```text
GET /knowledge-bases/:kbId/documents/:documentId/processing-tasks
```

接口行为如下：

- 先校验知识库读取权限
- 再校验文档是否存在
- 再按查询条件分页返回任务记录

当前返回内容包括：

- 当前文档所处阶段
- 当前处理版本号
- 当前查询过滤条件
- 任务列表
- 分页信息

### 5.3 在文档详情中输出处理概览

已修改：

- `apps/backend/src/modules/document/document.service.ts`

当前 `detail` 接口在原有文档详情基础上，新增以下结构：

- `processingOverview`
- `recentProcessingTasks`

其中 `processingOverview` 包含：

- `currentStage`
- `currentProcessingVersion`
- `retryCount`
- `lastErrorCode`
- `lastErrorStage`
- `errorMessage`
- `latestTask`
- `latestFailedTask`
- `currentVersionTaskCount`
- `stageDurations`

这样前端无需自行拼装多张表数据，就可以直接展示：

- 当前文档处理进度
- 最近一次任务状态
- 最近失败任务
- 各阶段耗时

### 5.4 增强任务服务查询能力

已修改：

- `apps/backend/src/modules/document-processing/services/document-processing-task.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`

本轮新增方法如下：

- `listDocumentTasks()`
- `getRecentDocumentTasks()`

当前职责如下：

- 为文档处理任务查询接口提供分页数据
- 为文档详情提供最近任务摘要
- 将治理能力通过模块导出给 `document` 模块复用

### 5.5 当前任务输出结构

当前任务接口和详情中的任务项统一输出如下字段：

- `id`
- `documentId`
- `processingVersion`
- `jobId`
- `stage`
- `status`
- `attempt`
- `errorCode`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `durationMs`
- `heartbeatAt`
- `createdAt`
- `updatedAt`

说明：

- 这套输出结构已经足够支撑管理端表格、失败排障和阶段耗时展示
- 当前没有直接暴露数据库字段名风格，而是统一转换成前端友好的驼峰格式

## 6. 本轮状态流转说明

### 6.1 文档状态

本轮未改变文档主状态流转：

1. `uploaded`
2. `queued`
3. `parsing`
4. `chunking`
5. `embedding`
6. `ready`

### 6.2 管理输出层

本轮新增的是“状态可读性输出”，不是新的业务状态。

当前管理端可读取：

- 文档当前阶段
- 最近任务状态
- 最近失败任务
- 当前版本阶段耗时
- 历史任务分页记录

## 7. 本轮异常场景处理

本轮未忽略异常场景，已明确处理以下情况：

### 7.1 文档不存在

处理方式：

- 复用现有 `getDocumentOrThrow()`
- 返回明确业务异常

### 7.2 处理版本号格式不正确

处理方式：

- 新增 `parseProcessingVersion()`
- 非正整数时直接返回参数错误

### 7.3 查询无任务记录

处理方式：

- 接口返回空列表
- 不把“暂无处理记录”误判为异常

## 8. 本轮实际变更文件

### 8.1 新增文件

- `apps/backend/docs/document-processing-phase5-implementation-record-2026-04-25.md`
- `apps/backend/src/modules/document/dto/list-document-processing-tasks.dto.ts`

### 8.2 修改文件

- `apps/backend/src/modules/document/document.controller.ts`
- `apps/backend/src/modules/document/document.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-task.service.ts`

## 9. 本轮检查结果

已执行：

- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 后端构建通过
- 第五阶段新增接口与详情结构无诊断错误

## 10. 当前边界说明

本轮虽已完成第五阶段后端输出能力，但仍有明确边界：

- 当前未开发管理端页面
- 当前未提供手动重试接口
- 当前未提供补偿清理接口
- 当前未提供独立的任务统计聚合接口

## 11. 下一轮建议计划

下一轮建议优先进入真实文档端到端联调，顺序如下：

1. 上传真实测试文档
2. 验证 `queued -> parsing -> chunking -> embedding -> ready`
3. 验证 `b_document_processing_tasks` 记录是否完整
4. 验证 Qdrant collection 和向量写入是否正确
5. 再决定是否补手动重试和补偿清理接口

原因：

- 当前后端已经具备“处理链路 + 治理记录 + 管理输出”三层闭环
- 下一轮最关键的是验证真实数据流是否与设计一致
