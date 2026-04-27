import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { AgentTraceController } from './agent-trace.controller';
import { MultiAgentOrchestratorService } from './services/multi-agent-orchestrator.service';
import { AgentTraceService } from './services/agent-trace.service';
import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';
import { GetChunkDetailTool } from './tools/get-chunk-detail.tool';

/**
 * Agent 工作流模块。
 *
 * 提供基于状态机的多阶段 Agentic RAG 编排能力：
 * Router → Rewrite → Decompose → Retrieve → Rerank →
 * Relevance Check → Draft → Fact Check → Completeness Check → Finalize
 */
@Module({
  imports: [AiModule, RetrievalModule],
  controllers: [AgentTraceController],
  providers: [
    MultiAgentOrchestratorService,
    AgentTraceService,
    SearchKnowledgeBaseTool,
    GetChunkDetailTool,
  ],
  exports: [
    MultiAgentOrchestratorService,
    AgentTraceService,
    SearchKnowledgeBaseTool,
    GetChunkDetailTool,
  ],
})
export class AgentModule {}
