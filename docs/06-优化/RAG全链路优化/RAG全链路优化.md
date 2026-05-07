# RAG 全链路优化

> 本文档详细记录了当前项目 RAG（检索增强生成）准备阶段的全链路实现，为后续优化提供基础。
> 
> **优化分支**: `feat/rag-pipeline-optimization`
> 
> **实施顺序**:
> - [x] 01-文件解析优化 — 2026-05-07 已完成
> - [x] 02-测试规范 — 2026-05-07 已完成（E2E 框架 + Mock 方案 + 模板）
> - [ ] 03-文档切块优化 — 待实施
> - [ ] 04-向量化优化 — 待实施

---

## 一、整体架构概览

```
┌─────────────┐    ┌──────────────┐    ┌──────────────────────────────────────────────┐
│  文件上传    │ →  │  BullMQ 入队  │ →  │         异步处理流水线 (Worker)               │
│  (两种途径)  │    │  (指数退避)   │    │  Parsing → Chunking → Embedding → 写入双存储 │
└─────────────┘    └──────────────┘    └──────────────────────────────────────────────┘
                                                                        ↓
┌──────────────────────────────────────────────────────────────────────┐
│                         状态变更 → SSE 推送前端                        │
└──────────────────────────────────────────────────────────────────────┘
```

**核心文件索引：**

| 文件 | 职责 |
|------|------|
| [document.service.ts](apps/server/src/modules/document/document.service.ts) | 文档 CRUD、上传编排、重解析入口 |
| [upload/upload.service.ts](apps/server/src/modules/document/upload/upload.service.ts) | 分片上传（init/chunk/complete/cancel） |
| [queue/document-queue.service.ts](apps/server/src/modules/document/queue/document-queue.service.ts) | BullMQ 入队、连接管理 |
| [processor/document-processing.processor.ts](apps/server/src/modules/document/processor/document-processing.processor.ts) | Worker 消费入口 |
| [services/document-processing.service.ts](apps/server/src/modules/document/services/document-processing.service.ts) | **流水线主编排**（核心） |
| [services/document-parser.service.ts](apps/server/src/modules/document/services/document-parser.service.ts) | 文档解析（PDF/DOCX/MD/TXT） |
| [services/document-chunk.service.ts](apps/server/src/modules/document/services/document-chunk.service.ts) | 文档切块（结构化 + 回退） |
| [rag/ai/embedding.service.ts](apps/server/src/modules/rag/ai/embedding.service.ts) | 百炼 Embedding 调用 |
| [common/vector/qdrant.service.ts](apps/server/src/common/vector/qdrant.service.ts) | Qdrant 稠密向量读写 |
| [common/vector/elasticsearch.service.ts](apps/server/src/common/vector/elasticsearch.service.ts) | Elasticsearch 稀疏索引 |
| [services/document-processing-state.service.ts](apps/server/src/modules/document/services/document-processing-state.service.ts) | 文档状态机回写 |
| [services/document-processing-task.service.ts](apps/server/src/modules/document/services/document-processing-task.service.ts) | 阶段任务记录与超时 |
| [services/document-processing-monitor.service.ts](apps/server/src/modules/document/services/document-processing-monitor.service.ts) | 定时超时扫描 |
| [services/document-sse.service.ts](apps/server/src/modules/document/services/document-sse.service.ts) | SSE 状态推送 |

---

## 二、文件上传阶段

### 2.1 上传途径

项目提供两种上传方式：

**方式一：直接上传（小文件）**
- 入口：[DocumentService.upload()](apps/server/src/modules/document/document.service.ts#L80)
- 整个文件缓冲在内存中，一次性写入本地存储
- 适用于 `MAX_DOCUMENT_FILE_SIZE` (20MB) 以内的文件

**方式二：分片上传（大文件 / 断点续传）**
- 入口：[UploadService](apps/server/src/modules/document/upload/upload.service.ts)
- 前端 Web Worker 计算文件 SHA-256 哈希后，依次调用：
  1. `POST /api/upload/init` — 创建上传会话（支持断点恢复、秒传判定）
  2. `POST /api/upload/chunk` — 逐片上传（每片带可选哈希校验）
  3. `POST /api/upload/complete` — 合并分片 + 全文件哈希校验 + 入队

### 2.2 秒传机制

在 `init` 阶段，先查询同知识库内是否存在相同 `file_hash` 的文档（[upload.service.ts:554](apps/server/src/modules/document/upload/upload.service.ts#L554)）。命中时直接复用旧文件的物理存储路径，跳过上传和合并，立即创建新文档记录并入队。

### 2.3 支持的文件类型

[document.constants.ts](apps/server/src/modules/document/document.constants.ts) 中定义白名单：

| 扩展名 | MIME 类型 | 解析器 |
|--------|-----------|--------|
| `.pdf` | `application/pdf` | `pdf-parse` |
| `.docx` | `application/vnd.openxmlformats...` | `@langchain/community` DocxLoader |
| `.md` | `text/markdown` | `@langchain/classic` TextLoader + 标题结构提取 |
| `.txt` | `text/plain` | `@langchain/classic` TextLoader |
| `.doc` | `application/msword` | **暂未实现解析**（仅允许上传） |

---

## 三、BullMQ 异步队列

### 3.1 队列配置

- **队列名称**: `document-processing`
- **任务名称**: `process-document`
- **Job ID**: `doc-{documentId}-v-{processingVersion}` (保证幂等，同文档同版本不会重复入队)
- **重试策略**: 指数退避，初始延迟 3s，最多 3 次
- **Worker 并发度**: 由环境变量 `DOCUMENT_WORKER_CONCURRENCY` 控制，默认 1

相关代码：[document-queue.service.ts](apps/server/src/modules/document/queue/document-queue.service.ts), [document-processing.processor.ts](apps/server/src/modules/document/processor/document-processing.processor.ts)

### 3.2 Redis 连接

从 `REDIS_URL` 环境变量解析连接参数（host/port/password/db），支持 `rediss://` TLS 连接。

---

## 四、异步处理流水线（核心）

[DocumentProcessingService.processDocument()](apps/server/src/modules/document/services/document-processing.service.ts#L53) 是整个处理流程的编排入口。

### 4.1 状态机

```
uploaded → queued → parsing → chunking → embedding → ready
                                        ↓
                                      failed
```

每次状态变更通过 `EventEmitter2` 发射 `document.state.changed` 事件，由 `DocumentSseService` 广播到前端。

### 4.2 阶段一：解析 (Parsing)

**服务**: [DocumentParserService](apps/server/src/modules/document/services/document-parser.service.ts)

**统一输出结构** (`ParsedDocument`)：

```typescript
interface ParsedDocument {
  plainText: string;          // 全文纯文本
  sections: ParsedSection[];  // 结构化分段
  pageMap?: Array<{           // 页码到字符区间的映射（PDF 专有）
    pageNo: number;
    text: string;
    charStart: number;
    charEnd: number;
  }>;
}
```

**各文件类型解析逻辑：**

#### PDF 解析
- 使用 `pdf-parse` 库逐页提取文本
- **每一页作为一个 section**，标题为 `"第 N 页"`
- 构建 `pageMap` 记录每页的全文字符偏移
- 不执行段落级结构提取

#### DOCX 解析
- 使用 `@langchain/community` `DocxLoader` 提取纯文本
- 后续按双换行段落拆分为 sections
- **无标题层级信息**，`titlePath` 为空数组

#### Markdown 解析
- 使用 `@langchain/classic` `TextLoader` 提取全文
- **有标题结构提取**：正则 `/^(#{1,6})\s+(.+)$/` 匹配标题行
- sections 带有 `title`、`titlePath`（标题路径栈）、`level`（1-6）
- 当前仅实现了 Markdown 的结构化解析

#### TXT 解析
- 使用 `@langchain/classic` `TextLoader`
- 按双换行（`\n{2,}`）段落拆分为 sections
- 无标题信息

### 4.3 阶段二：切块 (Chunking)

**服务**: [DocumentChunkService](apps/server/src/modules/document/services/document-chunk.service.ts)

**切块参数常量** ([document-processing.constants.ts](apps/server/src/modules/document/document-processing.constants.ts))：

| 参数 | 值 | 说明 |
|------|-----|------|
| `DOCUMENT_CHUNK_SIZE` | 700 | 目标分片大小（token 近似值） |
| `DOCUMENT_CHUNK_OVERLAP` | 100 | 分片重叠大小（token 近似值） |

**重要**: 这些值是按"近似 token 数"计算的，实际 token 数通过 `content.length / 4` 估算，**未使用真实的 tokenizer**。

#### 切块流程

```
有 sections？
  ├── 是 → 结构化切块（createStructuredChunks）
  │         ├── section token ≤ 700 → 直接作为一个 chunk
  │         └── section token > 700 → RecursiveCharacterTextSplitter 二次切割
  └── 否 → 回退切块（createFallbackChunks）
            └── 对全文 plainText 用 RecursiveCharacterTextSplitter 递归切分
```

#### 切分器配置

使用 `@langchain/textsplitters` 的 `RecursiveCharacterTextSplitter`：
- `chunkSize: 700`（以估算 token 数为度量）
- `chunkOverlap: 100`（相邻 chunk 重叠 100 个估算 token）
- `lengthFunction`: `(text) => Math.max(1, Math.ceil(text.length / 4))`

#### 每个 Chunk 携带的元数据

写入 `b_document_chunks` 表：

| 字段 | 含义 |
|------|------|
| `content` | 分片文本内容 |
| `chunk_index` | 分片序号（从 0 开始） |
| `token_count` | 估算 token 数 |
| `page_no` | 所在页码（PDF 专有） |
| `char_start/char_end` | 在全文中的字符偏移 |
| `vector_id` | 稳定的 UUID（用于 Qdrant 幂等写入） |
| `metadata_json` | 结构信息：`{ title, sourceFileName, titlePath, sectionLevel, chunkStrategy }` |
| `embedding_status` | `pending` → `processing` → `completed` / `failed` |

#### Vector ID 生成

`buildDocumentChunkVectorId()` 基于 `doc:{id}:chunk:{index}:v:{version}` → SHA-256 → RFC 4122 UUID 格式，保证每次重新处理生成相同的 UUID 以支持幂等。

### 4.4 阶段三：向量化 (Embedding)

**服务**: [EmbeddingService](apps/server/src/modules/rag/ai/embedding.service.ts)

#### 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `BAILIAN_API_KEY` | (必填) | 阿里云百炼 API Key |
| `BAILIAN_EMBEDDING_MODEL` | (必填) | Embedding 模型名 |
| `BAILIAN_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-api/v1` | API 端点 |
| `BAILIAN_EMBEDDING_DIMENSIONS` | 模型默认 | 向量维度 |
| `BAILIAN_EMBED_BATCH_SIZE` | 50 | 每批最大文本数 |
| `BAILIAN_EMBED_RETRY_COUNT` | 3 | 失败重试次数 |
| `BAILIAN_EMBED_REQUEST_INTERVAL_MS` | 1000 | 批次间间隔 |
| `BAILIAN_DOCUMENT_EMBEDDING_TYPE` | `text` | 当前仅支持 `text` |

#### 调用流程

1. 通过 `@langchain/openai` 的 `OpenAIEmbeddings` 客户端，以 OpenAI 兼容接口调用百炼
2. 按 `batchSize=50` 分批发送（所有 chunks 一次性获取后分批调用）
3. 批次间间隔 1000ms 限频
4. 重试仅对 HTTP 429 / 500 / 502 / 503 触发，指数退避延迟（`requestIntervalMs * 2^(attempt+1)`）
5. 向量化完成后校验：返回向量数 == chunks 数，且每个向量非空

#### Token 估算

**全程使用 `content.length / 4` 估算 token 数**，未接入百炼 API 返回的真实 `usage.total_tokens`。这意味着：
- `b_documents.token_count` 是估算值
- `b_document_chunks.token_count` 是估算值
- Chunk 大小控制（700）是估算值

### 4.5 阶段四：向量入库

#### Qdrant（稠密向量）

- Collection: `kb_document_chunks`
- 距离度量: `Cosine`
- 自动创建 collection（按第一批向量的维度）
- 批量 upsert points，每个 point payload 携带：
  ```typescript
  {
    kbId, docId, chunkId, chunkIndex,
    uploaderId, processingVersion,
    pageNo, title, charStart, charEnd, content
  }
  ```
- `content` 存在 payload 中 → 检索时可直接返回，无需回查数据库

#### Elasticsearch（稀疏检索）

- 索引: `kb_document_chunks_es`（可通过 `ELASTICSEARCH_INDEX` 自定义）
- 分词器: `ik_max_word`（中文细粒度分词）
- 写入字段: `chunkId`, `docId`, `kbId`, `content`, `title`, `metadata`
- `metadata` 对象禁用索引映射（`enabled: false`）

#### 写入顺序

Qdrant 和 ES 是**顺序写入**，非并行。任一写入失败都会导致整个处理流程标记为失败。但 Qdrant 写入成功、ES 写入失败时，Qdrant 数据不会被回滚。

---

## 五、可重解析机制

`DocumentService.reparse()` ([document.service.ts:448](apps/server/src/modules/document/document.service.ts#L448))

重解析流程：
1. 校验权限（owner / manager 或自己上传的文档）
2. 删除 Qdrant 中旧版本向量（按 `docId + processingVersion`）
3. 删除 ES 中旧版本数据（按 `docId + processingVersion`）
4. 删除 `b_document_chunks` 中全部旧分片
5. 递增 `processing_version += 1`
6. 重置文档处理状态为 `uploaded`
7. 重新入队

**注意**：重解析会清空所有旧 chunks，但用 `processingVersion` 过滤旧 Qdrant/ES 数据，这意味着即使不同版本的数据短暂共存，检索时也可以根据版本号区分。

---

## 六、超时与异常处理

### 6.1 超时监控

[DocumentProcessingMonitorService](apps/server/src/modules/document/services/document-processing-monitor.service.ts)

- `@Interval` 每分钟扫描一次（可通过 `DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS` 调整）
- 默认超时阈值：30 分钟（`DOCUMENT_PROCESSING_TIMEOUT_MS`）
- 扫描 `b_document_processing_tasks` 中 `status='running'` 且 `heartbeat_at` 超过阈值的任务
- 标记为 `timed_out`，文档状态推进到 `failed`

### 6.2 错误分类

`DocumentProcessingService.resolveProcessingError()` ([document-processing.service.ts:406](apps/server/src/modules/document/services/document-processing.service.ts#L406))

错误被映射到三个阶段之一：
- **parsing**: 默认阶段；解析/源文件/不支持类型 错误
- **chunking**: chunk/split/token 相关关键词
- **embedding**: embedding/vector/qdrant/elasticsearch 相关关键词

### 6.3 重试机制

- BullMQ 层面：指数退避，最多 3 次
- Embedding 层面：对 429/500/502/503 重试，最多 `retryCount` (3) 次
- 重试过程中每个 attempt 都在 `b_document_processing_tasks` 中记录

---

## 七、与检索阶段的衔接

文档完成 `ready` 后，检索阶段（[RetrievalService](apps/server/src/modules/rag/retrieval/retrieval.service.ts)）的完整链路：

```
用户查询 → 稠密检索(Qdrant) + 稀疏检索(ES) → RRF 融合 → qwen3-rerank 精排 → 返回结果
```

检索时的参数根据问题类型动态调整：

| 问题类型 | dense/sparse topK | fusion topK | score threshold |
|----------|------------------|-------------|-----------------|
| `fact_lookup` | 20 | 50 | 0.3 |
| `compare_analysis` | 30 | 80 | 0.15 |
| `research_or_open_world` | 30 | 80 | 0.15 |

---

## 八、当前问题与优化方向

### 8.1 Token 计算不精确
- **问题**: 全程用 `char.length / 4` 估算，中文实际比值约 1:0.5-1:1，误差较大
- **影响**: chunk 大小不准，大文本可能超出 embedding 模型的 token 限制
- **方向**: 接入 `tiktoken` 或百炼原生 tokenizer，或从 API 返回中提取真实 usage

### 8.2 PDF 解析缺少结构提取
- **问题**: 每页作为一个 section，无段落/标题/表格识别
- **影响**: 切块按页边界进行，可能切断语义完整的段落；丢失标题路径信息
- **方向**: 考虑使用 `pdf-parse` 自定义 render 提取字体大小区分标题，或使用版面分析模型

### 8.3 Chunk 策略缺乏文档类型感知
- **问题**: 所有类型用同一套 `chunkSize=700` + `chunkOverlap=100`
- **影响**: Markdown 代码块可能被截断，表格被拆分到不同 chunk
- **方向**: 按文档类型和内容特征自适应选择 chunk 策略

### 8.4 Embedding 配置单一
- **问题**: 仅支持 `text` 类型 embedding model（`BAILIAN_DOCUMENT_EMBEDDING_TYPE` 可选 `vision` 但 `createEmbeddingsClient` 拒绝非 text 类型）
- **方向**: 完善 vision embedding 支持；考虑混合 embedding（如 title 用单独向量）

### 8.5 无文档预处理管线
- **问题**: 解析后的纯文本直接切块，没有文本清洗/去噪/格式标准化
- **影响**: PDF 中常见的页眉页脚、页码、水印等噪声文本也参与向量化
- **方向**: 在 chunking 前增加预处理步骤（去页眉页脚、去空行压缩、全角半角归一化等）

### 8.6 Qdrant 和 ES 写入非原子性
- **问题**: 顺序写入，Qdrant 成功但 ES 失败时不回滚 Qdrant
- **方向**: 考虑先写 Qdrant，ES 写入失败时清理 Qdrant；或用事务性模式

### 8.7 缺少文档级去重
- **问题**: 同知识库内同 hash 秒传仅在上传阶段生效，手动重解析可能创建重复向量
- **影响**: 检索时同质化内容权重偏高

### 8.8 Chunk 元数据未充分利用
- **问题**: `b_document_chunks.metadata_json` 中有 `titlePath`、`sectionLevel`、`chunkStrategy` 等信息，但在检索阶段未用于过滤或加权
