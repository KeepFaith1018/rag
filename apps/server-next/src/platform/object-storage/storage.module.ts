import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { MinioStorageService } from './minio-storage.service';
import { STORAGE_ADAPTER } from './storage-adapter';

@Module({
  imports: [RuntimeConfigModule],
  providers: [
    MinioStorageService,
    { provide: STORAGE_ADAPTER, useExisting: MinioStorageService },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
