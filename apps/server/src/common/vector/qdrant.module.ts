import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QdrantService } from './qdrant.service';

/**
 * Qdrant 基础设施模块。
 */
@Module({
  imports: [ConfigModule],
  providers: [QdrantService],
  exports: [QdrantService],
})
export class QdrantModule {}
