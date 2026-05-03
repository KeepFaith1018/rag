# Elasticsearch 混合检索设计

## 1. 背景与目标

### 1.1 当前稀疏检索问题

现有 `SparseRetrievalService` 使用 PostgreSQL LIKE 匹配实现关键词检索，存在以下缺陷：

| 问题 | 影响 |
|------|------|
| 无法做 TF/IDF 语义权重排序 | 检索结果质量低 |
| 不支持短语匹配（phrase search） | 无法精确匹配词组 |
| 分词粗糙（简单空格/标点切分） | 中文检索效果差 |
| 大数据量下性能差 | 响应延迟高 |

### 1.2 目标

引入 Elasticsearch（ES）作为专业的全文检索引擎，替换 PostgreSQL LIKE 方案，提升稀疏检索质量。

---

## 2. 方案设计

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────┐
│              RetrievalService.retrieve()                 │
│                  检索流水线编排器                        │
└────────┬───────────────────────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────────────┐
│ Dense  │ │ Elasticsearch     │  ← 替换原有 PostgreSQL LIKE
│(Qdrant)│ │Sparse Retrieval   │
└───┬────┘ └────────┬─────────┘
    │               │
    ▼               ▼
┌─────────────────────────┐
│     FusionService       │
│      (RRF 融合)        │
└───────────┬─────────────┘
            │
            ▼
      ┌───────────┐
      │ Rerank    │
      │  Service  │
      └───────────┘
```

### 2.2 新增组件

| 文件 | 职责 |
|------|------|
| `apps/server/src/common/vector/elasticsearch.service.ts` | ES 底层封装（索引管理、bulk 写入、search、删除） |
| `apps/server/src/common/vector/elasticsearch.module.ts` | ES 模块定义 |
| `apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts` | ES 稀疏检索实现（接口兼容原 SparseRetrievalService） |

### 2.3 修改组件

| 文件 | 变更 |
|------|------|
| `apps/server/src/modules/rag/retrieval/retrieval.service.ts` | 注入替换为 `ElasticsearchSparseRetrievalService` |
| `apps/server/src/modules/document/services/document-processing.service.ts` | chunk 写入时同步 bulk 写入 ES |
| `apps/server/src/common/config/env.validation.ts` | 添加 ES 配置校验 |
| `apps/server/.env.example` | 添加 ES 配置项 |

---

## 3. Elasticsearch 索引设计

### 3.1 索引命名

```
索引名：kb_document_chunks_es
```

独立于 Qdrant collection 命名（`kb_document_chunks`），便于独立管理。

### 3.2 索引配置（Settings）

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "analyzer": {
        "chunk_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase"]
        }
      }
    }
  }
}
```

**说明**：
- `ik_max_word`：中文分词器，需 ES 容器安装 IK 插件（`elasticsearch-plugin install analysis-ik`）
- `lowercase`：英文统一转小写

### 3.3 字段映射（Mappings）

```json
{
  "mappings": {
    "properties": {
      "chunkId": {
        "type": "keyword"
      },
      "docId": {
        "type": "keyword"
      },
      "kbId": {
        "type": "keyword"
      },
      "content": {
        "type": "text",
        "analyzer": "chunk_analyzer"
      },
      "title": {
        "type": "text",
        "analyzer": "chunk_analyzer"
      },
      "metadata": {
        "type": "object",
        "enabled": false
      }
    }
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `chunkId` | keyword | 分块唯一标识（对应 `b_document_chunks.id`） |
| `docId` | keyword | 文档 ID（对应 `b_documents.id`） |
| `kbId` | keyword | 知识库 ID（对应 `b_knowledge_bases.id`） |
| `content` | text | 分块正文，使用 IK 分词 |
| `title` | text | 文档标题，使用 IK 分词 |
| `metadata` | object | 其他元数据（禁用，存储原始 JSON） |

---

## 4. 服务设计

### 4.1 ElasticsearchService

路径：`apps/server/src/common/vector/elasticsearch.service.ts`

**核心方法**：

```typescript
@Injectable()
export class ElasticsearchService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * 确保索引存在（若不存在则创建）
   */
  async ensureIndex(): Promise<void>

  /**
   * 批量写入文档分块
   */
  async bulkIndexChunks(chunks: ChunkDocument[]): Promise<BulkIndexResult>

  /**
   * 搜索文档
   * @param query 用户查询文本
   * @param kbIds 知识库 ID 列表
   * @param topK 返回数量
   * @returns 检索结果列表
   */
  async search(query: string, kbIds: string[], topK: number): Promise<EsSearchHit[]>

  /**
   * 删除知识库关联的所有文档
   */
  async deleteByKbId(kbId: string): Promise<void>
}

interface ChunkDocument {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

interface EsSearchHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  score: number;
}
```

### 4.2 检索策略

```json
{
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "content": {
              "query": "用户查询文本",
              "boost": 1.0
            }
          }
        },
        {
          "match_phrase": {
            "content": {
              "query": "用户查询文本",
              "boost": 2.0
            }
          }
        }
      ],
      "filter": [
        { "terms": { "kbId": ["kbId1", "kbId2"] } }
      ]
    }
  },
  "size": 20,
  "_source": ["chunkId", "docId", "kbId", "content", "title"]
}
```

**策略说明**：
- `match`：普通分词匹配
- `match_phrase`：短语精确匹配，boost 2.0 提升精确度
- `filter`：按 `kbId` 过滤（不走评分，性能更好）

### 4.3 ElasticsearchSparseRetrievalService

路径：`apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts`

实现与原 `SparseRetrievalService` 完全一致的接口：

```typescript
export interface SparseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
}

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

**实现要点**：
- 多查询场景：取各查询结果的并集，按 score 去重合并
- 返回类型兼容原接口，便于流水线透明切换

---

## 5. 文档处理流水线修改

### 5.1 当前流程

```
文档解析 → 分块 → Embedding → Qdrant 写入
```

### 5.2 修改后流程

```
文档解析 → 分块 → Embedding → Qdrant 写入
                              ↓
                        ES bulk 写入
```

**变更点**：在 `document-processing.service.ts` 的 chunk 写入 Qdrant 同一位置，添加 ES bulk 写入调用。

---

## 6. 错误处理与降级策略

### 6.1 ES 不可用时的策略

**方案：不回退，直接抛异常**

ES 作为检索基础设施，若不可用则整个检索流程失败。这有助于：
1. 问题及时暴露（不静默降级）
2. 避免回退到低质量方案造成的困惑
3. 简化运维（ES 故障需修复，而非绕过）

### 6.2 错误类型

| 错误类型 | 处理 |
|---------|------|
| ES 连接失败 | 抛出 `ELASTICSEARCH_UNAVAILABLE` |
| 索引创建失败 | 抛出 `ELASTICSEARCH_INDEX_CREATE_FAILED` |
| 写入失败 | 抛出 `ELASTICSEARCH_BULK_WRITE_FAILED` |
| 检索失败 | 抛出 `ELASTICSEARCH_SEARCH_FAILED` |

---

## 7. 配置项

### 7.1 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ELASTICSEARCH_NODE` | 是 | - | ES 节点地址，如 `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | 否 | `kb_document_chunks_es` | 索引名 |
| `ELASTICSEARCH_USERNAME` | 否 | - | 用户名（可选） |
| `ELASTICSEARCH_PASSWORD` | 否 | - | 密码（可选） |

### 7.2 配置文件示例

```bash
# .env.example
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_INDEX=kb_document_chunks_es
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=
```

---

## 8. 依赖

```bash
pnpm --filter server add @elastic/elasticsearch
```

**版本**：`^8.x`（与 ES 8.x 兼容）

---

## 9. 验证方案

### 9.1 编译验证

```bash
pnpm --filter server build
```

### 9.2 功能验证

1. **ES 写入验证**
   - 上传任意文档
   - 检查 ES 索引 `kb_document_chunks_es` 中是否有数据

2. **检索验证**
   ```bash
   curl -X GET "http://localhost:9200/kb_document_chunks_es/_search" \
     -H 'Content-Type: application/json' \
     -d '{"query": {"match": {"content": "测试"}}, "size": 5}'
   ```

3. **端到端验证**
   - 通过对话界面发起知识库问答
   - 确认 `sparseHits` 有 ES 返回结果（非空）

### 9.3 ES 不可用验证

1. 停止 ES 服务
2. 发起知识库问答请求
3. 确认返回错误（非静默降级）

---

## 10. 数据迁移

### 10.1 旧数据处理

现有 `b_document_chunks` 表中的数据**无需迁移**：
- ES 和 Qdrant 共存，ES 仅作为新增数据的检索源
- 查询时 ES 和 Qdrant 结果通过 RRF 融合
- 旧文档检索时 sparseHits 为空，但 denseHits 仍有效

### 10.2 后续迁移（可选）

如需迁移历史数据，可通过脚本批量读取 `b_document_chunks` 并 bulk 写入 ES。

---

## 11. 运维注意事项

### 11.1 IK 插件安装

ES 容器需安装 IK 分词插件：

```bash
# 方式一：容器启动时安装
docker run -e "ES_PLUGIN_INSTALL=analysis-ik" ...

# 方式二：容器内手动安装
docker exec <container> bin/elasticsearch-plugin install analysis-ik
```

### 11.2 监控

建议监控以下 ES 指标：
- 集群健康状态
- 索引文档数量
- 搜索延迟 P99
- bulk 写入成功率

---

## 12. 重排模型集成（qwen3-rerank）

### 12.1 背景

当前 `RerankService` 使用轻量级阈值过滤 + 文本重叠计分：

```typescript
// 当前实现
rerankScore = fusionScore * 0.7 + overlapRatio * 0.3;
```

这种方法无法理解语义，仅依赖词汇匹配。引入 qwen3-rerank 交叉编码器模型进行深度语义精排。

### 12.2 qwen3-rerank API

百炼平台提供的重排模型，输入 query 和文档列表，输出每个文档的相关性分数。

**API 端点**：
```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/rerank
```

**请求格式**：
```json
{
  "model": "qwen3-rerank",
  "query": "用户查询文本",
  "documents": ["文档1内容", "文档2内容", ...],
  "top_n": 10,
  "return_documents": false
}
```

**响应格式**：
```json
{
  "results": [
    { "index": 0, "relevance_score": 0.95 },
    { "index": 2, "relevance_score": 0.88 },
    ...
  ]
}
```

### 12.3 新增服务

#### RerankModelService

路径：`apps/server/src/modules/rag/retrieval/rerank-model.service.ts`

```typescript
interface RerankResult {
  scores: number[];  // 与输入文档一一对应
}

@Injectable()
export class RerankModelService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * 调用 qwen3-rerank API 获取相关性分数
   */
  async rerank(params: {
    query: string;
    documents: string[];
    topN?: number;
  }): Promise<RerankResult> {
    // HTTP 调用百炼 rerank API
  }

  private getConfig(): { apiKey: string; model: string; baseUrl: string } {
    return {
      apiKey: this.configService.get<string>('BAILIAN_API_KEY'),
      model: this.configService.get<string>('BAILIAN_RERANK_MODEL') || 'qwen3-rerank',
      baseUrl: this.configService.get<string>('BAILIAN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    };
  }
}
```

### 12.4 RerankService 修改

```typescript
@Injectable()
export class RerankService {
  constructor(
    private readonly rerankModelService: RerankModelService,
  ) {}

  async rerank(params: RerankParams): Promise<RerankedHit[]> {
    if (!params.candidates.length) return [];

    // 调用 qwen3-rerank 获取语义相关性分数
    const { scores } = await this.rerankModelService.rerank({
      query: params.originalQuery,
      documents: params.candidates.map(c => c.content),
      topN: params.topN ?? 10,
    });

    // 将 rerank 分数与 RRF 分数融合
    const maxFusionScore = params.candidates[0]?.fusionScore ?? 1;
    const results = params.candidates
      .map((c, i) => ({
        hit: c,
        rerankScore: scores[i] ?? 0,
        fusionScore: c.fusionScore / maxFusionScore,
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, params.topN ?? 10);

    return results.map(r => ({
      chunkId: r.hit.chunkId,
      docId: r.hit.docId,
      kbId: r.hit.kbId,
      content: r.hit.content,
      title: r.hit.title,
      fusionScore: r.fusionScore,
      rerankScore: r.rerankScore,
      payload: r.hit.payload,
    }));
  }
}
```

### 12.5 配置项

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `BAILIAN_RERANK_MODEL` | 否 | `qwen3-rerank` | 重排模型名称 |
| `BAILIAN_RERANK_TOP_N` | 否 | `10` | 返回的 top N 结果 |

### 12.6 错误处理

| 错误类型 | 处理 |
|---------|------|
| API 调用超时 | 抛出 `RERANK_MODEL_TIMEOUT`，回退到轻量级过滤 |
| API 返回格式错误 | 抛出 `RERANK_MODEL_INVALID_RESPONSE`，回退到轻量级过滤 |
| API 认证失败 | 抛出 `RERANK_MODEL_AUTH_FAILED`，不回退 |

**说明**：由于 rerank 模型调用可能不稳定，设计了回退到轻量级过滤的降级方案，保证流程不中断。

---

## 13. 后续优化方向

1. **Query Expansion**：利用 LLM 生成多个检索 query
2. **混合检索权重学习**：根据用户反馈动态调整 dense/sparse/rrf 权重
3. **多路召回融合优化**：尝试多种 RRF k 值或 learned fusion