import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { QuotaCleanupService } from './quota-cleanup.service';
import { EmailModule } from '../email/email.module';
import { FileStorageModule } from '@common/storage/file-storage.module';

@Module({
  imports: [EmailModule, FileStorageModule],
  controllers: [UserController],
  providers: [UserService, QuotaCleanupService],
  exports: [UserService],
})
export class UserModule {}
