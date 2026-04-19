import { Injectable } from '@nestjs/common';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Injectable()
export class KbMemberService {
  async findAll(kbId: number): Promise<any> {
    return [];
  }

  async invite(kbId: number, inviteMemberDto: InviteMemberDto): Promise<any> {
    return null;
  }

  async updateRole(kbId: number, userId: number, updateMemberRoleDto: UpdateMemberRoleDto): Promise<any> {
    return null;
  }

  async remove(kbId: number, userId: number): Promise<any> {
    return null;
  }
}
