/**
 * 知识库访问身份标识。
 */
export type KnowledgeBaseAccessRole =
  | 'owner'
  | 'manager'
  | 'collaborator'
  | 'member'
  | 'publicVisitor';

/**
 * 共享知识库成员角色。
 */
export type KnowledgeBaseMemberRole = 'manager' | 'collaborator' | 'member';

/**
 * 面向前端的知识库权限标记集合。
 */
export interface KnowledgeBasePermissionFlags {
  canView: boolean;
  canAsk: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canInvite: boolean;
  canUpload: boolean;
  canReparse: boolean;
  canDownload: boolean;
  canManageKnowledgeBase: boolean;
  canManageMembers: boolean;
  canDeleteAnyDocument: boolean;
  canDeleteOwnDocument: boolean;
  canReparseAnyDocument: boolean;
  canReparseOwnDocument: boolean;
}
