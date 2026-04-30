import { Injectable } from '@nestjs/common';
import { RetrievalService } from '../../rag/retrieval-services/retrieval.service';
import type { RerankedHit } from '../../rag/retrieval-interfaces/reranked-hit.interface';

export interface SearchKnowledgeBaseParams {
  queries: string[];
  kbIds: string[];
  topK?: number;
}

/**
 * 知识库检索工具。
 *
 * 封装 RetrievalService 为 Agent 可调用的工具，
 * 执行完整的稠密+稀疏混合检索流水线。
 */
@Injectable()
export class SearchKnowledgeBaseTool {
  constructor(private readonly retrievalService: RetrievalService) {}

  async execute(params: SearchKnowledgeBaseParams): Promise<{
    hits: RerankedHit[];
    hitCount: number;
    durationMs: number;
  }> {
    const result = await this.retrievalService.retrieve({
      queries: params.queries,
      kbIds: params.kbIds,
      denseTopK: params.topK ?? 20,
      sparseTopK: params.topK ?? 20,
    });

    return {
      hits: result.rerankedHits,
      hitCount: result.rerankedHits.length,
      durationMs: result.totalDurationMs,
    };
  }
}
