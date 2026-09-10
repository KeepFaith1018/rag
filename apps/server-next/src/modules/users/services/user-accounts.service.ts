import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';

type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * 用户账户数据访问边界，集中处理邮箱规范化、有效账号检查和公开资料映射。
 */
@Injectable()
export class UserAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string, db: DbClient = this.prisma) {
    return db.b_users.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  findById(id: bigint, db: DbClient = this.prisma) {
    return db.b_users.findUnique({ where: { id } });
  }

  async requireActiveById(id: bigint, db: DbClient = this.prisma) {
    const user = await db.b_users.findFirst({
      where: { id, is_active: true, deleted_at: null },
    });
    if (!user)
      throw new BusinessError(ErrorCode.FORBIDDEN, '账号不可用', 'forbidden');
    return user;
  }

  createVerified(
    input: { email: string; passwordHash: string; fullName: string },
    db: DbClient,
  ) {
    return db.b_users.create({
      data: {
        email: input.email.trim().toLowerCase(),
        password_hash: input.passwordHash,
        full_name: input.fullName,
        email_verified_at: new Date(),
      },
    });
  }

  updatePassword(userId: bigint, passwordHash: string, db: DbClient) {
    return db.b_users.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });
  }

  buildProfile(user: {
    id: bigint;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  }) {
    // 只映射允许离开账户边界的字段，避免意外暴露密码摘要等数据库列。
    return {
      id: user.id.toString(),
      email: user.email,
      username: user.full_name ?? user.email,
      avatar: user.avatar_url,
      roles: ['user'],
    };
  }
}
