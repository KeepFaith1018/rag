import { Injectable } from '@nestjs/common';
import { DenseRetrievalService } from './dense-retrieval.service';
import { SparseRetrievalService } from './sparse-retrieval.service';
import { FusionService } from './fusion.service';
import { RerankService } from './rerank.service';
import type { DenseHit } from '../retrieval-interfaces/dense-hit.interface';
import type { SparseHit } from '../retrieval-interfaces/sparse-hit.interface';
import type { FusedHit } from '../retrieval-interfaces/fused-hit.interface';
import type { RerankedHit } from '../retrieval-interfaces/reranked-hit.interface';

export interface RetrieveParams {
  queries: string[];
  kbIds: string[];
  denseTopK?: number;
  sparseTopK?: number;
  fusionTopK?: number;
  scoreThreshold?: number;
  questionType?: 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
}

export interface RetrieveResult {
  denseHits: DenseHit[];
  sparseHits: SparseHit[];
  fusedHits: FusedHit[];
  rerankedHits: RerankedHit[];
  totalDurationMs: number;
}

/**
 * 检索流水线编排服务。
 *
 * 串联稠密检索 → 稀疏检索 → RRF 融合 → 精排过滤的完整链路，
 * 对外暴露统一的 retrieve() 接口供 Agent/对话层使用。
 */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly denseService: DenseRetrievalService,
    private readonly sparseService: SparseRetrievalService,
    private readonly fusionService: FusionService,
    private readonly rerankService: RerankService,
  ) {}

  /**
   * 执行完整检索流水线。
   */
  async retrieve(params: RetrieveParams): Promise<RetrieveResult> {
    const {
      queries,
      kbIds,
      denseTopK = 20,
      sparseTopK = 20,
      fusionTopK = 50,
      scoreThreshold = 0.3,
      questionType = 'fact_lookup',
    } = params;

    const startedAt = Date.now();

    // 1. 稠密向量检索
    const denseHits = await this.denseService.retrieve({
      queries,
      kbIds,
      topK: denseTopK,
      scoreThreshold,
    });

    // 2. 稀疏关键词检索
    const sparseHits = await this.sparseService.retrieve({
      queries,
      kbIds,
      topK: sparseTopK,
    });

    // 3. RRF 融合
    const fusedHits = this.fusionService.fuse({
      denseHits,
      sparseHits,
      topK: fusionTopK,
    });

    // 4. Rerank 精排
    const rerankedHits = await this.rerankService.rerank({
      candidates: fusedHits,
      originalQuery: queries[0] ?? '',
      rewrittenQuery: queries.length > 1 ? queries[1] : undefined,
      questionType,
    });

    const totalDurationMs = Date.now() - startedAt;

    return {
      denseHits,
      sparseHits,
      fusedHits,
      rerankedHits,
      totalDurationMs,
    };
  }
}
