import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Principal } from '../identity/contracts/principal';
import { CurrentPrincipal } from '../identity/http/current-principal.decorator';
import {
  CreateInvitationDto,
  CreateKnowledgeBaseDto,
  JoinKnowledgeBaseDto,
  ListKnowledgeBasesDto,
  ListPublicKnowledgeBasesDto,
  UpdateKnowledgeBaseDto,
  UpdateMemberRoleDto,
} from './dto/knowledge-base.dto';
import { KnowledgeBasesService } from './services/knowledge-bases.service';
import { MembersService } from './services/members.service';

/** 知识库与成员协作能力的 HTTP 路由入口。 */
@Controller()
export class KnowledgeBasesController {
  constructor(
    private readonly knowledgeBases: KnowledgeBasesService,
    private readonly members: MembersService,
  ) {}

  @Post('knowledge-bases')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    return this.knowledgeBases.create(BigInt(principal.userId), dto);
  }

  @Get('knowledge-bases')
  listMine(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListKnowledgeBasesDto,
  ) {
    return this.knowledgeBases.listMine(BigInt(principal.userId), query);
  }

  @Get('public/knowledge-bases')
  listPublic(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListPublicKnowledgeBasesDto,
  ) {
    return this.knowledgeBases.listPublic(BigInt(principal.userId), query);
  }

  @Get('knowledge-bases/:kbId')
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
  ) {
    return this.knowledgeBases.detail(BigInt(principal.userId), kbId);
  }

  @Patch('knowledge-bases/:kbId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeBases.update(BigInt(principal.userId), kbId, dto);
  }

  @Delete('knowledge-bases/:kbId')
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
  ) {
    return this.knowledgeBases.remove(BigInt(principal.userId), kbId);
  }

  @Get('knowledge-bases/:kbId/members')
  listMembers(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
  ) {
    return this.members.list(BigInt(principal.userId), kbId);
  }

  @Post('knowledge-bases/:kbId/invitations')
  createInvitation(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.members.createInvitation(
      BigInt(principal.userId),
      kbId,
      dto.role,
      dto.expiredInHours,
    );
  }

  @Get('knowledge-bases/:kbId/invitations')
  listInvitations(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
  ) {
    return this.members.listInvitations(BigInt(principal.userId), kbId);
  }

  @Delete('knowledge-bases/:kbId/invitations/:invitationId')
  cancelInvitation(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.members.cancelInvitation(
      BigInt(principal.userId),
      kbId,
      invitationId,
    );
  }

  @Post('knowledge-bases/join')
  @HttpCode(200)
  joinByInvite(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: JoinKnowledgeBaseDto,
  ) {
    return this.members.joinByInvite(BigInt(principal.userId), dto.inviteCode);
  }

  @Post('knowledge-bases/:kbId/join')
  @HttpCode(200)
  joinPublic(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
  ) {
    return this.members.joinPublic(BigInt(principal.userId), kbId);
  }

  @Post('knowledge-bases/:kbId/leave')
  @HttpCode(200)
  leave(@CurrentPrincipal() principal: Principal, @Param('kbId') kbId: string) {
    return this.members.leave(BigInt(principal.userId), kbId);
  }

  @Delete('knowledge-bases/:kbId/members/:memberUserId')
  removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('memberUserId') memberUserId: string,
  ) {
    return this.members.remove(BigInt(principal.userId), kbId, memberUserId);
  }

  @Patch('knowledge-bases/:kbId/members/:memberUserId')
  updateMemberRole(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.members.updateRole(
      BigInt(principal.userId),
      kbId,
      memberUserId,
      dto.role,
    );
  }
}
