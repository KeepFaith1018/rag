import {
  KnowledgeBaseAccessRole,
  KnowledgeBasePermissionFlags,
} from './knowledge-base-access.interface';

/**
 * 知识库权限动作定义。
 * 该模型既覆盖当前成员管理，也预留文档管理和问答等后续模块复用。
 */
export type KbPermissionAction =
  | 'read'
  | 'ask'
  | 'manageKnowledgeBase'
  | 'manageMembers'
  | 'uploadDocument'
  | 'downloadDocument'
  | 'deleteAnyDocument'
  | 'deleteOwnDocument'
  | 'reparseAnyDocument'
  | 'reparseOwnDocument';

/**
 * 声明式权限装饰器的元数据结构。
 */
export interface KbPermissionRequirement {
  action: KbPermissionAction;
  kbIdParam?: string;
}

/**
 * Guard 校验成功后可挂载到请求上下文中的权限快照。
 */
export interface KbPermissionContext {
  userId: string;
  kbId: string;
  accessRole: KnowledgeBaseAccessRole;
  permissions: KnowledgeBasePermissionFlags;
  visibility: 'private' | 'shared';
}
