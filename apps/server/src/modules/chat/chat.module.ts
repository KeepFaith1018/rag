import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ChatController } from './chat.controller';
import { AgentTraceController } from './services/agent-trace.controller';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { ChatStreamService } from './services/chat-stream.service';
import { AgentTraceService } from './services/agent-trace.service';
import { MultiAgentOrchestratorService } from './services/multi-agent-orchestrator.service';
import { SearchKnowledgeBaseTool } from './services/tools/search-knowledge-base.tool';
import { GetChunkDetailTool } from './services/tools/get-chunk-detail.tool';

/**
 * 对话模块。
 *
 * 整合 Agent 工作流，提供多阶段 Agentic RAG 编排能力：
 * Router → Rewrite → Decompose → Retrieve → Rerank →
 * Relevance Check → Draft → Fact Check → Completeness Check → Finalize
 */
@Module({
  imports: [RagModule, KnowledgeBaseModule],
  controllers: [ChatController, AgentTraceController],
  providers: [
    ChatSessionService,
    ChatMessageService,
    ChatStreamService,
    AgentTraceService,
    MultiAgentOrchestratorService,
    SearchKnowledgeBaseTool,
    GetChunkDetailTool,
  ],
  exports: [
    ChatSessionService,
    ChatMessageService,
    AgentTraceService,
    MultiAgentOrchestratorService,
    SearchKnowledgeBaseTool,
    GetChunkDetailTool,
  ],
})
export class ChatModule {}
