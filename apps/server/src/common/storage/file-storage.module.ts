import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';

/**
 * 文件存储基础模块。
 */
@Module({
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
