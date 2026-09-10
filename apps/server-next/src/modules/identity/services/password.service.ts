import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  lockUserByEmail,
  lockUserById,
} from '../../../platform/database/transaction-locks';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { UserAccountsService } from '../../users/services/user-accounts.service';
import { VerificationPurpose } from '../dto/identity.dto';
import { VerificationService } from './verification.service';

/** 处理密码变更与找回，并在密码更新后撤销全部既有会话。 */
@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserAccountsService,
    private readonly verification: VerificationService,
  ) {}

  async change(userId: bigint, oldPassword: string, newPassword: string) {
    const passwordHash = await hash(newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      if (!(await lockUserById(tx, userId)))
        throw new BusinessError(ErrorCode.FORBIDDEN, '账号不可用', 'forbidden');
      const user = await this.users.requireActiveById(userId, tx);
      if (!(await compare(oldPassword, user.password_hash)))
        throw new BusinessError(
          ErrorCode.AUTH_INVALID_CREDENTIALS,
          '原密码错误',
          'unauthenticated',
        );
      if (await compare(newPassword, user.password_hash))
        throw new BusinessError(
          ErrorCode.PARAM_ERROR,
          '新密码不能与原密码相同',
          'validation',
        );
      await this.users.updatePassword(userId, passwordHash, tx);
      await tx.b_user_sessions.updateMany({
        where: { user_id: userId, revoked: false },
        data: { revoked: true, revoked_at: new Date() },
      });
    });
    return { message: '密码修改成功，请重新登录' };
  }

  async reset(email: string, code: string, newPassword: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hash(newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      await lockUserByEmail(tx, normalizedEmail);
      const user = await this.users.findByEmail(normalizedEmail, tx);
      if (!user || user.deleted_at)
        throw new BusinessError(
          ErrorCode.AUTH_USER_NOT_FOUND,
          '用户不存在',
          'not-found',
        );
      await this.verification.consume(
        normalizedEmail,
        VerificationPurpose.RESET_PASSWORD,
        code,
        tx,
      );
      await this.users.updatePassword(user.id, passwordHash, tx);
      await tx.b_user_sessions.updateMany({
        where: { user_id: user.id, revoked: false },
        data: { revoked: true, revoked_at: new Date() },
      });
    });
    return { message: '密码重置成功' };
  }
}
