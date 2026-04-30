import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QdrantModule } from '@common/vector/qdrant.module';
import { EmbeddingService } from './embedding.service';
import { ChatModelService } from './chat-model.service';
import { DenseRetrievalService } from './retrieval-services/dense-retrieval.service';
import { SparseRetrievalService } from './retrieval-services/sparse-retrieval.service';
import { FusionService } from './retrieval-services/fusion.service';
import { RerankService } from './retrieval-services/rerank.service';
import { RetrievalService } from './retrieval-services/retrieval.service';
import { CitationService } from './retrieval-services/citation.service';
import { RetrievalTraceService } from './retrieval-services/retrieval-trace.service';
import { AiController } from './ai.controller';

/**
 * RAG 核心模块。
 *
 * 整合 AI 能力（Embedding/ChatModel）与检索流水线：
 * - Embedding 向量化
 * - 稠密检索 / 稀疏检索 / RRF 融合 / 精排
 * - 引用构建与检索轨迹
 */
@Module({
  imports: [ConfigModule, QdrantModule],
  controllers: [AiController],
  providers: [
    // AI 能力
    EmbeddingService,
    ChatModelService,
    // 检索服务
    DenseRetrievalService,
    SparseRetrievalService,
    FusionService,
    RerankService,
    RetrievalService,
    CitationService,
    RetrievalTraceService,
  ],
  exports: [
    EmbeddingService,
    ChatModelService,
    RetrievalService,
    CitationService,
    RetrievalTraceService,
  ],
})
export class RagModule {}
