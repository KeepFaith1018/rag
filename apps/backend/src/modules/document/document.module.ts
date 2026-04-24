import { Module } from '@nestjs/common';
import { FileStorageModule } from '@common/storage/file-storage.module';
import { KbPermissionModule } from '../knowledge-base/permission/kb-permission.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';

/**
 * 文档业务模块。
 */
@Module({
  imports: [KbPermissionModule, FileStorageModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
