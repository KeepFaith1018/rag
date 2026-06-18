# RAG 模块详细设计文档

## 1. 模块概述

RAG (Retrieval-Augmented Generation) 模块是 Linsor AI 系统的核心检索引擎，负责文档向量化和语义检索。模块实现了**混合检索流水线**，结合密集向量搜索、稀疏关键词搜索、RRF 融合和重排。

**核心功能**：
- 文档向量化（Embedding）
- 混合检索（dense + sparse + rerank）
- 引用管理

---

## 2. 目录结构

```
rag/
├── rag.module.ts              # 主模块定义
├── ai/                        # AI 能力子模块
│   ├── ai.module.ts
│   ├── ai.controller.ts       # AI 能力 API
│   ├── embedding.service.ts   # 向量化服务
│   └── chat-model.service.ts  # 聊天模型工厂
└── retrieval/                 # 检索流水线子模块
    ├── retrieval.service.ts    # 检索编排器
    ├── dense-retrieval.service.ts    # 密集向量检索
    ├── sparse-retrieval.service.ts   # 稀疏关键词检索
    ├── fusion.service.ts       # RRF 融合
    ├── rerank.service.ts       # 重排
    ├── citation.service.ts     # 引用管理
    ├── retrieval-trace.service.ts  # 检索追踪
    ├── dto/
    │   └── hybrid-retrieve.dto.ts
    └── interfaces/
        ├── dense-hit.interface.ts
        ├── sparse-hit.interface.ts
        ├── fused-hit.interface.ts
        └── reranked-hit.interface.ts

基础设施（common/vector/）：
├── qdrant.service.ts    # Qdrant 向量数据库操作
├── qdrant.module.ts
└── qdrant.constants.ts
```

---

## 3. 向量化和聊天模型服务

### 3.1 EmbeddingService (`ai/embedding.service.ts`)

**用途**：统一的阿里巴巴百炼（Bailian）嵌入 API 封装

**核心方法**：
```typescript
async embedDocuments(texts: string[]): Promise<{ vectors: number[][]; totalTokens: number }>
```

**特性**：
- 自动批处理（batching）
- 速率限制
- 重试逻辑（默认 3 次）
- 支持文本和视觉嵌入模型

**环境变量配置**：

| 变量 | 必填 | 默认值 |
|------|------|--------|
| `BAILIAN_API_KEY` | 是 | - |
| `BAILIAN_TEXT_EMBEDDING_MODEL` | 是 | - |
| `BAILIAN_EMBEDDING_DIMENSIONS` | 否 | - |
| `BAILIAN_EMBED_BATCH_SIZE` | 否 | 10 |
| `BAILIAN_EMBED_RETRY_COUNT` | 否 | 3 |
| `BAILIAN_EMBED_REQUEST_INTERVAL_MS` | 否 | 1000ms |
| `BAILIAN_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

---

### 3.2 ChatModelService (`ai/chat-model.service.ts`)

**用途**：ChatOpenAI 模型实例工厂

**核心方法**：
```typescript
createModel(options: ChatModelOptions = {}): ChatOpenAI
getDefaultModelName(): string
getModelCapabilities(modelName: string): ModelCapabilities
isCapabilityEnabled(modelName: string, capability: keyof ModelCapabilities): boolean
```

**特性**：
- 模型选择优先级：运行时选项 > 环境变量 > 硬编码默认值（`gpt-4o-mini`）
- 自动检测模型能力（thinking, vision, toolCalling, streaming）

**环境变量配置**：

| 变量 | 必填 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | 是 | - |
| `OPENAI_BASE_URL` | 否 | - |
| `LLM_MODEL` | 否 | `gpt-4o-mini` |

---

### 3.3 AiController (`ai/ai.controller.ts`)

**端点**：
- `GET /ai/model-configs` - 返回当前用户可用的模型配置

---

## 4. 检索流水线详解

### 4.1 检索流程总览

```
Query → Dense Retrieval → Sparse Retrieval → RRF Fusion → Rerank → Results
```

### 4.2 RetrievalService (`retrieval/retrieval.service.ts`)

**用途**：检索流水线的编排器，协调所有检索步骤

**流水线步骤**：
1. **Dense Vector Retrieval** - 查询向量化 + Qdrant 相似度搜索
2. **Sparse Keyword Retrieval** - 查询关键词提取 + 数据库 OR-contains 匹配
3. **RRF Fusion** - 互惠排名融合合并结果
4. **Rerank** - 阈值过滤和文本匹配评分

**参数接口**：
```typescript
interface RetrieveParams {
  queries: string[];           // 多个查询（原始 + 重写）
  kbIds: string[];             // 要搜索的知识库 IDs
  denseTopK?: number;          // 默认: 20
  sparseTopK?: number;         // 默认: 20
  fusionTopK?: number;          // 默认: 50
  scoreThreshold?: number;      // 默认: 0.3
  questionType?: 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
}
```

**返回结果**：
```typescript
interface RetrieveResult {
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  fusedHits: FusedHit[];
  rerankedHits: RerankedHit[];
  totalDurationMs: number;
}
```

---

### 4.3 DenseRetrievalService (`retrieval/dense-retrieval.service.ts`)

**用途**：基于 Qdrant 的密集向量搜索

**流程**：
1. 使用 `EmbeddingService` 批量向量化多个查询
2. 通过 `QdrantService.searchChunkVectors()` 执行相似度搜索
3. 按 `chunkId` 去重，保留最高分
4. 支持 `scoreThreshold` 过滤

**关键调用**：
```typescript
// 批量向量化查询
const { vectors } = await embeddingService.embedDocuments(queries);

// Qdrant 相似度搜索
const denseResults = await qdrantService.searchChunkVectors({
  vectors,
  kbIds,
  topK: denseTopK,
  scoreThreshold,
});
```

---

### 4.4 SparseRetrievalService (`retrieval/sparse-retrieval.service.ts`)

**用途**：轻量级基于关键词的检索，使用应用级倒排索引

**特性**：
- 使用 Prisma 原生查询，`LIKE` 子句查询 `b_document_chunks`
- 简单中英文停用词过滤
- 评分公式：`keywordRatio * 0.7 + lengthFactor * 0.3`
- 每个查询最多 10 个关键词

**SQL 示例**：
```sql
SELECT dc.id AS chunkId, dc.doc_id AS docId, d.kb_id AS kbId,
       dc.content, d.title, ...
FROM b_document_chunks dc
INNER JOIN b_documents d ON d.id = dc.doc_id
WHERE d.kb_id = ? AND (dc.content LIKE ? OR dc.content LIKE ? ...)
```

---

### 4.5 FusionService (`retrieval/fusion.service.ts`)

**用途**：实现互惠排名融合（Reciprocal Rank Fusion, RRF）合并密集和稀疏结果

**RRF 公式**：
```
score(chunk) = Σ 1 / (k + rank_i)
```
- `k` = 平滑因子（默认: 60）
- `rank_i` = 检索结果 i 中的排名位置（从 1 开始）

**特性**：
- 从密集和稀疏命中合并载荷
- 保留来自任一来源的元数据（title, docId, kbId）
- 按融合分数降序返回结果

---

### 4.6 RerankService (`retrieval/rerank.service.ts`)

**用途**：基于阈值的过滤和重新评分

**过滤规则**：
- `rerankScore >= 0.7` → 主要证据（保留）
- `0.5 <= rerankScore < 0.7` → 次要证据（最多保留 2 条）
- `rerankScore < 0.5` → 丢弃

**评分公式**：
```
rerankScore = fusionScore_normalized * 0.7 + textOverlapRatio * 0.3
```

> **注意**：这是轻量级第一版。未来版本可能集成 Cross-Encoder 模型（Cohere, BGE-Reranker）。

---

### 4.7 CitationService (`retrieval/citation.service.ts`)

**用途**：将检索结果持久化为消息引用，并提供引用查询

**核心方法**：
```typescript
// 为消息创建引用记录
async createCitations(params: CreateCitationsParams): Promise<CitationRecord[]>

// 获取消息的引用
async getCitationsByMessage(messageId: bigint): Promise<CitationRecord[]>
```

**引用记录结构**：
```typescript
interface CitationRecord {
  citationId: string;
  kbId: string;
  kbName?: string;
  docId: string;
  docTitle?: string;
  chunkId: string;
  quote: string;        // 分块内容前 200 字符
  score: number;
}
```

**数据库表**：`b_chat_message_citations`

---

### 4.8 RetrievalTraceService (`retrieval/retrieval-trace.service.ts`)

**用途**：内存中的追踪记录，用于调试和性能监控

**特性**：
- 内存存储（可扩展到持久化到 `b_agent_steps` 表）
- 记录逐步检索执行和计时

---

## 5. 数据结构定义

### 5.1 DenseHit
```typescript
interface DenseHit {
  pointId: string;
  kbId: string;
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  payload: Record<string, unknown>;
}
```

### 5.2 SparseHit
```typescript
interface SparseHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  score: number;
  title?: string;
  titlePath?: string;
  keywordText?: string;
}
```

### 5.3 FusedHit
```typescript
interface FusedHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  fusionScore: number;
  denseScore?: number;
  sparseScore?: number;
  denseRank?: number;
  sparseRank?: number;
  payload: Record<string, unknown>;
}
```

### 5.4 RerankedHit
```typescript
interface RerankedHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  fusionScore: number;
  rerankScore: number;
  payload: Record<string, unknown>;
}
```

---

## 6. 环境变量配置

### 6.1 嵌入模型配置
| 变量 | 必填 | 默认值 |
|------|------|--------|
| `BAILIAN_API_KEY` | 是 | - |
| `BAILIAN_TEXT_EMBEDDING_MODEL` | 是 | - |
| `BAILIAN_VISION_EMBEDDING_MODEL` | 否 | - |
| `BAILIAN_EMBEDDING_DIMENSIONS` | 否 | - |
| `BAILIAN_EMBED_BATCH_SIZE` | 否 | 10 |
| `BAILIAN_EMBED_RETRY_COUNT` | 否 | 3 |
| `BAILIAN_EMBED_REQUEST_INTERVAL_MS` | 否 | 1000 |
| `BAILIAN_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

### 6.2 聊天模型配置
| 变量 | 必填 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | 是 | - |
| `OPENAI_BASE_URL` | 否 | - |
| `LLM_MODEL` | 否 | `gpt-4o-mini` |

### 6.3 Qdrant 配置
| 变量 | 必填 |
|------|------|
| `QDRANT_URL` | 是 |
| `QDRANT_SERVICE_API_KEY` | 否 |

---

## 7. 与其他模块的集成

### 7.1 与 Chat 模块集成

Chat 模块导入 `RagModule` 并使用：
- `RetrievalService`（通过 `SearchKnowledgeBaseTool`）
- `CitationService`（构建消息引用）
- `ChatModelService`（LLM 调用）

**SearchKnowledgeBaseTool** (`apps/server/src/modules/chat/services/tools/search-knowledge-base.tool.ts`)：
```typescript
export interface SearchKnowledgeBaseParams {
  queries: string[];
  kbIds: string[];
  topK?: number;
}

async execute(params: SearchKnowledgeBaseParams): Promise<{
  hits: RerankedHit[];
  hitCount: number;
  durationMs: number;
}>
```

### 7.2 与 Document 模块集成

Document 模块导入 `RagModule` 以使用 `EmbeddingService` 进行文档向量化。

**DocumentProcessingService** 流程：
1. 解析文档
2. 创建分块
3. 通过 `EmbeddingService` 嵌入分块
4. 通过 `QdrantService` 将向量 upsert 到 Qdrant

### 7.3 QdrantModule（基础设施）

**QdrantService** 提供：
- `ensureCollection(vectorSize)` - 不存在则创建 collection
- `upsertChunkVectors(points)` - 批量 upsert 向量
- `deleteByDocument(documentId)` - 按文档 filter 删除
- `deleteByDocumentVersion(documentId, processingVersion)` - 删除特定版本
- `searchChunkVectors(params)` - 带 kbId 过滤的相似度搜索

**Collection 名称**：`kb_document_chunks`

---

## 8. 数据库模型

### 8.1 b_document_chunks
```prisma
model b_document_chunks {
  id            BigInt  @id @default(autoincrement())
  doc_id        BigInt
  chunk_index   Int
  content       String  @db.LongText
  token_count   Int?    @default(0)
  page_no       Int?
  char_start    Int?
  char_end      Int?
  vector_id     String? @db.VarChar(100)
  metadata_json Json?
  embedding_status String @default("pending") @db.VarChar(20)
  created_at    DateTime @default(now())

  message_citations b_chat_message_citations[]
  b_documents       b_documents @relation(...)
}
```

### 8.2 b_documents
```prisma
model b_documents {
  id                 BigInt @id @default(autoincrement())
  kb_id              BigInt
  uploader_id        BigInt?
  title              String @db.VarChar(255)
  file_path          String @db.VarChar(500)
  file_type          String? @db.VarChar(20)
  status             String @default("pending") @db.VarChar(50)
  processing_version Int @default(1)
  current_stage      String @default("uploaded") @db.VarChar(50)
  // ... more fields

  document_chunks b_document_chunks[]
}
```

### 8.3 b_knowledge_bases
```prisma
model b_knowledge_bases {
  id          BigInt @id @default(autoincrement())
  name        String @db.VarChar(100)
  description String? @db.Text
  visibility  String @default("private") @db.VarChar(50)
  owner_id    BigInt
  // ...

  documents         b_documents[]
  message_citations b_chat_message_citations[]
}
```

### 8.4 b_chat_message_citations
```prisma
model b_chat_message_citations {
  id         BigInt @id @default(autoincrement())
  message_id BigInt
  kb_id      BigInt
  doc_id     BigInt
  chunk_id   BigInt
  score      Float?
  quote      String? @db.Text
  order_no   Int @default(0)
  created_at DateTime @default(now())

  b_chat_messages   b_chat_messages @relation(...)
  b_knowledge_bases b_knowledge_bases @relation(...)
  b_documents       b_documents @relation(...)
  b_document_chunks b_document_chunks @relation(...)
}
```

---

## 9. 服务职责一览

| 服务 | 文件 | 职责 |
|------|------|------|
| `EmbeddingService` | `ai/embedding.service.ts` | 通过 Bailian API 文档向量化 |
| `ChatModelService` | `ai/chat-model.service.ts` | 聊天模型实例工厂 |
| `DenseRetrievalService` | `retrieval/dense-retrieval.service.ts` | Qdrant 向量搜索 |
| `SparseRetrievalService` | `retrieval/sparse-retrieval.service.ts` | 基于关键词的数据库搜索 |
| `FusionService` | `retrieval/fusion.service.ts` | 密集 + 稀疏的 RRF 融合 |
| `RerankService` | `retrieval/rerank.service.ts` | 阈值过滤 + 重新评分 |
| `RetrievalService` | `retrieval/retrieval.service.ts` | 完整检索流水线编排 |
| `CitationService` | `retrieval/citation.service.ts` | 引用持久化和查询 |
| `RetrievalTraceService` | `retrieval/retrieval-trace.service.ts` | 用于调试的追踪记录 |
| `QdrantService` | `common/vector/qdrant.service.ts` | 向量数据库操作 |

---

## 10. 完整检索时序图

```
Client
  │
  ▼
ChatStreamService.streamRagMode()
  │
  ▼
MultiAgentOrchestratorService.streamRun()
  │
  ├── AgentTraceService.createRun()
  │
  ▼
  ├─ RouteQueryNode (Router Agent)
  │   └── ChatModelService.createModel().withStructuredOutput()
  │
  ├─ [shouldRewrite] ─► RewriteQueryNode (Rewriter Agent)
  │                      └── ChatModelService.createModel().withStructuredOutput()
  │
  ├─ [shouldDecompose] ─► DecomposeNode (Decomposer Agent)
  │                      └── ChatModelService.createModel().withStructuredOutput()
  │
  ▼
  └─ SearchKnowledgeBaseTool.execute()
        │
        ▼
        RetrievalService.retrieve()
          │
          ├── DenseRetrievalService.retrieveDense()
          │   ├── EmbeddingService.embedDocuments(queries)
          │   └── QdrantService.searchChunkVectors()
          │
          ├── SparseRetrievalService.retrieveSparse()
          │   └── Prisma raw SQL (LIKE queries)
          │
          ├── FusionService.fuse()
          │   └── RRF formula: score = Σ 1/(k + rank)
          │
          └── RerankService.rerank()
              └── Threshold filtering + textOverlap scoring
        │
        ▼
        RelevanceCheckNode (Verifier Agent)
        │
        ├── [shouldRetryOrContinue] ─► RewriteQuery (loop)
        │
        ▼
        FactCheckNode + CompletenessCheckNode (并行)
        │
        ▼
        Writer Agent (流式)
        │
        ▼
  ─► SSE Response
        │
        ├── CitationService.createCitations()
        └── ChatMessageService.finalizeAssistantMessage()
```