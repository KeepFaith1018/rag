import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import type { KnowledgeBaseMemberRole } from '../contracts/knowledge-base-access';
import { KnowledgeBaseAccessService } from './knowledge-base-access.service';

/** 管理知识库成员、邀请生命周期与加入/退出流程。 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KnowledgeBaseAccessService,
  ) {}

  async list(userId: bigint, kbId: string) {
    const subject = await this.access.subject(kbId);
    const accessRole = this.access.requireManageMembers(subject, userId);
    const knowledgeBase = await this.prisma.b_knowledge_bases.findUniqueOrThrow(
      {
        where: { id: subject.id },
        include: {
          b_users: true,
          kb_members: {
            include: { b_users: true },
            orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
          },
        },
      },
    );
    const owner = knowledgeBase.b_users;
    return {
      kbId,
      accessRole,
      list: [
        {
          userId: owner.id.toString(),
          email: owner.email,
          fullName: owner.full_name ?? owner.email,
          avatarUrl: owner.avatar_url,
          role: 'owner',
          accessRole: 'owner',
          joinedAt: knowledgeBase.created_at,
          isCurrentUser: owner.id === userId,
        },
        ...knowledgeBase.kb_members.map((member) => ({
          userId: member.user_id.toString(),
          email: member.b_users.email,
          fullName: member.b_users.full_name ?? member.b_users.email,
          avatarUrl: member.b_users.avatar_url,
          role: member.role,
          accessRole: member.role,
          joinedAt: member.joined_at,
          isCurrentUser: member.user_id === userId,
        })),
      ],
    };
  }

  async createInvitation(
    userId: bigint,
    kbId: string,
    role: KnowledgeBaseMemberRole,
    expiredInHours: number,
  ) {
    // 明文代码只返回给创建者；持久化摘要可降低邀请表泄露后的滥用风险。
    const inviteCode = randomBytes(24).toString('base64url');
    const result = await this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      const accessRole = this.access.requireManageMembers(subject, userId);
      const invitation = await tx.b_kb_invitations.create({
        data: {
          kb_id: subject.id,
          inviter_id: userId,
          invite_code_hash: this.hash(inviteCode),
          role,
          expired_at: new Date(Date.now() + expiredInHours * 60 * 60 * 1000),
        },
      });
      return { invitation, accessRole };
    });
    return {
      id: result.invitation.id.toString(),
      kbId,
      inviteCode,
      role: result.invitation.role,
      status: 'active',
      expiresAt: result.invitation.expired_at,
      createdAt: result.invitation.created_at,
      inviterId: userId.toString(),
      accessRole: result.accessRole,
    };
  }

  async listInvitations(userId: bigint, kbId: string) {
    const subject = await this.access.subject(kbId);
    const accessRole = this.access.requireManageMembers(subject, userId);
    const items = await this.prisma.b_kb_invitations.findMany({
      where: {
        kb_id: subject.id,
        accepted_at: null,
        cancelled_at: null,
        expired_at: { gt: new Date() },
      },
      include: { b_users: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    return {
      kbId,
      accessRole,
      list: items.map((item) => ({
        id: item.id.toString(),
        kbId,
        role: item.role,
        status: 'active',
        expiresAt: item.expired_at,
        createdAt: item.created_at,
        cancelledAt: item.cancelled_at,
        acceptedAt: item.accepted_at,
        inviter: {
          userId: item.b_users.id.toString(),
          email: item.b_users.email,
          fullName: item.b_users.full_name ?? item.b_users.email,
          avatarUrl: item.b_users.avatar_url,
        },
      })),
    };
  }

  async cancelInvitation(userId: bigint, kbId: string, invitationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      this.access.requireManageMembers(subject, userId);
      const id = parseId(invitationId);
      const item = await tx.b_kb_invitations.findFirst({
        where: { id, kb_id: subject.id },
      });
      if (!item)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_NOT_FOUND,
          '邀请不存在',
          'not-found',
        );
      if (item.accepted_at)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_USED,
          '邀请已使用',
          'conflict',
        );
      if (item.cancelled_at)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_CANCELLED,
          '邀请已取消',
          'conflict',
        );
      const changed = await tx.b_kb_invitations.updateMany({
        where: { id, accepted_at: null, cancelled_at: null },
        data: { cancelled_at: new Date() },
      });
      if (changed.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_CANCELLED,
          '邀请已失效',
          'conflict',
        );
      return {
        id: item.id.toString(),
        kbId,
        role: item.role,
        status: 'cancelled',
        expiresAt: item.expired_at,
        createdAt: item.created_at,
        cancelledAt: new Date(),
        acceptedAt: item.accepted_at,
      };
    });
  }

  async joinByInvite(userId: bigint, inviteCode: string) {
    const inviteHash = this.hash(inviteCode);
    return this.prisma.$transaction(async (tx) => {
      let invitation = await tx.b_kb_invitations.findUnique({
        where: { invite_code_hash: inviteHash },
      });
      if (!invitation)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_NOT_FOUND,
          '邀请不存在',
          'not-found',
        );
      const subject = await this.access.subjectForUpdate(
        invitation.kb_id.toString(),
        tx,
      );
      invitation = await tx.b_kb_invitations.findUnique({
        where: { id: invitation.id },
      });
      if (!invitation)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_NOT_FOUND,
          '邀请不存在',
          'not-found',
        );
      if (subject.visibility === 'private')
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_VISIBILITY_CONFLICT,
          '该知识库不接受邀请加入',
          'conflict',
        );
      if (
        subject.owner_id === userId ||
        subject.kb_members.some((member) => member.user_id === userId)
      )
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_ALREADY_JOINED,
          '已是知识库成员',
          'conflict',
        );
      if (invitation.accepted_at)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_USED,
          '邀请已使用',
          'conflict',
        );
      if (invitation.cancelled_at)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_CANCELLED,
          '邀请已取消',
          'conflict',
        );
      if (invitation.expired_at <= new Date())
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_EXPIRED,
          '邀请已过期',
          'validation',
        );
      // 条件更新将邀请作为一次性凭证消费，阻止并发加入重复使用同一邀请。
      const accepted = await tx.b_kb_invitations.updateMany({
        where: {
          id: invitation.id,
          accepted_at: null,
          cancelled_at: null,
          expired_at: { gt: new Date() },
        },
        data: { accepted_at: new Date(), accepted_by: userId },
      });
      if (accepted.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_INVITATION_USED,
          '邀请已失效',
          'conflict',
        );
      await tx.b_kb_members.create({
        data: {
          kb_id: invitation.kb_id,
          user_id: userId,
          role: invitation.role,
        },
      });
      return {
        kbId: invitation.kb_id.toString(),
        joined: true,
        role: invitation.role,
      };
    });
  }

  async joinPublic(userId: bigint, kbId: string) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      if (subject.visibility !== 'public')
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_VISIBILITY_CONFLICT,
          '该知识库不支持直接加入',
          'conflict',
        );
      if (
        subject.owner_id === userId ||
        subject.kb_members.some((member) => member.user_id === userId)
      )
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_ALREADY_JOINED,
          '已是知识库成员',
          'conflict',
        );
      await tx.b_kb_members.create({
        data: { kb_id: subject.id, user_id: userId, role: 'member' },
      });
      return { kbId, joined: true, role: 'member' as const };
    });
  }

  async leave(userId: bigint, kbId: string) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      if (subject.owner_id === userId)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_OWNER_OPERATION_FORBIDDEN,
          '所有者不能退出知识库',
          'conflict',
        );
      const removed = await tx.b_kb_members.deleteMany({
        where: { kb_id: subject.id, user_id: userId },
      });
      if (removed.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_NOT_JOINED,
          '尚未加入该知识库',
          'conflict',
        );
      return { kbId, userId: userId.toString(), left: true };
    });
  }

  async remove(userId: bigint, kbId: string, memberUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      this.access.requireManageMembers(subject, userId);
      const target = parseId(memberUserId);
      if (subject.owner_id === target)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_OWNER_OPERATION_FORBIDDEN,
          '不能移除所有者',
          'conflict',
        );
      const removed = await tx.b_kb_members.deleteMany({
        where: { kb_id: subject.id, user_id: target },
      });
      if (removed.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_NOT_JOINED,
          '该用户不是成员',
          'conflict',
        );
      return { kbId, memberUserId, removed: true };
    });
  }

  async updateRole(
    userId: bigint,
    kbId: string,
    memberUserId: string,
    role: KnowledgeBaseMemberRole,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      this.access.requireManageMembers(subject, userId);
      const target = parseId(memberUserId);
      if (subject.owner_id === target)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_OWNER_OPERATION_FORBIDDEN,
          '不能修改所有者角色',
          'conflict',
        );
      const updated = await tx.b_kb_members.updateMany({
        where: { kb_id: subject.id, user_id: target },
        data: { role },
      });
      if (updated.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_NOT_JOINED,
          '该用户不是成员',
          'conflict',
        );
      return { kbId, memberUserId, role, updated: true };
    });
  }

  private hash(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }
}
