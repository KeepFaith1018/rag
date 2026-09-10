import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { KnowledgeBasesController } from './knowledge-bases.controller';
import { KnowledgeBaseAccessService } from './services/knowledge-base-access.service';
import { KnowledgeBasesService } from './services/knowledge-bases.service';
import { MembersService } from './services/members.service';

/** 组装知识库领域的访问策略、生命周期与成员服务。 */
@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeBasesController],
  providers: [
    KnowledgeBaseAccessService,
    KnowledgeBasesService,
    MembersService,
  ],
  exports: [KnowledgeBaseAccessService, KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
