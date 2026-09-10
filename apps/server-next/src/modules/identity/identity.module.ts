import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../platform/database/database.module';
import { MailModule } from '../../platform/mail/mail.module';
import { RedisModule } from '../../platform/redis/redis.module';
import { RuntimeConfigModule } from '../../platform/config/runtime-config.module';
import { UsersModule } from '../users/users.module';
import { IdentityController } from './identity.controller';
import { AuthGuard } from './http/auth.guard';
import { AuthenticationService } from './services/authentication.service';
import { IdentityService } from './services/identity.service';
import { IdentityRateLimitService } from './services/identity-rate-limit.service';
import { PasswordService } from './services/password.service';
import { VerificationService } from './services/verification.service';

/**
 * 组装身份认证能力，并以 APP_GUARD 形式为整个应用启用默认认证策略。
 */
@Module({
  imports: [
    JwtModule.register({}),
    RuntimeConfigModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    UsersModule,
  ],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    IdentityRateLimitService,
    AuthenticationService,
    PasswordService,
    VerificationService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
