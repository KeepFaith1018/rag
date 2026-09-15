import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { RuntimeConfigModule } from '../../platform/config/runtime-config.module';
import { ProcessingQueueModule } from '../../platform/queue/queue.module';
import { ModelAccessModule } from '../model-access/model-access.module';
import { VectorModule } from '../../platform/vector/vector.module';
import { SearchModule } from '../../platform/search/search.module';
import { ProcessingCoordinatorService } from './application/processing-coordinator.service';
import { ChunkerService } from './pipeline/chunker.service';
import { MarkdownParserService } from './pipeline/markdown-parser.service';
import { EmbeddingService } from './pipeline/embedding.service';
import { PublishingService } from './application/publishing.service';
import { ProcessingStatusService } from './application/processing-status.service';
import { ProcessingEventsService } from './application/processing-events.service';

@Module({
  imports: [
    DatabaseModule,
    RuntimeConfigModule,
    ProcessingQueueModule,
    ModelAccessModule,
    VectorModule,
    SearchModule,
  ],
  providers: [
    ProcessingCoordinatorService,
    ChunkerService,
    MarkdownParserService,
    EmbeddingService,
    PublishingService,
    ProcessingStatusService,
    ProcessingEventsService,
  ],
  exports: [
    ProcessingCoordinatorService,
    ChunkerService,
    MarkdownParserService,
    EmbeddingService,
    PublishingService,
    ProcessingStatusService,
    ProcessingEventsService,
    VectorModule,
    SearchModule,
    ProcessingQueueModule,
  ],
})
export class IngestionModule {}
