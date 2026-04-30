import { Controller, Get, UseGuards } from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { KbMemberService } from './kb-member.service';

/**
 * Chat 模块关联的知识库接口控制器。
 *
 * 提供对话模块所需的知识库查询能力：
 * - 获取当前用户可用的知识库列表（用于 RAG 问答选择）
 */
@Controller('knowledge-base')
@UseGuards(AuthGuard)
@Auth()
export class ChatKbController {
  constructor(private readonly kbMemberService: KbMemberService) {}

  /**
   * 获取当前用户可用的知识库列表（用于 RAG 问答模式选择）。
   * 返回用户拥有 canAsk 权限的知识库：owner / manager / collaborator / member / publicVisitor。
   */
  @Get('members/my-kbs')
  listMyKbMemberships(@CurrentUser('sub') userId: string) {
    return this.kbMemberService.listMyKbMemberships(Number(userId));
  }
}
