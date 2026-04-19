import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { KbMemberService } from './kb-member.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/currentUser.decorator';
import { Auth } from '../../common/decorators/auth.decorator';

@Controller('knowledge-bases/:kb_id/members')
@UseGuards(AuthGuard)
export class KbMemberController {
  constructor(private readonly kbMemberService: KbMemberService) {}

  @Get()
  @Auth()
  async findAll(@Param('kb_id') kbId: string): Promise<any> {
    return this.kbMemberService.findAll(+kbId);
  }

  @Post()
  @Auth()
  async invite(
    @Param('kb_id') kbId: string,
    @Body() inviteMemberDto: InviteMemberDto,
    @CurrentUser('sub') ownerId: string,
  ): Promise<any> {
    return this.kbMemberService.invite(+kbId, inviteMemberDto);
  }

  @Patch(':user_id')
  @Auth()
  async updateRole(
    @Param('kb_id') kbId: string,
    @Param('user_id') userId: string,
    @Body() updateMemberRoleDto: UpdateMemberRoleDto,
  ): Promise<any> {
    return this.kbMemberService.updateRole(+kbId, +userId, updateMemberRoleDto);
  }

  @Delete(':user_id')
  @Auth()
  async remove(
    @Param('kb_id') kbId: string,
    @Param('user_id') userId: string,
  ): Promise<any> {
    return this.kbMemberService.remove(+kbId, +userId);
  }
}
