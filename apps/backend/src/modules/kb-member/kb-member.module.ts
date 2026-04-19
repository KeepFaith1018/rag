import { Module } from '@nestjs/common';
import { KbMemberController } from './kb-member.controller';
import { KbMemberService } from './kb-member.service';

@Module({
  controllers: [KbMemberController],
  providers: [KbMemberService]
})
export class KbMemberModule {}
