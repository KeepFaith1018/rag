# 文档异步处理第二阶段实现记录

## 1. 文档说明

- 本文档用于记录后端 `document-processing` 第二阶段实现过程。
- 本轮承接第一阶段文档：
  - [document-processing-phase1-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase1-implementation-record-2026-04-25.md)
- 本轮继续遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮进入第二阶段，重点让文档真正从“已入队”进入“可解析、可切块”的状态。

本轮目标如下：

1. 接入 LangChain 文档解析相关依赖
2. 实现 `DocumentParserService`
3. 实现 `DocumentChunkService`
4. 启用同进程 Worker 消费
5. 推进文档状态从 `queued -> parsing -> chunking`
6. 将 chunk 写入 `b_document_chunks`
7. 回写文档 `token_count`

## 3. 本轮确认事项

本轮已确认以下关键决策：

1. 文档解析使用 LangChain 提供的模块
2. Worker 采用“同进程 Worker”模式

## 4. 本轮范围边界

### 4.1 本轮会做

- `pdf / docx / md / txt` 解析能力接入
- 结构化分片与 chunk 落库
- Worker 消费任务并推进到 `chunking`
- 基础 token 统计回写

### 4.2 本轮不会做

- 阿里云百炼 Embedding 接入
- Qdrant 写入与删除
- 任务日志表落库
- 管理端进度展示

## 5. 计划实施文件

预计本轮会涉及以下文件：

- `apps/backend/package.json`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/interfaces/parsed-document.interface.ts`
- `apps/backend/src/modules/document-processing/interfaces/parsed-section.interface.ts`
- `apps/backend/src/modules/document-processing/services/document-parser.service.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`

## 6. 风险与注意事项

- LangChain 文件加载器存在可选依赖，安装组合必须正确。
- PDF 与 DOCX 解析能力可能受第三方库兼容性影响，失败时必须明确记录错误。
- 同进程 Worker 会在应用启动时直接连接 Redis，因此 Redis 可用性会直接影响处理链路。
- 本轮只推进到 `chunking` 完成，不会进入 `embedding` 和 `ready`。

## 7. 当前状态

- 状态：已完成第二阶段编码与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 8. 本轮实际完成内容

### 8.1 依赖接入

已在 `apps/backend/package.json` 中新增以下依赖：

- `langchain`
- `@langchain/core`
- `@langchain/classic`
- `@langchain/community`
- `@langchain/textsplitters`
- `mammoth`
- `pdf-parse`

说明：

- `DocxLoader` 侧使用 `mammoth`
- `PDFLoader` 侧使用 `pdf-parse`
- 文本切分使用 `RecursiveCharacterTextSplitter`

### 8.2 新增接口与服务

已新增：

- `apps/backend/src/modules/document-processing/interfaces/parsed-document.interface.ts`
- `apps/backend/src/modules/document-processing/interfaces/parsed-section.interface.ts`
- `apps/backend/src/modules/document-processing/services/document-parser.service.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`

职责如下：

- `DocumentParserService`
  - 负责基于 LangChain Loader 解析 `pdf / docx / md / txt`
  - 统一输出 `ParsedDocument`
  - 对 PDF 尽量保留页级信息
- `DocumentChunkService`
  - 负责基于 `RecursiveCharacterTextSplitter` 做字符级递归切块
  - 负责 chunk 落库到 `b_document_chunks`
  - 负责回写 chunk 级 token 估算值

### 8.3 启用同进程 Worker

已修改：

- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/queue/document-queue.service.ts`

实际实现如下：

- 在 `DocumentProcessingProcessor` 中使用 BullMQ `Worker`
- Worker 在 Nest 模块初始化时启动
- Worker 与 `DocumentQueueService` 复用同一套 Redis 连接解析逻辑
- 当前 Worker 并发为 `1`

### 8.4 启用真实处理编排

已修改：

- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`

实际处理流程如下：

1. Worker 消费 `document-processing` 队列
2. 校验文档是否存在
3. 校验 `processing_version` 是否仍为当前版本
4. 校验源文件是否存在
5. 回写状态为 `parsing`
6. 调用 `DocumentParserService` 解析文件
7. 再次校验版本号，避免旧任务污染
8. 回写状态为 `chunking`
9. 调用 `DocumentChunkService` 切块并落库
10. 回写 `token_count` 和 `parse_finished_at`

### 8.5 状态流转结果

本轮启用后的状态流转如下：

- `queued -> parsing -> chunking`

说明：

- 本轮不会推进到 `embedding`
- 本轮不会推进到 `ready`
- 当前 `chunking` 表示“解析和切块已完成，等待下一阶段向量化接力”

### 8.6 Chunk 数据结构落地情况

当前实际落库字段如下：

- `doc_id`
- `chunk_index`
- `content`
- `token_count`
- `page_no`
- `char_start`
- `char_end`
- `vector_id`
- `metadata_json`
- `embedding_status`

其中：

- `vector_id` 已按 `doc:{docId}:chunk:{chunkIndex}:v:{version}` 生成
- `metadata_json` 已写入：
  - `processingVersion`
  - `title`
  - `sourceFileName`
  - `titlePath`
- `embedding_status` 当前固定为 `pending`

### 8.7 当前 token 统计策略

当前阶段尚未接入模型级 tokenizer，因此：

- chunk `token_count` 使用轻量估算值
- 文档 `token_count` 为各 chunk 估算值汇总

说明：

- 这是当前阶段的可实现方案
- 后续接入 Embedding 时可再替换为更精确的模型 tokenizer

## 9. 本轮异常场景处理

本轮未忽略异常场景，已明确处理以下情况：

### 9.1 源文件不存在

处理方式：

- 任务消费时检查文件是否存在
- 若不存在，回写失败状态
- 记录内部错误码 `DOCUMENT_SOURCE_FILE_MISSING`

### 9.2 文件类型不支持解析

当前阶段支持：

- `pdf`
- `docx`
- `md`
- `txt`

处理方式：

- 若文件类型不在上述范围内，则直接失败
- 记录内部错误码 `DOCUMENT_PARSE_UNSUPPORTED`

说明：

- 当前上传侧如果仍允许 `.doc`，该类型会在第二阶段解析时明确失败
- 这是当前已知边界，不是静默忽略

### 9.3 解析器异常

处理方式：

- PDF、DOCX、文本解析都做独立异常包装
- 失败时统一回写到 `failed`
- 记录对应错误信息，便于后续重试和排障

### 9.4 旧版本任务污染

处理方式：

- 处理前检查 `processing_version`
- 解析完成后再次检查 `processing_version`
- 若版本已变化，当前任务直接停止，不继续写入 chunk

## 10. 本轮实际变更文件

### 10.1 新增文件

- `apps/backend/docs/document-processing-phase2-implementation-record-2026-04-25.md`
- `apps/backend/src/modules/document-processing/interfaces/parsed-document.interface.ts`
- `apps/backend/src/modules/document-processing/interfaces/parsed-section.interface.ts`
- `apps/backend/src/modules/document-processing/services/document-parser.service.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`

### 10.2 修改文件

- `apps/backend/package.json`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`
- `apps/backend/src/modules/document-processing/document-processing.module.ts`
- `apps/backend/src/modules/document-processing/queue/document-queue.service.ts`
- `apps/backend/src/modules/document-processing/processor/document-processing.processor.ts`
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts`
- `apps/backend/src/modules/document-processing/services/document-processing-state.service.ts`

## 11. 本轮检查结果

已执行：

- [x] 新增 LangChain 相关依赖
- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 第二阶段相关代码构建通过
- 最近修改文件无诊断错误
- LangChain 依赖与当前工程可正常编译集成

## 12. 当前边界说明

本轮虽已完成第二阶段核心能力，但仍有明确未完成项：

- 未接入阿里云百炼 Embedding
- 未接入 Qdrant 写入与删除
- 未实现 `embedding -> ready` 状态推进
- 未新增任务日志表
- 未实现超时任务恢复与补偿删除

## 13. 下一轮建议计划

下一轮建议进入第三阶段，优先顺序如下：

1. 新增 `AiModule`
2. 接入阿里云百炼 Embedding 能力
3. 增加频率限制、批量提交、重试控制
4. 新增 `QdrantService`
5. 将 chunk 向量写入 Qdrant
6. 推进状态从 `chunking -> embedding -> ready`

原因：

- 当前文档已经具备“上传 -> 入队 -> 解析 -> 切块落库”的基础闭环
- 下一轮的关键目标是让文档真正进入“可向量检索”状态
