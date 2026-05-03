import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { ChatModelService } from './chat-model.service';
import { AiController } from './ai.controller';

/**
 * AI 基础能力模块。
 *
 * 提供 Embedding 向量化与对话模型实例创建等底层 AI 能力，
 * 供上层业务模块（chat、rag 等）按需注入使用。
 */
@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [EmbeddingService, ChatModelService],
  exports: [EmbeddingService, ChatModelService],
})
export class AiModule {}