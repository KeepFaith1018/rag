import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileStorageModule } from '@common/storage/file-storage.module';
import { QdrantModule } from '@common/vector/qdrant.module';
import { AiModule } from '../ai/ai.module';
import { DocumentQueueService } from './queue/document-queue.service';
import { DocumentProcessingProcessor } from './processor/document-processing.processor';
import { DocumentChunkService } from './services/document-chunk.service';
import { DocumentProcessingMonitorService } from './services/document-processing-monitor.service';
import { DocumentParserService } from './services/document-parser.service';
import { DocumentProcessingService } from './services/document-processing.service';
import { DocumentProcessingStateService } from './services/document-processing-state.service';
import { DocumentProcessingTaskService } from './services/document-processing-task.service';

/**
 * 文档异步处理模块。
 */
@Module({
  imports: [ConfigModule, FileStorageModule, AiModule, QdrantModule],
  providers: [
    DocumentQueueService,
    DocumentProcessingProcessor,
    DocumentParserService,
    DocumentChunkService,
    DocumentProcessingService,
    DocumentProcessingStateService,
    DocumentProcessingTaskService,
    DocumentProcessingMonitorService,
  ],
  exports: [
    DocumentQueueService,
    DocumentProcessingStateService,
    DocumentProcessingTaskService,
  ],
})
export class DocumentProcessingModule {}
