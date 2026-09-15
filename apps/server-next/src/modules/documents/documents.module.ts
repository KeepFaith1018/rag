import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { RuntimeConfigModule } from '../../platform/config/runtime-config.module';
import { StorageModule } from '../../platform/object-storage/storage.module';
import { ObservabilityModule } from '../../platform/observability/observability.module';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IdentityModule } from '../identity/identity.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './services/documents.service';
import { UploadsService } from './services/uploads.service';

@Module({
  imports: [
    DatabaseModule,
    RuntimeConfigModule,
    ObservabilityModule,
    StorageModule,
    KnowledgeBasesModule,
    IngestionModule,
    IdentityModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, UploadsService],
})
export class DocumentsModule {}
