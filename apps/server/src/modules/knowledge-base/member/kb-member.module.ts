import { Module } from '@nestjs/common';
import { KbPermissionModule } from '../permission/kb-permission.module';
import { ChatKbController } from './chat-kb.controller';
import { KbMemberController } from './kb-member.controller';
import { KbMemberService } from './kb-member.service';

/**
 * 知识库成员子模块。
 */
@Module({
  imports: [KbPermissionModule],
  controllers: [ChatKbController, KbMemberController],
  providers: [KbMemberService],
  exports: [KbMemberService],
})
export class KbMemberModule {}
