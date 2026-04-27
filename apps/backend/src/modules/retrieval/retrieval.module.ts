import { Module } from '@nestjs/common';
import { QdrantModule } from '@common/vector/qdrant.module';
import { AiModule } from '../ai/ai.module';
import { DenseRetrievalService } from './services/dense-retrieval.service';
import { SparseRetrievalService } from './services/sparse-retrieval.service';
import { FusionService } from './services/fusion.service';
import { RerankService } from './services/rerank.service';
import { RetrievalService } from './services/retrieval.service';
import { CitationService } from './services/citation.service';
import { RetrievalTraceService } from './services/retrieval-trace.service';

/**
 * 检索流水线模块。
 *
 * 提供稠密检索、稀疏检索、RRF 融合、精排过滤与引用构建等
 * 完整检索链路能力，供上层 Agent/对话模块使用。
 */
@Module({
  imports: [QdrantModule, AiModule],
  providers: [
    DenseRetrievalService,
    SparseRetrievalService,
    FusionService,
    RerankService,
    RetrievalService,
    CitationService,
    RetrievalTraceService,
  ],
  exports: [RetrievalService, CitationService, RetrievalTraceService],
})
export class RetrievalModule {}
