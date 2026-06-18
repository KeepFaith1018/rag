import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { ModelConfigModule } from './model-config/model-config.module';
import { UserModule } from './user/user.module';
import { AdminUserModule } from './admin-user/admin-user.module';
import { PublicKbModule } from './public-kb/public-kb.module';
import { PublicKbDocumentModule } from './public-kb-document/public-kb-document.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { DictModule } from './dict/dict.module';

@Module({
  imports: [
    AdminAuthModule,
    ModelConfigModule,
    UserModule,
    AdminUserModule,
    PublicKbModule,
    PublicKbDocumentModule,
    AuditLogModule,
    DictModule,
  ],
})
export class AdminModule {}
