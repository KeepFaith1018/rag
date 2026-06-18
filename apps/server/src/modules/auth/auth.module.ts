import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionCleanupService } from './session-cleanup.service';

@Module({
  imports: [
    UserModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionCleanupService],
  exports: [AuthService],
})
export class AuthModule {}
