import { Module } from '@nestjs/common';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KbPermissionModule } from './permission/kb-permission.module';
import { KbMemberModule } from './member/kb-member.module';

/**
 * 知识库管理模块。
 */
@Module({
  imports: [KbPermissionModule, KbMemberModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService, KbPermissionModule, KbMemberModule],
})
export class KnowledgeBaseModule {}
