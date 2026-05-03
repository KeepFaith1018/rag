import { Injectable } from '@nestjs/common';
import { ElasticsearchService } from '@common/vector/elasticsearch.service';
import type { SparseHit } from './interfaces/sparse-hit.interface';

export interface SparseRetrieveParams {
  queries: string[];
  kbIds: string[];
  topK: number;
}

/**
 * 基于 Elasticsearch 的稀疏检索服务。
 *
 * 实现与原 SparseRetrievalService 完全一致的接口，
 * 替换 PostgreSQL LIKE 方案。
 */
@Injectable()
export class ElasticsearchSparseRetrievalService {
  constructor(private readonly esService: ElasticsearchService) {}

  /**
   * 对多条查询文本分别检索，
   * 汇总按 chunkId 去重后返回 Top-K 结果。
   */
  async retrieve(params: SparseRetrieveParams): Promise<SparseHit[]> {
    const { queries, kbIds, topK } = params;

    if (!queries.length || !kbIds.length) {
      return [];
    }

    // 并行执行多查询 ES 检索
    const resultGroups = await Promise.all(
      queries.map((query) =>
        this.esService.search(query, kbIds, topK),
      ),
    );

    // 按 chunkId 去重，保留最高分
    const seen = new Map<string, SparseHit>();
    for (const group of resultGroups) {
      for (const hit of group) {
        const existing = seen.get(hit.chunkId);
        if (!existing || hit.score > existing.score) {
          seen.set(hit.chunkId, {
            chunkId: hit.chunkId,
            docId: hit.docId,
            kbId: hit.kbId,
            content: hit.content,
            title: hit.title,
            score: hit.score,
            titlePath: undefined,
            keywordText: undefined,
          });
        }
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
