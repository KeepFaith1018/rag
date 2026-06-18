import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { KbPermission } from '../permission/kb-permission.decorator';
import { KbPermissionGuard } from '../permission/kb-permission.guard';
import { CreateKbInvitationDto } from './dto/create-kb-invitation.dto';
import { JoinKbDto } from './dto/join-kb.dto';
import { UpdateKbMemberDto } from './dto/update-kb-member.dto';
import { KbMemberService } from './kb-member.service';

/**
 * 知识库成员与邀请管理接口控制器。
 */
@Controller()
@UseGuards(AuthGuard, KbPermissionGuard)
@Auth()
export class KbMemberController {
  constructor(private readonly kbMemberService: KbMemberService) {}

  /**
   * 获取共享知识库成员列表。
   */
  @Get('knowledge-bases/:kbId/members')
  @KbPermission({ action: 'manageMembers' })
  listMembers(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
  ) {
    return this.kbMemberService.listMembers(Number(userId), kbId);
  }

  /**
   * 创建共享知识库邀请。
   */
  @Post('knowledge-bases/:kbId/invitations')
  @KbPermission({ action: 'manageMembers' })
  createInvitation(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Body() createKbInvitationDto: CreateKbInvitationDto,
  ) {
    return this.kbMemberService.createInvitation(
      Number(userId),
      kbId,
      createKbInvitationDto,
    );
  }

  /**
   * 获取当前仍有效的邀请码列表。
   */
  @Get('knowledge-bases/:kbId/invitations')
  @KbPermission({ action: 'manageMembers' })
  listInvitations(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
  ) {
    return this.kbMemberService.listInvitations(Number(userId), kbId);
  }

  /**
   * 取消指定邀请。
   */
  @Delete('knowledge-bases/:kbId/invitations/:invitationId')
  @KbPermission({ action: 'manageMembers' })
  cancelInvitation(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.kbMemberService.cancelInvitation(
      Number(userId),
      kbId,
      invitationId,
    );
  }

  /**
   * 使用邀请码加入共享知识库。
   */
  @Post('knowledge-bases/join')
  joinByInvite(
    @CurrentUser('sub') userId: string,
    @Body() joinKbDto: JoinKbDto,
  ) {
    return this.kbMemberService.joinByInvite(Number(userId), joinKbDto);
  }

  /**
   * 直接加入公开知识库（无需邀请码）。
   */
  @Post('knowledge-bases/:kbId/join')
  joinPublic(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
  ) {
    return this.kbMemberService.joinPublic(Number(userId), kbId);
  }

  /**
   * 退出知识库（成员自行退出）。
   */
  @Post('knowledge-bases/:kbId/leave')
  leaveKnowledgeBase(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
  ) {
    return this.kbMemberService.leaveKnowledgeBase(Number(userId), kbId);
  }

  /**
   * 更新成员角色。
   */
  @Patch('knowledge-bases/:kbId/members/:memberUserId')
  @KbPermission({ action: 'manageMembers' })
  updateMember(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: UpdateKbMemberDto,
  ) {
    return this.kbMemberService.updateMember(
      Number(userId),
      kbId,
      memberUserId,
      dto,
    );
  }

  /**
   * 移除共享知识库中的某个成员。
   */
  @Delete('knowledge-bases/:kbId/members/:memberUserId')
  @KbPermission({ action: 'manageMembers' })
  removeMember(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('memberUserId') memberUserId: string,
  ) {
    return this.kbMemberService.removeMember(
      Number(userId),
      kbId,
      memberUserId,
    );
  }
}
