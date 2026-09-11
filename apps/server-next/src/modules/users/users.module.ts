import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { RuntimeConfigModule } from '../../platform/config/runtime-config.module';
import { StorageModule } from '../../platform/object-storage/storage.module';
import { UsersController } from './users.controller';
import { AvatarService } from './services/avatar.service';
import { UserAccountsService } from './services/user-accounts.service';
import { UserProfilesService } from './services/user-profiles.service';

/** 组装用户账户、资料与头像服务，并向身份模块导出账户能力。 */
@Module({
  imports: [DatabaseModule, RuntimeConfigModule, StorageModule],
  controllers: [UsersController],
  providers: [UserAccountsService, UserProfilesService, AvatarService],
  exports: [UserAccountsService, UserProfilesService],
})
export class UsersModule {}
