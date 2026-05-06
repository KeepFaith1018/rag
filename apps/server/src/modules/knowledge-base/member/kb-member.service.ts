import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-client';
import { randomBytes } from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { KbPermissionService } from '../permission/kb-permission.service';
import { KnowledgeBaseMemberRole } from '../interfaces/knowledge-base-access.interface';
import { CreateKbInvitationDto } from './dto/create-kb-invitation.dto';
import { JoinKbDto } from './dto/join-kb.dto';

type InvitationStatus = 'active' | 'used' | 'expired' | 'cancelled';

type InvitationWithInviter = Prisma.b_kb_invitationsGetPayload<{
  include: {
    b_users: {
      select: {
        id: true;
        email: true;
        full_name: true;
        avatar_url: true;
      };
    };
  };
}>;

/**
 * 负责共享知识库成员、邀请与加入流程相关业务逻辑。
 */
@Injectable()
export class KbMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbPermissionService: KbPermissionService,
  ) {}

  /**
   * 获取知识库成员列表，仅 owner / manager 可查看。
   */
  async listMembers(userId: number, kbId: string) {
    try {
      const currentUserId = BigInt(userId);
      const knowledgeBase =
        await this.kbPermissionService.getKnowledgeBasePermissionSubject(kbId);

      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);

      const [owner, members] = await this.prisma.$transaction([
        this.prisma.b_users.findUnique({
          where: {
            id: knowledgeBase.owner_id,
          },
          select: {
            id: true,
            email: true,
            full_name: true,
            avatar_url: true,
          },
        }),
        this.prisma.b_kb_members.findMany({
          where: {
            kb_id: knowledgeBase.id,
          },
          include: {
            b_users: {
              select: {
                id: true,
                email: true,
                full_name: true,
                avatar_url: true,
              },
            },
          },
          orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
        }),
      ]);

      return {
        kbId,
        accessRole: this.kbPermissionService.resolveAccessRole(
          knowledgeBase,
          currentUserId,
        ) as 'owner' | 'manager',
        list: [
          ...(owner
            ? [
                {
                  userId: owner.id.toString(),
                  email: owner.email,
                  fullName: owner.full_name,
                  avatarUrl: owner.avatar_url,
                  role: 'owner' as const,
                  accessRole: 'owner' as const,
                  joinedAt: null,
                  isCurrentUser: owner.id === currentUserId,
                },
              ]
            : []),
          ...members.map((member) => {
            const role = this.kbPermissionService.normalizeMemberRole(
              member.role,
            );

            return {
              userId: member.user_id.toString(),
              email: member.b_users.email,
              fullName: member.b_users.full_name,
              avatarUrl: member.b_users.avatar_url,
              role,
              accessRole: role,
              joinedAt: member.joined_at,
              isCurrentUser: member.user_id === currentUserId,
            };
          }),
        ],
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'listMembers',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 创建共享知识库邀请，仅 owner / manager 可操作。
   */
  async createInvitation(
    userId: number,
    kbId: string,
    dto: CreateKbInvitationDto,
  ) {
    try {
      const currentUserId = BigInt(userId);
      const knowledgeBase =
        await this.kbPermissionService.getKnowledgeBasePermissionSubject(kbId);

      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);
      const accessRole = this.kbPermissionService.resolveAccessRole(
        knowledgeBase,
        currentUserId,
      ) as 'owner' | 'manager';
      const role = this.normalizeInvitationRole(dto.role);
      const expiredInHours = dto.expiredInHours ?? 72;
      const expiresAt = new Date(Date.now() + expiredInHours * 60 * 60 * 1000);

      const invitation = await this.prisma.b_kb_invitations.create({
        data: {
          kb_id: knowledgeBase.id,
          inviter_id: currentUserId,
          invite_code: this.generateInviteCode(),
          role,
          expired_at: expiresAt,
          is_used: false,
        },
      });

      return {
        id: invitation.id.toString(),
        kbId,
        inviteCode: invitation.invite_code,
        role,
        status: 'active' as InvitationStatus,
        expiresAt: invitation.expired_at,
        createdAt: invitation.created_at,
        inviterId: invitation.inviter_id.toString(),
        accessRole,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'createInvitation',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 获取当前共享知识库仍然有效的邀请列表，仅 owner / manager 可查看。
   */
  async listInvitations(userId: number, kbId: string) {
    try {
      const currentUserId = BigInt(userId);
      const knowledgeBase =
        await this.kbPermissionService.getKnowledgeBasePermissionSubject(kbId);

      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);
      const accessRole = this.kbPermissionService.resolveAccessRole(
        knowledgeBase,
        currentUserId,
      ) as 'owner' | 'manager';
      const now = new Date();
      const invitations = await this.prisma.b_kb_invitations.findMany({
        where: {
          kb_id: knowledgeBase.id,
          is_used: false,
          cancelled_at: null,
          expired_at: {
            gt: now,
          },
        },
        include: {
          b_users: {
            select: {
              id: true,
              email: true,
              full_name: true,
              avatar_url: true,
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });

      return {
        kbId,
        accessRole,
        list: invitations.map((invitation) =>
          this.buildInvitationItem(invitation),
        ),
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'listInvitations',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 取消一个仍未失效的邀请码，仅 owner / manager 可操作。
   */
  async cancelInvitation(userId: number, kbId: string, invitationId: string) {
    try {
      const knowledgeBase =
        await this.kbPermissionService.getKnowledgeBasePermissionSubject(kbId);

      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);

      const invitationBigIntId = this.parseBigIntId(invitationId, '邀请 ID');
      const invitation = await this.prisma.b_kb_invitations.findFirst({
        where: {
          id: invitationBigIntId,
          kb_id: knowledgeBase.id,
        },
        include: {
          b_users: {
            select: {
              id: true,
              email: true,
              full_name: true,
              avatar_url: true,
            },
          },
        },
      });

      if (!invitation) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '邀请记录不存在');
      }

      const status = this.resolveInvitationStatus(invitation);
      if (status === 'used') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_USED);
      }
      if (status === 'expired') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_EXPIRED);
      }
      if (status === 'cancelled') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_CANCELLED);
      }

      const cancelled = await this.prisma.b_kb_invitations.update({
        where: {
          id: invitation.id,
        },
        data: {
          cancelled_at: new Date(),
        },
        include: {
          b_users: {
            select: {
              id: true,
              email: true,
              full_name: true,
              avatar_url: true,
            },
          },
        },
      });

      return this.buildInvitationItem(cancelled);
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'cancelInvitation',
          userId,
          kbId,
          invitationId,
        },
      });
    }
  }

  /**
   * 通过邀请码加入共享知识库。
   */
  async joinByInvite(userId: number, dto: JoinKbDto) {
    try {
      const currentUserId = BigInt(userId);
      const inviteCode = dto.inviteCode.trim();
      const invitation = await this.prisma.b_kb_invitations.findUnique({
        where: {
          invite_code: inviteCode,
        },
        include: {
          b_knowledge_bases: {
            include: {
              kb_members: {
                where: {
                  user_id: currentUserId,
                },
              },
            },
          },
        },
      });

      if (!invitation) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '邀请码不存在');
      }

      const status = this.resolveInvitationStatus(invitation);
      if (status === 'cancelled') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_CANCELLED);
      }
      if (status === 'expired') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_EXPIRED);
      }
      if (status === 'used') {
        throw new BusinessException(ErrorCode.KNOWLEDGE_INVITATION_USED);
      }

      const knowledgeBase = invitation.b_knowledge_bases;
      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);

      if (knowledgeBase.owner_id === currentUserId) {
        throw new BusinessException(ErrorCode.KNOWLEDGE_HAS_OWNED);
      }

      if (knowledgeBase.kb_members.length > 0) {
        throw new BusinessException(ErrorCode.KNOWLEDGE_HAS_JOINED);
      }

      const role = this.kbPermissionService.normalizeMemberRole(
        invitation.role,
      );

      await this.prisma.$transaction([
        this.prisma.b_kb_members.create({
          data: {
            kb_id: knowledgeBase.id,
            user_id: currentUserId,
            role,
          },
        }),
        this.prisma.b_kb_invitations.update({
          where: {
            id: invitation.id,
          },
          data: {
            is_used: true,
            accepted_by: currentUserId,
            accepted_at: new Date(),
          },
        }),
      ]);

      return {
        kbId: knowledgeBase.id.toString(),
        inviteCode,
        joined: true,
        role,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'joinByInvite',
          userId,
          inviteCode: dto.inviteCode,
        },
      });
    }
  }

  /**
   * 获取当前用户可用的知识库列表（用于 RAG 问答模式选择）。
   * 返回用户拥有 canAsk 权限的知识库：owner / manager / collaborator / member / publicVisitor。
   */
  async listMyKbMemberships(userId: number) {
    try {
      const currentUserId = BigInt(userId);

      // 查询用户作为 owner 的知识库
      const ownedKbs = await this.prisma.b_knowledge_bases.findMany({
        where: { owner_id: currentUserId },
        select: { id: true, name: true, visibility: true, is_public: true },
      });

      // 查询用户作为 member 的知识库
      const memberships = await this.prisma.b_kb_members.findMany({
        where: { user_id: currentUserId },
        include: {
          b_knowledge_bases: {
            select: { id: true, name: true, visibility: true, is_public: true },
          },
        },
      });

      // 查询公开的共享知识库（publicVisitor 视角）
      const publicKbs = await this.prisma.b_knowledge_bases.findMany({
        where: {
          visibility: 'shared',
          is_public: true,
          status: 'normal',
        },
        select: { id: true, name: true, visibility: true, is_public: true },
      });

      const result: Array<{
        kbId: string;
        kbName: string;
        permission: 'owner' | 'manager' | 'collaborator' | 'member' | 'publicVisitor';
        visibility: 'private' | 'shared';
        isPublic: boolean;
      }> = [];

      // 添加 owner 角色
      for (const kb of ownedKbs) {
        result.push({
          kbId: kb.id.toString(),
          kbName: kb.name,
          permission: 'owner',
          visibility: kb.visibility as 'private' | 'shared',
          isPublic: kb.is_public,
        });
      }

      // 添加 member 角色
      for (const m of memberships) {
        const kb = m.b_knowledge_bases;
        if (kb.visibility === 'shared') {
          const role = this.kbPermissionService.normalizeMemberRole(m.role);
          result.push({
            kbId: kb.id.toString(),
            kbName: kb.name,
            permission: role,
            visibility: kb.visibility as 'private' | 'shared',
            isPublic: kb.is_public,
          });
        }
      }

      // 添加 publicVisitor 角色（公开共享库）
      const ownedKbIds = new Set(result.map((r) => r.kbId));
      for (const kb of publicKbs) {
        if (!ownedKbIds.has(kb.id.toString())) {
          result.push({
            kbId: kb.id.toString(),
            kbName: kb.name,
            permission: 'publicVisitor',
            visibility: kb.visibility as 'private' | 'shared',
            isPublic: kb.is_public,
          });
        }
      }

      return result;
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'listMyKbMemberships',
          userId,
        },
      });
    }
  }

  /**
   * 移除共享知识库成员，仅 owner / manager 可操作，且禁止移除 owner。
   */
  async removeMember(userId: number, kbId: string, memberUserId: string) {
    try {
      const targetUserId = this.parseBigIntId(memberUserId, '成员用户 ID');
      const knowledgeBase =
        await this.kbPermissionService.getKnowledgeBasePermissionSubject(kbId);

      this.ensureSharedKnowledgeBase(knowledgeBase.visibility);

      if (knowledgeBase.owner_id === targetUserId) {
        throw new BusinessException(
          ErrorCode.KNOWLEDGE_MEMBER_REMOVE_OWNER_FORBIDDEN,
        );
      }

      const member = await this.prisma.b_kb_members.findUnique({
        where: {
          kb_id_user_id: {
            kb_id: knowledgeBase.id,
            user_id: targetUserId,
          },
        },
      });

      if (!member) {
        throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_JOINED);
      }

      await this.prisma.b_kb_members.delete({
        where: {
          id: member.id,
        },
      });

      return {
        kbId,
        memberUserId,
        removed: true,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KbMemberService',
          action: 'removeMember',
          userId,
          kbId,
          memberUserId,
        },
      });
    }
  }

  /**
   * 将邀请记录转换为对外统一的返回结构。
   */
  private buildInvitationItem(invitation: InvitationWithInviter) {
    const status = this.resolveInvitationStatus(invitation);

    return {
      id: invitation.id.toString(),
      kbId: invitation.kb_id.toString(),
      inviteCode: invitation.invite_code,
      role: this.normalizeInvitationRole(invitation.role),
      status,
      expiresAt: invitation.expired_at,
      createdAt: invitation.created_at,
      cancelledAt: invitation.cancelled_at,
      acceptedAt: invitation.accepted_at,
      inviter: {
        userId: invitation.b_users.id.toString(),
        email: invitation.b_users.email,
        fullName: invitation.b_users.full_name,
        avatarUrl: invitation.b_users.avatar_url,
      },
    };
  }

  /**
   * 统一推导邀请状态语义，屏蔽底层字段细节。
   */
  private resolveInvitationStatus(invitation: {
    is_used: boolean;
    expired_at: Date | string;
    cancelled_at: Date | null;
  }): InvitationStatus {
    const expiredAt =
      invitation.expired_at instanceof Date
        ? invitation.expired_at
        : new Date(invitation.expired_at);

    if (invitation.cancelled_at) {
      return 'cancelled';
    }
    if (invitation.is_used) {
      return 'used';
    }
    if (expiredAt.getTime() <= Date.now()) {
      return 'expired';
    }

    return 'active';
  }

  /**
   * 归一化邀请目标角色。
   */
  private normalizeInvitationRole(value: unknown): KnowledgeBaseMemberRole {
    return this.kbPermissionService.normalizeMemberRole(value);
  }

  /**
   * 仅共享知识库允许执行成员管理能力。
   */
  private ensureSharedKnowledgeBase(visibility: string) {
    if (visibility !== 'shared') {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '私有知识库不支持成员管理',
      );
    }
  }

  /**
   * 生成用于分享的随机邀请码。
   */
  private generateInviteCode() {
    return randomBytes(16).toString('hex');
  }

  /**
   * 将字符串形式的 bigint 参数做统一解析与错误处理。
   */
  private parseBigIntId(id: string, label: string) {
    try {
      return BigInt(id);
    } catch {
      throw new BusinessException(ErrorCode.PARAM_ERROR, `${label}格式不正确`);
    }
  }
}
