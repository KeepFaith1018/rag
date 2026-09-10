import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { lockKnowledgeBaseById } from '../../../platform/database/transaction-locks';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import type {
  KnowledgeBaseAccessRole,
  KnowledgeBaseMemberRole,
  KnowledgeBasePermissions,
  KnowledgeBaseVisibility,
} from '../contracts/knowledge-base-access';

type DbClient = PrismaService | Prisma.TransactionClient;
type Subject = {
  id: bigint;
  owner_id: bigint;
  visibility: KnowledgeBaseVisibility;
  allow_public_download: boolean;
  deleted_at: Date | null;
  kb_members: Array<{ user_id: bigint; role: KnowledgeBaseMemberRole }>;
};

/**
 * 知识库授权的唯一策略入口：解析访问身份、执行强制检查并生成能力集合。
 */
@Injectable()
export class KnowledgeBaseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async subject(kbId: string, db: DbClient = this.prisma): Promise<Subject> {
    const knowledgeBase = await db.b_knowledge_bases.findUnique({
      where: { id: parseId(kbId) },
      include: { kb_members: true },
    });
    if (!knowledgeBase || knowledgeBase.deleted_at)
      throw new BusinessError(
        ErrorCode.KNOWLEDGE_NOT_FOUND,
        '知识库不存在',
        'not-found',
      );
    return knowledgeBase;
  }

  async subjectForUpdate(
    kbId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subject> {
    const id = parseId(kbId);
    await lockKnowledgeBaseById(tx, id);
    return this.subject(kbId, tx);
  }

  resolve(subject: Subject, userId: bigint): KnowledgeBaseAccessRole | null {
    if (subject.owner_id === userId) return 'owner';
    const member = subject.kb_members.find((item) => item.user_id === userId);
    if (member) return member.role;
    return subject.visibility === 'public' ? 'publicVisitor' : null;
  }

  /** 要求用户至少是成员，或正在访问公开知识库。 */
  requireRead(subject: Subject, userId: bigint) {
    const role = this.resolve(subject, userId);
    if (!role) throw this.forbidden();
    return role;
  }

  /** 要求用户是知识库所有者。 */
  requireOwner(subject: Subject, userId: bigint) {
    if (subject.owner_id !== userId) throw this.forbidden();
    return 'owner' as const;
  }

  /** 要求用户可管理成员，并拒绝在私有知识库上执行成员操作。 */
  requireManageMembers(subject: Subject, userId: bigint) {
    const role = this.requireRead(subject, userId);
    if (role !== 'owner' && role !== 'manager') throw this.forbidden();
    if (subject.visibility === 'private')
      throw new BusinessError(
        ErrorCode.KNOWLEDGE_VISIBILITY_CONFLICT,
        '私有知识库不支持成员操作',
        'conflict',
      );
    return role;
  }

  /** 将有效角色、可见性和公开下载设置投影为客户端能力。 */
  permissions(
    role: KnowledgeBaseAccessRole,
    visibility: KnowledgeBaseVisibility,
    allowPublicDownload: boolean,
  ): KnowledgeBasePermissions {
    const owner = role === 'owner';
    const manager = role === 'manager';
    const collaborator = role === 'collaborator';
    const member = role === 'member';
    return {
      canView: true,
      canAsk: true,
      canEdit: owner,
      canDelete: owner,
      canInvite: (owner || manager) && visibility !== 'private',
      canUpload: owner || manager || collaborator,
      canReparse: owner || manager || collaborator,
      canDownload:
        owner || manager || collaborator || member || allowPublicDownload,
      canManageKnowledgeBase: owner,
      canManageMembers: (owner || manager) && visibility !== 'private',
      canDeleteAnyDocument: owner || manager,
      canDeleteOwnDocument: owner || manager || collaborator,
      canReparseAnyDocument: owner || manager,
      canReparseOwnDocument: owner || manager || collaborator,
    };
  }

  private forbidden() {
    return new BusinessError(
      ErrorCode.KNOWLEDGE_FORBIDDEN,
      '无权访问该知识库',
      'forbidden',
    );
  }
}
