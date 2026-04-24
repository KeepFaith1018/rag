import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import {
  KnowledgeBaseAccessRole,
  KnowledgeBaseMemberRole,
  KnowledgeBasePermissionFlags,
} from '../interfaces/knowledge-base-access.interface';
import {
  KbPermissionAction,
  KbPermissionContext,
} from '../interfaces/kb-permission.interface';

type KnowledgeBasePermissionSubject = {
  id: bigint;
  owner_id: bigint;
  visibility: string;
  is_public: boolean;
  allow_public_download: boolean;
  status: string;
  kb_members: Array<{
    user_id: bigint;
    role: string;
  }>;
};

/**
 * 负责知识库角色解析与统一权限判断，避免各服务重复散落权限逻辑。
 */
@Injectable()
export class KbPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询知识库并返回权限判断所需的最小信息。
   */
  async getKnowledgeBasePermissionSubject(kbId: string) {
    const parsedKbId = this.parseKnowledgeBaseId(kbId);
    const knowledgeBase = await this.prisma.b_knowledge_bases.findUnique({
      where: {
        id: parsedKbId,
      },
      include: {
        kb_members: true,
      },
    });

    if (!knowledgeBase) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
    }

    return knowledgeBase satisfies KnowledgeBasePermissionSubject;
  }

  /**
   * 按知识库 ID 和权限动作完成统一鉴权，并返回本次请求可复用的权限上下文。
   */
  async authorize(
    userId: number,
    kbId: string,
    action: KbPermissionAction,
  ): Promise<KbPermissionContext> {
    const knowledgeBase = await this.getKnowledgeBasePermissionSubject(kbId);
    const accessRole = this.assertReadable(knowledgeBase, BigInt(userId));
    const visibility = this.normalizeVisibility(knowledgeBase.visibility);
    const permissions = this.buildPermissions(
      accessRole,
      visibility,
      knowledgeBase.allow_public_download === true,
    );

    if (!this.isActionAllowed(action, permissions)) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return {
      userId: String(userId),
      kbId,
      accessRole,
      permissions,
      visibility,
    };
  }

  /**
   * 将路由参数中的知识库 ID 转为 bigint。
   */
  parseKnowledgeBaseId(kbId: string) {
    try {
      return BigInt(kbId);
    } catch {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '知识库 ID 格式不正确',
      );
    }
  }

  /**
   * 判断当前用户是否拥有知识库读取权限。
   */
  assertReadable(
    knowledgeBase: KnowledgeBasePermissionSubject,
    userId: bigint,
  ): KnowledgeBaseAccessRole {
    const accessRole = this.resolveAccessRole(knowledgeBase, userId);
    if (!accessRole) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return accessRole;
  }

  /**
   * 判断当前用户是否拥有成员管理权限，仅 owner / manager 允许。
   */
  assertManageMembers(
    knowledgeBase: KnowledgeBasePermissionSubject,
    userId: bigint,
  ) {
    const accessRole = this.assertReadable(knowledgeBase, userId);
    if (accessRole !== 'owner' && accessRole !== 'manager') {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return accessRole;
  }

  /**
   * 仅允许 owner 执行知识库核心设置写操作。
   */
  assertOwner(knowledgeBase: KnowledgeBasePermissionSubject, userId: bigint) {
    if (knowledgeBase.owner_id !== userId) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }
  }

  /**
   * 根据 owner / manager / collaborator / member / publicVisitor 解析当前用户身份。
   */
  resolveAccessRole(
    knowledgeBase: Pick<
      KnowledgeBasePermissionSubject,
      'owner_id' | 'visibility' | 'is_public' | 'kb_members'
    >,
    userId: bigint,
  ): KnowledgeBaseAccessRole | null {
    if (knowledgeBase.owner_id === userId) {
      return 'owner';
    }

    const matchedMember = knowledgeBase.kb_members.find(
      (member) => member.user_id === userId,
    );
    if (knowledgeBase.visibility === 'shared' && matchedMember) {
      return this.normalizeMemberRole(matchedMember.role);
    }

    if (knowledgeBase.visibility === 'shared' && knowledgeBase.is_public) {
      return 'publicVisitor';
    }

    return null;
  }

  /**
   * 将数据库成员角色值归一化为当前支持的角色集合。
   */
  normalizeMemberRole(value: unknown): KnowledgeBaseMemberRole {
    if (value === 'manager' || value === 'editor') {
      return 'manager';
    }

    if (value === 'collaborator') {
      return 'collaborator';
    }

    return 'member';
  }

  /**
   * 将数据库中的可见性字段收敛为稳定的服务层枚举。
   */
  normalizeVisibility(value: unknown): 'private' | 'shared' {
    return value === 'shared' ? 'shared' : 'private';
  }

  /**
   * 统一组装前端可直接消费的权限标识。
   */
  buildPermissions(
    accessRole: KnowledgeBaseAccessRole,
    visibility: 'private' | 'shared',
    allowPublicDownload: boolean,
  ): KnowledgeBasePermissionFlags {
    if (accessRole === 'owner') {
      return {
        canView: true,
        canAsk: true,
        canEdit: true,
        canDelete: true,
        canInvite: visibility === 'shared',
        canUpload: true,
        canReparse: true,
        canDownload: true,
        canManageKnowledgeBase: true,
        canManageMembers: visibility === 'shared',
        canDeleteAnyDocument: true,
        canDeleteOwnDocument: true,
        canReparseAnyDocument: true,
        canReparseOwnDocument: true,
      };
    }

    if (accessRole === 'manager') {
      return {
        canView: true,
        canAsk: true,
        canEdit: false,
        canDelete: false,
        canInvite: true,
        canUpload: true,
        canReparse: true,
        canDownload: true,
        canManageKnowledgeBase: false,
        canManageMembers: true,
        canDeleteAnyDocument: true,
        canDeleteOwnDocument: true,
        canReparseAnyDocument: true,
        canReparseOwnDocument: true,
      };
    }

    if (accessRole === 'collaborator') {
      return {
        canView: true,
        canAsk: true,
        canEdit: false,
        canDelete: false,
        canInvite: false,
        canUpload: true,
        canReparse: true,
        canDownload: true,
        canManageKnowledgeBase: false,
        canManageMembers: false,
        canDeleteAnyDocument: false,
        canDeleteOwnDocument: true,
        canReparseAnyDocument: false,
        canReparseOwnDocument: true,
      };
    }

    if (accessRole === 'member') {
      return {
        canView: true,
        canAsk: true,
        canEdit: false,
        canDelete: false,
        canInvite: false,
        canUpload: false,
        canReparse: false,
        canDownload: true,
        canManageKnowledgeBase: false,
        canManageMembers: false,
        canDeleteAnyDocument: false,
        canDeleteOwnDocument: false,
        canReparseAnyDocument: false,
        canReparseOwnDocument: false,
      };
    }

    return {
      canView: true,
      canAsk: true,
      canEdit: false,
      canDelete: false,
      canInvite: false,
      canUpload: false,
      canReparse: false,
      canDownload: allowPublicDownload,
      canManageKnowledgeBase: false,
      canManageMembers: false,
      canDeleteAnyDocument: false,
      canDeleteOwnDocument: false,
      canReparseAnyDocument: false,
      canReparseOwnDocument: false,
    };
  }

  /**
   * 将声明式动作映射为具体权限位，供 Guard 与后续模块统一复用。
   */
  private isActionAllowed(
    action: KbPermissionAction,
    permissions: KnowledgeBasePermissionFlags,
  ) {
    switch (action) {
      case 'read':
        return permissions.canView;
      case 'ask':
        return permissions.canAsk;
      case 'manageKnowledgeBase':
        return permissions.canManageKnowledgeBase;
      case 'manageMembers':
        return permissions.canManageMembers;
      case 'uploadDocument':
        return permissions.canUpload;
      case 'downloadDocument':
        return permissions.canDownload;
      case 'deleteAnyDocument':
        return permissions.canDeleteAnyDocument;
      case 'deleteOwnDocument':
        return permissions.canDeleteOwnDocument;
      case 'reparseAnyDocument':
        return permissions.canReparseAnyDocument;
      case 'reparseOwnDocument':
        return permissions.canReparseOwnDocument;
      default:
        return false;
    }
  }
}
