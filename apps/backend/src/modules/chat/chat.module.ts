import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { AgentModule } from '../agent/agent.module';
import { ChatController } from './chat.controller';
import { ChatKbController } from './chat-kb.controller';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { ChatStreamService } from './services/chat-stream.service';

@Module({
  imports: [AiModule, KnowledgeBaseModule, RetrievalModule, AgentModule],
  controllers: [ChatController, ChatKbController],
  providers: [ChatSessionService, ChatMessageService, ChatStreamService],
  exports: [ChatSessionService, ChatMessageService],
})
export class ChatModule {}
