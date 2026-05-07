import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
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
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
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

    // 2. 稀疏关键词检索（E8: ES 不可用时降级为空结果，不中断检索流水线）
    let sparseHits: SparseHit[] = [];
    try {
      sparseHits = await this.sparseService.retrieve({
        queries,
        kbIds,
        topK: sparseTopK,
      });
    } catch (error) {
      this.logger.warn('[Retrieval] ES 检索失败，降级为仅稠密检索', {
        error: error instanceof Error ? error.message : String(error),
        kbIdsCount: kbIds.length,
        queriesCount: queries.length,
      });
      sparseHits = [];
    }

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

    // 5. 三层粒度展开 — 将 Level 3 子 chunk 替换为 Level 1 根 chunk 完整上下文
    const expandedHits = await this.expandToRootChunks(rerankedHits);

    const totalDurationMs = Date.now() - startedAt;

    return {
      denseHits,
      sparseHits,
      fusedHits,
      rerankedHits: expandedHits,
      totalDurationMs,
    };
  }

  /**
   * 将精排后的 Level 3 child chunk 展开为 Level 1 root chunk 的完整内容。
   *
   * 通过 payload 中的 rootChunkId 一步定位到 Level 1 根 chunk，
   * 用其完整 content（~1200 tokens）替换 child 的短 content（~300 tokens），
   * 实现 Small-to-Big 检索策略。
   *
   * 存量数据无 rootChunkId 时，原样返回不展开。
   */
  private async expandToRootChunks(
    hits: RerankedHit[],
  ): Promise<RerankedHit[]> {
    const rootIds = [
      ...new Set(
        hits
          .map((h) => h.payload?.['rootChunkId'] as string | undefined)
          .filter(Boolean),
      ),
    ];
    if (rootIds.length === 0) return hits;

    const rootChunks = await this.prisma.b_document_chunks.findMany({
      where: { id: { in: rootIds.map((id) => BigInt(id!)) }, chunk_level: 1 },
      select: { id: true, content: true },
    });
    const contentMap = new Map(
      rootChunks.map((c) => [c.id.toString(), c.content]),
    );

    return hits.map((hit) => {
      const rootId = hit.payload?.['rootChunkId'] as string | undefined;
      if (rootId && contentMap.has(rootId)) {
        return { ...hit, content: contentMap.get(rootId)! };
      }
      return hit;
    });
  }
}