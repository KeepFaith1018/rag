/**
 * 知识库可见性。
 */
export type KnowledgeBaseVisibility = "private" | "collaborative" | "public";

/**
 * 我的知识库列表归属视图。
 */
export type KnowledgeBaseOwnership = "owned" | "joined" | "all";

/**
 * 我的知识库排序方式。
 */
export type MineKnowledgeBaseSortBy =
  | "updated_desc"
  | "updated_asc"
  | "documents_desc"
  | "name_asc";

/**
 * 公开知识库排序方式。
 */
export type PublicKnowledgeBaseSortBy = "latest" | "hot";

/**
 * 知识库访问身份。
 */
export type KnowledgeBaseAccessRole =
  | "owner"
  | "manager"
  | "collaborator"
  | "member"
  | "publicVisitor";

/**
 * 共享知识库成员角色。
 */
export type KnowledgeBaseMemberRole = "manager" | "collaborator" | "member";

/**
 * 文档处理状态。
 */
export type KnowledgeBaseDocumentStatus =
  | "pending"
  | "uploaded"
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "ready"
  | "failed";

/**
 * 面向前端的知识库权限标记。
 */
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

/**
 * 通用分页结构。
 */
export interface PaginationPayload {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 知识库列表查询参数。
 */
export interface ListKnowledgeBasesQuery {
  ownership?: KnowledgeBaseOwnership;
  visibility?: KnowledgeBaseVisibility;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: MineKnowledgeBaseSortBy;
}

/**
 * 公开知识库列表查询参数。
 */
export interface ListPublicKnowledgeBasesQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: PublicKnowledgeBaseSortBy;
}

/**
 * 知识库列表项。
 */
export interface KnowledgeBaseListItem {
  id: string;
  name: string;
  description: string | null;
  visibility: KnowledgeBaseVisibility;
  allowPublicDownload: boolean;
  ownerId: string;
  documentCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  accessRole: KnowledgeBaseAccessRole;
  memberRole: KnowledgeBaseMemberRole | null;
  permissions: KnowledgeBasePermissions;
}

/**
 * 知识库详情。
 */
export interface KnowledgeBaseDetail extends KnowledgeBaseListItem {}

/**
 * 知识库列表响应。
 */
export interface KnowledgeBaseListResponse {
  list: KnowledgeBaseListItem[];
  pagination: PaginationPayload;
}

/**
 * 创建知识库参数。
 */
export interface CreateKnowledgeBasePayload {
  name: string;
  description?: string;
  visibility: KnowledgeBaseVisibility;
  allowPublicDownload?: boolean;
}

/**
 * 更新知识库参数。
 */
export interface UpdateKnowledgeBasePayload {
  name?: string;
  description?: string;
  visibility?: KnowledgeBaseVisibility;
  allowPublicDownload?: boolean;
}

/**
 * 成员列表项。
 */
export interface KnowledgeBaseMemberItem {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: "owner" | KnowledgeBaseMemberRole;
  accessRole: "owner" | KnowledgeBaseMemberRole;
  joinedAt: string | null;
  isCurrentUser: boolean;
}

/**
 * 成员列表响应。
 */
export interface KnowledgeBaseMemberListResponse {
  kbId: string;
  accessRole: "owner" | "manager";
  list: KnowledgeBaseMemberItem[];
}

/**
 * 邀请状态。
 */
export type KnowledgeBaseInvitationStatus =
  | "active"
  | "used"
  | "expired"
  | "cancelled";

/**
 * 邀请人信息。
 */
export interface KnowledgeBaseInvitationInviter {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * 邀请记录。
 */
export interface KnowledgeBaseInvitationItem {
  id: string;
  kbId: string;
  role: KnowledgeBaseMemberRole;
  status: KnowledgeBaseInvitationStatus;
  expiresAt: string;
  createdAt: string;
  cancelledAt: string | null;
  acceptedAt: string | null;
  inviter: KnowledgeBaseInvitationInviter;
}

/**
 * 邀请列表响应。
 */
export interface KnowledgeBaseInvitationListResponse {
  kbId: string;
  accessRole: "owner" | "manager";
  list: KnowledgeBaseInvitationItem[];
}

/**
 * 创建邀请参数。
 */
export interface CreateKnowledgeBaseInvitationPayload {
  role?: KnowledgeBaseMemberRole;
  expiredInHours?: number;
}

/**
 * 创建邀请响应。
 */
export interface CreateKnowledgeBaseInvitationResponse {
  id: string;
  kbId: string;
  inviteCode: string;
  role: KnowledgeBaseMemberRole;
  status: KnowledgeBaseInvitationStatus;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
  accessRole: "owner" | "manager";
}

/**
 * 通过邀请码加入知识库参数。
 */
export interface JoinKnowledgeBasePayload {
  inviteCode: string;
}

/**
 * 通过邀请码加入知识库返回。
 */
export interface JoinKnowledgeBaseResponse {
  kbId: string;
  joined: boolean;
  role: KnowledgeBaseMemberRole;
}

/**
 * 知识库级权限上下文。
 */
export interface KnowledgeBasePermissionContext {
  userId: string;
  kbId: string;
  accessRole: KnowledgeBaseAccessRole;
  permissions: KnowledgeBasePermissions;
  visibility: KnowledgeBaseVisibility;
}

/**
 * 文档列表查询参数。
 */
export interface ListKnowledgeBaseDocumentsQuery {
  keyword?: string;
  status?: KnowledgeBaseDocumentStatus;
  page?: number;
  pageSize?: number;
}

/**
 * 文档上传者。
 */
export interface KnowledgeBaseDocumentUploader {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * 文档处理任务项。
 */
export interface KnowledgeBaseDocumentProcessingTask {
  id: string;
  documentId: string;
  processingVersion: number;
  jobId: string | null;
  stage: string;
  status: string;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 文档处理概览。
 */
export interface KnowledgeBaseDocumentProcessingOverview {
  currentStage: string | null;
  currentProcessingVersion: number;
  retryCount: number;
  lastErrorCode: string | null;
  lastErrorStage: string | null;
  errorMessage: string | null;
  latestTask: KnowledgeBaseDocumentProcessingTask | null;
  latestFailedTask: KnowledgeBaseDocumentProcessingTask | null;
  currentVersionTaskCount: number;
  stageDurations: Array<{
    stage: string;
    status: string;
    attempt: number;
    durationMs: number | null;
  }>;
}

/**
 * 文档列表项与详情基础结构。
 */
export interface KnowledgeBaseDocumentItem {
  id: string;
  kbId: string;
  title: string;
  originalFilename: string;
  filePath: string;
  fileHash: string;
  fileSize: string;
  fileType: string;
  mimeType: string;
  status: KnowledgeBaseDocumentStatus | string;
  processingVersion: number;
  currentStage: string | null;
  lastErrorStage: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  errorMessage: string | null;
  tokenCount: number;
  chunkCount: number;
  parseStartedAt: string | null;
  parseFinishedAt: string | null;
  lastReparseAt: string | null;
  createdAt: string;
  updatedAt: string;
  uploader: KnowledgeBaseDocumentUploader | null;
}

/**
 * 文档列表响应。
 */
export interface KnowledgeBaseDocumentListResponse {
  kbId: string;
  kbPermission: KnowledgeBasePermissionContext;
  list: KnowledgeBaseDocumentItem[];
  pagination: PaginationPayload;
}

/**
 * 文档详情响应。
 */
export interface KnowledgeBaseDocumentDetail extends KnowledgeBaseDocumentItem {
  processingOverview: KnowledgeBaseDocumentProcessingOverview;
  recentProcessingTasks: KnowledgeBaseDocumentProcessingTask[];
  kbPermission: KnowledgeBasePermissionContext;
}
