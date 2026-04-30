import { Module } from '@nestjs/common';
import { FileStorageModule } from '@common/storage/file-storage.module';
import { KbPermissionModule } from '../../knowledge-base/permission/kb-permission.module';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/**
 * 分片上传模块。
 */
@Module({
  imports: [KbPermissionModule, FileStorageModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
