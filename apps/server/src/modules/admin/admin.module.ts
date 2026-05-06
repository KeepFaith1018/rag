import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { ModelConfigModule } from './model-config/model-config.module';
import { UserModule } from './user/user.module';
import { AdminUserModule } from './admin-user/admin-user.module';

@Module({
  imports: [AdminAuthModule, ModelConfigModule, UserModule, AdminUserModule],
})
export class AdminModule {}
