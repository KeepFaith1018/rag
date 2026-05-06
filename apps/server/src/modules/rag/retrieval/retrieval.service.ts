import { Injectable } from '@nestjs/common';
import { DenseRetrievalService } from './dense-retrieval.service';
import { ElasticsearchSparseRetrievalService } from './elasticsearch-sparse-retrieval.service';
import { FusionService } from './fusion.service';
import { RerankService } from './rerank.service';
import type { DenseHit } from './interfaces/dense-hit.interface';
import type { SparseHit } from './interfaces/sparse-hit.interface';
import type { FusedHit } from './interfaces/fused-hit.interface';
import type { RerankedHit } from './interfaces/reranked-hit.interface';

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
 * 串联稠密检索 → 稀疏检索（ES）→ RRF 融合 → 精排过滤的完整链路，
 * 对外暴露统一的 retrieve() 接口供 Agent/对话层使用。
 */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly denseService: DenseRetrievalService,
    private readonly sparseService: ElasticsearchSparseRetrievalService,
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
      denseTopK: rawDenseTopK,
      sparseTopK: rawSparseTopK,
      fusionTopK: rawFusionTopK,
      scoreThreshold: rawScoreThreshold,
      questionType = 'fact_lookup',
    } = params;

    // 按问题类型动态调整检索参数：对比/研究类降低过滤门槛、扩大候选池
    const denseTopK = rawDenseTopK ?? (questionType === 'fact_lookup' ? 20 : 30);
    const sparseTopK = rawSparseTopK ?? (questionType === 'fact_lookup' ? 20 : 30);
    const fusionTopK = rawFusionTopK ?? (questionType === 'fact_lookup' ? 50 : 80);
    const scoreThreshold = rawScoreThreshold ?? (questionType === 'fact_lookup' ? 0.3 : 0.15);

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

    // 4. Rerank 精排 — 传入全部查询，非事实类用多查询评分取 max
    const rerankedHits = await this.rerankService.rerank({
      candidates: fusedHits,
      queries,
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