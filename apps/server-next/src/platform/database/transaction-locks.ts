import type { Prisma } from '../../../prisma/generated/client';

/**
 * 认证事务统一先锁用户行，再读写会话或验证码，避免改密、登录与刷新交错后留下漏撤销会话。
 */
export async function lockUserById(
  tx: Prisma.TransactionClient,
  userId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_users WHERE id = ${userId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** 按规范化邮箱锁定已有用户；注册不存在的邮箱仍由唯一索引承担最终并发约束。 */
export async function lockUserByEmail(
  tx: Prisma.TransactionClient,
  email: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_users WHERE email = ${email} FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

/**
 * 修改知识库、成员或邀请前统一锁知识库行，使可见性、权限与邀请消费基于同一串行化边界。
 */
export async function lockKnowledgeBaseById(
  tx: Prisma.TransactionClient,
  kbId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_knowledge_bases WHERE id = ${kbId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** Complete 登记前锁上传会话，保证不确定结果恢复与客户端重试只创建一个 document。 */
export async function lockUploadSessionById(
  tx: Prisma.TransactionClient,
  sessionId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_upload_sessions WHERE id = ${sessionId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** 发布/删除切换 active run 前锁文档行，与并发发布、删除竞争共享同一串行化边界。 */
export async function lockDocumentById(
  tx: Prisma.TransactionClient,
  documentId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_documents WHERE id = ${documentId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** 发布前锁 processing run 行，固定 knowledge_base → document → run 的加锁顺序。 */
export async function lockProcessingRunById(
  tx: Prisma.TransactionClient,
  runId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_document_processing_runs WHERE id = ${runId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** 任务终态回写前锁定 task；调用方必须先锁 processing run，统一保持 run → task 顺序。 */
export async function lockProcessingTaskById(
  tx: Prisma.TransactionClient,
  taskId: bigint,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM b_document_processing_tasks WHERE id = ${taskId} FOR UPDATE
  `;
  return rows.length === 1;
}
