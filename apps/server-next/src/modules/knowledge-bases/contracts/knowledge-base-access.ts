/** 知识库对非所有者开放内容的方式。 */
export type KnowledgeBaseVisibility = 'private' | 'collaborative' | 'public';

/** 可持久化到成员表的角色；所有者由知识库 owner_id 表示。 */
export type KnowledgeBaseMemberRole = 'manager' | 'collaborator' | 'member';

/** 当前访问者在知识库中的有效身份，包括未加入的公开访客。 */
export type KnowledgeBaseAccessRole =
  | 'owner'
  | KnowledgeBaseMemberRole
  | 'publicVisitor';

/** 返回给客户端的细粒度能力集合，供界面展示与操作入口控制。 */
export interface KnowledgeBasePermissions {
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
