import { Module } from '@nestjs/common';
import { FileStorageModule } from '@common/storage/file-storage.module';
import { QdrantModule } from '@common/vector/qdrant.module';
import { KbPermissionModule } from '../knowledge-base/permission/kb-permission.module';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';

/**
 * 文档业务模块。
 */
@Module({
  imports: [
    KbPermissionModule,
    FileStorageModule,
    QdrantModule,
    DocumentProcessingModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
