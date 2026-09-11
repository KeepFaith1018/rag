import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './platform/config/runtime-config.module';
import { HttpModule } from './platform/http/http.module';
import { MailModule } from './platform/mail/mail.module';
import { ObservabilityModule } from './platform/observability/observability.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { UsersModule } from './modules/users/users.module';
import { KnowledgeBasesModule } from './modules/knowledge-bases/knowledge-bases.module';
import { DocumentsModule } from './modules/documents/documents.module';

/**
 * API 进程的根组合模块。
 *
 * 平台模块先提供配置、可观测性与 HTTP 边界能力，业务模块在此基础上组合身份、用户、
 * 知识库和健康检查能力。
 */
@Module({
  imports: [
    RuntimeConfigModule,
    ObservabilityModule,
    HttpModule,
    MailModule,
    UsersModule,
    IdentityModule,
    KnowledgeBasesModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class AppModule {}
