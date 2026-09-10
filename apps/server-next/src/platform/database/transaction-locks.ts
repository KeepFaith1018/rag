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
