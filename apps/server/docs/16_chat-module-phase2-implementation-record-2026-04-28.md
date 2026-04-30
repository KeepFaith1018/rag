# Chat 模块阶段二实施记录

## 概述

按照《[12-agentic-rag-detailed-design-2026-04-27.md](../../../docs/12-agentic-rag-detailed-design-2026-04-27.md)》中阶段二的规划，完成检索链路四大服务的落地，并将检索流水线集成到 Chat 模块的流式对话中。

## 完成清单

### 1. DenseRetrievalService

**职责**：将查询文本向量化后调用 Qdrant 进行相似度检索，支持多条改写/分解查询的批量检索与 chunkId 级自动去重。

**关键设计**：
- 注入 `EmbeddingService` 做查询向量化，注入 `QdrantService` 做向量检索
- 支持多条查询并行检索（`Promise.all`），按 chunkId 去重保留最高分
- 支持多知识库 filter 与 scoreThreshold 阈值过滤

涉及文件：
- `src/modules/retrieval/services/dense-retrieval.service.ts` — 新建

### 2. SparseRetrievalService

**职责**：基于关键词的稀疏检索，采用"应用层轻量倒排索引"策略。

**关键设计**：
- 查询文本分词：按中英文标点/空格切分，过滤中英文停用词、单字词、单字母词，限制最多 10 个关键词
- 通过 Prisma raw query（`$queryRawUnsafe`）执行跨表 LIKE 检索：`b_document_chunks INNER JOIN b_documents` 限定 kb_id 范围
- 计分公式：`关键词命中率 × 0.7 + 短文本归一化因子 × 0.3`
- 支持多知识库并行检索 + chunkId 去重

涉及文件：
- `src/modules/retrieval/services/sparse-retrieval.service.ts` — 新建

### 3. FusionService

**职责**：采用 Reciprocal Rank Fusion (RRF) 算法融合 Dense 和 Sparse 两路检索结果。

**关键设计**：
- RRF 公式：`score(chunk) = Σ 1 / (k + rank_i)`，k=60（平滑因子）
- 同 chunk 的多路命中自动合并，保留各路原始分数与排名
- 按 fusionScore 降序排列，截取 Top-K

涉及文件：
- `src/modules/retrieval/services/fusion.service.ts` — 新建

### 4. RerankService

**职责**：对融合后的候选列表执行精排过滤。

**关键设计**：
- 首版采用基于分数的轻量过滤策略（后续可替换为 Cross-Encoder Reranker）
- RRF 分数归一化后，叠加 query-chunk 文本词汇重叠率（30%）生成 rerankScore
- 三级过滤：≥0.7 主证据 / 0.5~0.7 候补证据（最多 2 条）/ <0.5 丢弃

涉及文件：
- `src/modules/retrieval/services/rerank.service.ts` — 新建

### 5. RetrievalService（编排层）

**职责**：串联稠密检索 → 稀疏检索 → RRF 融合 → 精排的完整流水线。

**流程**：
1. `DenseRetrievalService.retrieve()` — 稠密向量检索
2. `SparseRetrievalService.retrieve()` — 稀疏关键词检索
3. `FusionService.fuse()` — RRF 融合（Top-50）
4. `RerankService.rerank()` — 精排过滤

对外暴露统一 `retrieve(params)` 接口，返回四阶段全部中间结果 + 总耗时。

涉及文件：
- `src/modules/retrieval/services/retrieval.service.ts` — 新建

### 6. CitationService

**职责**：将精排后的检索命中结果持久化为消息引用记录，并产出前端可消费的引用快照。

**关键设计**：
- `createCitations()` — 批量写入 `b_chat_message_citations` 表，同时查知识库名和文档标题用于前端展示
- `getCitationsByMessage()` — 按消息 ID 查询引用列表
- quote 字段截取 chunk 内容前 200 字符作为摘要

涉及文件：
- `src/modules/retrieval/services/citation.service.ts` — 新建

### 7. RetrievalTraceService

**职责**：提供内存级轻量检索轨迹记录，用于排障回放与性能观测。

**关键设计**：
- 支持 `createTrace → addStep → finishTrace` 的完整生命周期
- 记录每一步的 input/output/durationMs/status
- 后续阶段可扩展为持久化到 `b_agent_steps` 表

涉及文件：
- `src/modules/retrieval/services/retrieval-trace.service.ts` — 新建

### 8. 接口与 DTO 定义

**接口层** (`src/modules/retrieval/interfaces/`)：

| 接口 | 说明 |
|------|------|
| `DenseHit` | 稠密向量检索命中（与 QdrantService 中的定义保持一致） |
| `SparseHit` | 稀疏关键词检索命中 |
| `FusedHit` | RRF 融合后的候选分片（含双路分数与排名） |
| `RerankedHit` | 精排后的最终结果 |

**DTO 层** (`src/modules/retrieval/dto/`)：
- `HybridRetrieveParams` — 检索入参
- `HybridRetrieveResult` — 检索出参

### 9. RetrievalModule

**模块结构**：

```
retrieval/
├── dto/
│   └── hybrid-retrieve.dto.ts
├── interfaces/
│   ├── dense-hit.interface.ts
│   ├── sparse-hit.interface.ts
│   ├── fused-hit.interface.ts
│   └── reranked-hit.interface.ts
├── services/
│   ├── dense-retrieval.service.ts
│   ├── sparse-retrieval.service.ts
│   ├── fusion.service.ts
│   ├── rerank.service.ts
│   ├── retrieval.service.ts
│   ├── citation.service.ts
│   └── retrieval-trace.service.ts
└── retrieval.module.ts
```

依赖：`QdrantModule`（向量检索）、`AiModule`（Embedding/向量化）

### 10. ChatStreamService 集成

**RAG 模式下完整检索链路已接入**：

1. `KbPermissionService.authorizeMany()` — 批量知识库 `ask` 权限鉴权
2. `RetrievalService.retrieve()` — 执行完整检索流水线
3. 检索上下文注入 LLM 系统提示词（含来源编号标注）
4. `CitationService.createCitations()` — 流式完成后持久化引用
5. `RetrievalTraceService` — 全程轨迹记录

**提示词模板**：
- 普通对话模式：基础系统提示词
- RAG 模式：`RAG_SYSTEM_PROMPT`，以 `{context}` 占位符注入检索结果，每条分片标注 `[来源 N]` + 文档标题 + 相关度百分比

### 11. 基础设施变更

**新增错误码**：

| 错误码 | 名称 | HTTP 状态 |
|--------|------|-----------|
| 45006 | `SPARSE_RETRIEVAL_FAILED` | 500 |
| 45007 | `FUSION_FAILED` | 500 |
| 45008 | `RERANK_FAILED` | 500 |
| 45009 | `CITATION_BUILD_FAILED` | 500 |

**新增 Prisma 模型**：`b_document_chunk_search_index` — 轻量检索索引表（预留，供后续 Sparse 检索升级到 FULLTEXT 或独立索引写入使用）

**模块注册**：
- `RetrievalModule` 已注册到 `AppModule`
- `ChatModule` 新增 `imports: [KnowledgeBaseModule, RetrievalModule]`

### 涉及文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/retrieval/` | 新建目录 | 检索模块全部 12 个文件 |
| `src/modules/chat/chat.module.ts` | 修改 | 新增 KnowledgeBaseModule + RetrievalModule 导入 |
| `src/modules/chat/services/chat-stream.service.ts` | 重写 | 集成 RAG 检索链路 + 引用持久化 |
| `src/common/utils/errorCodeMap.ts` | 修改 | 新增 4 个检索相关错误码 |
| `src/common/utils/errorCodeHttpMap.ts` | 修改 | 新增 HTTP 状态映射 |
| `src/common/utils/errorMessageMap.ts` | 修改 | 新增错误消息映射 |
| `prisma/schema.prisma` | 修改 | 新增 b_document_chunk_search_index 模型 |
| `src/app.module.ts` | 修改 | 注册 RetrievalModule |

## 验证结果

- TypeScript 编译通过（`pnpm --filter backend build`）
- Prisma Client 生成成功（含新模型 `b_document_chunk_search_index`）
- 检索流水线：Dense → Sparse → RRF → Rerank 四阶段链路完整
- Chat 模块：RAG 模式下自动执行权限校验 → 检索 → 上下文注入 → 引用持久化

## 关键设计决策

1. **Sparse 检索首版采用 LIKE 匹配**：避免引入额外的索引同步机制，通过分词 + OR-contains 策略实现轻量级关键词检索，后续可升级为 MySQL FULLTEXT 或独立倒排索引
2. **Rerank 首版采用启发式计分**：基于 RRF 归一化分数 + 文本词汇重叠率，避免首版依赖额外 Reranker 模型 API，后续可直接替换 `RerankService.rerank()` 内部实现接入 Cross-Encoder
3. **检索上下文直接注入 System Prompt**：简洁可靠，引用标注格式 `[来源 N]` 便于模型自动生成内联引用
4. **Citation 在 onFinish 回调中异步写入**：与消息内容持久化解耦，写入失败不影响对话主流程

## 后续阶段

参见《12-agentic-rag-detailed-design》的阶段三至阶段五：

- 阶段三：Agent 工作流（Router/Rewrite/Decomposition/Relevance/Fact/Completeness Check）
- 阶段四：前端联调
- 阶段五：治理与优化
