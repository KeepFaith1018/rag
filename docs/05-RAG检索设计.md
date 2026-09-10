---
title: Linsor AI RAG 检索设计
type: technical-design
status: active
maintainer: rag-team
updated: 2026-07-28
source_of_truth: apps/server/src/modules/rag
---

# Linsor AI RAG 检索设计

## 目标

检索模块从用户可访问的多个知识库中返回高相关、可引用的文档片段，并在单一检索源不可用时提供可控降级。

## 在线检索链路

```text
查询与知识库范围
  ├─ DenseRetrievalService → Qdrant
  └─ ElasticsearchSparseRetrievalService → Elasticsearch
       ↓
  FusionService → RRF 与置信度融合
       ↓
  RerankService → qwen3-rerank
       ↓
  Small-to-Big 上下文扩展
       ↓
  CitationService → 引用数据
```

`RetrievalService` 是主编排入口。Dense 和 Sparse 返回统一命中结构，Fusion 去重并合并排名，Rerank 对候选片段重新评分。

## 稠密检索

- 文档 Level 3 子 Chunk 生成 Embedding 并写入 Qdrant。
- Payload 至少携带知识库、文档、Chunk、层级和处理版本标识。
- 检索必须按用户已授权的知识库集合过滤。
- Embedding 维度必须和 Collection 配置一致。

## 稀疏检索

- Elasticsearch 保存可全文检索的 Chunk 内容和必要元数据。
- 中文内容使用已配置的分析器和 BM25 评分。
- 文档完成或重解析时同步写入当前版本索引。
- Elasticsearch 不可用时允许退化为稠密检索，但必须记录告警。

## 融合与重排

- Fusion 使用 Reciprocal Rank Fusion 合并不同排序。
- 可根据结果分布使用置信度权重，避免单一路径异常支配结果。
- Rerank 使用专用模型对 query/document 对评分。
- 重排失败时保留融合排序作为降级结果。
- 最终只向 Writer 提供受 token 预算约束的上下文。

## Small-to-Big

检索命中细粒度子 Chunk 后，根据结构关系补充父级或相邻上下文，使回答获得完整语义。扩展结果必须去重，并保留原命中 Chunk 用于引用定位。

## 权限与隔离

- 检索入口只接收权限服务解析后的知识库 ID。
- 公共访问仅允许公开知识库。
- 引用返回前再次绑定知识库、文档和 Chunk。
- 不允许模型通过 Prompt 绕过资源权限。

## 故障降级

| 故障 | 降级 |
|---|---|
| Elasticsearch 不可用 | 使用 Qdrant 结果 |
| Qdrant 不可用 | 使用 Elasticsearch 结果 |
| Rerank 不可用 | 使用融合排序 |
| 两种检索都无结果 | 由 Agent 改写重试，仍无结果则说明信息不足 |
| 引用元数据缺失 | 不生成伪引用，记录告警 |

## 调优边界

候选数量、融合参数、Rerank Top N、相似度阈值和上下文预算必须通过评估数据调整，不在文档中固化实验性数值。当前默认值以环境变量和源码为准。
