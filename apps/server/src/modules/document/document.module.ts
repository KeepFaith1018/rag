import { Module } from '@nestjs/common';
import { FileStorageModule } from '@common/storage/file-storage.module';
import { QdrantModule } from '@common/vector/qdrant.module';
import { TokenService } from '@common/utils/token.service';
import { RagModule } from '../rag/rag.module';
import { KbPermissionModule } from '../knowledge-base/permission/kb-permission.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { DocumentProcessingProcessor } from './processor/document-processing.processor';
import { DocumentQueueService } from './queue/document-queue.service';
import { DocumentParserService } from './services/document-parser.service';
import { DocumentChunkService } from './services/document-chunk.service';
import { DocumentProcessingService } from './services/document-processing.service';
import { DocumentProcessingStateService } from './services/document-processing-state.service';
import { DocumentProcessingTaskService } from './services/document-processing-task.service';
import { DocumentProcessingMonitorService } from './services/document-processing-monitor.service';
import { CleanupService } from './services/cleanup.service';
import { DocumentSseService } from './services/document-sse.service';
import { DocumentSseController } from './document-sse.controller';

/**
 * 文档管理模块。
 *
 * 整合文档全生命周期能力：
 * - 文档元数据管理 (CRUD)
 * - 分片上传
 * - 异步处理流水线 (解析 → 分块 → 向量化)
 */
@Module({
  imports: [
    KbPermissionModule,
    FileStorageModule,
    QdrantModule,
    RagModule,
  ],
  controllers: [
    DocumentController,
    UploadController,
    DocumentSseController,
  ],
  providers: [
    DocumentService,
    UploadService,
    DocumentProcessingProcessor,
    DocumentQueueService,
    DocumentParserService,
    DocumentChunkService,
    DocumentProcessingService,
    DocumentProcessingStateService,
    DocumentProcessingTaskService,
    DocumentProcessingMonitorService,
    CleanupService,
    DocumentSseService,
    TokenService,
  ],
  exports: [
    DocumentService,
    UploadService,
    DocumentProcessingStateService,
    DocumentProcessingTaskService,
  ],
})
export class DocumentModule {}
