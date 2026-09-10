import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { MailService } from './mail.service';

@Module({
  imports: [RuntimeConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
