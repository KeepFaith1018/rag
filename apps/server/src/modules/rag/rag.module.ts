import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QdrantModule } from '@common/vector/qdrant.module';
import { ElasticsearchModule } from '@common/vector/elasticsearch.module';
import { AiModule } from './ai/ai.module';
import { DenseRetrievalService } from './retrieval/dense-retrieval.service';
import { ElasticsearchSparseRetrievalService } from './retrieval/elasticsearch-sparse-retrieval.service';
import { FusionService } from './retrieval/fusion.service';
import { RerankService } from './retrieval/rerank.service';
import { RerankModelService } from './retrieval/rerank-model.service';
import { RetrievalService } from './retrieval/retrieval.service';
import { CitationService } from './retrieval/citation.service';
import { RetrievalTraceService } from './retrieval/retrieval-trace.service';

/**
 * RAG 核心模块。
 *
 * 整合 AI 能力（Embedding/ChatModel）与检索流水线：
 * - Embedding 向量化
 * - 稠密检索 / 稀疏检索（ES）/ RRF 融合 / 精排（qwen3-rerank）
 * - 引用构建与检索轨迹
 */
@Module({
  imports: [ConfigModule, QdrantModule, ElasticsearchModule, AiModule],
  controllers: [],
  providers: [
    // 检索服务
    DenseRetrievalService,
    ElasticsearchSparseRetrievalService,
    FusionService,
    RerankService,
    RerankModelService,
    RetrievalService,
    CitationService,
    RetrievalTraceService,
  ],
  exports: [
    AiModule,
    RetrievalService,
    CitationService,
    RetrievalTraceService,
  ],
})
export class RagModule {}