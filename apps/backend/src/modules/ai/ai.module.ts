import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

/**
 * AI 基础能力模块。
 */
@Module({
  imports: [ConfigModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class AiModule {}
