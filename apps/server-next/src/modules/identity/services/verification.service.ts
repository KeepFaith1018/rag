import { Injectable } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import type { Prisma } from '../../../../prisma/generated/client';
import { MailService } from '../../../platform/mail/mail.service';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RedisService } from '../../../platform/redis/redis.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { UserAccountsService } from '../../users/services/user-accounts.service';
import { VerificationPurpose } from '../dto/identity.dto';
import { IdentityRateLimitService } from './identity-rate-limit.service';

/** 管理邮箱验证码的发送限流、持久化签名与一次性消费。 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: RuntimeConfig,
    private readonly users: UserAccountsService,
    private readonly rateLimit: IdentityRateLimitService,
  ) {}

  async send(emailInput: string, purpose: VerificationPurpose, ip: string) {
    const email = emailInput.trim().toLowerCase();
    await this.rateLimit.assertVerificationIpAllowed(ip);
    const user = await this.users.findByEmail(email);
    if (purpose === VerificationPurpose.REGISTER && user)
      throw new BusinessError(
        ErrorCode.AUTH_USER_EXISTS,
        '该邮箱已注册',
        'conflict',
      );
    if (purpose !== VerificationPurpose.REGISTER && (!user || user.deleted_at))
      throw new BusinessError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        '用户不存在',
        'not-found',
      );

    const cooldownKey = this.rateLimit.emailCooldownKey(email, purpose);
    if (
      !(await this.redis.setIfAbsent(
        cooldownKey,
        '1',
        this.config.identity.verificationCooldownSeconds,
      ))
    )
      throw new BusinessError(
        ErrorCode.VERIFICATION_RATE_LIMITED,
        '验证码发送过于频繁',
        'rate-limit',
      );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    try {
      // 先确认邮件发送成功再落库，避免留下用户从未收到却仍然有效的验证码记录。
      await this.mail.send({
        to: email,
        subject: '灵索智能验证码',
        text: `您的验证码是 ${code}，请在 ${Math.ceil(this.config.identity.verificationTtlSeconds / 60)} 分钟内使用。`,
      });
      await this.prisma.sys_email_codes.create({
        data: {
          email,
          purpose,
          code_hash: this.hash(email, purpose, code),
          expired_at: new Date(
            Date.now() + this.config.identity.verificationTtlSeconds * 1000,
          ),
        },
      });
    } catch (error) {
      await this.redis.delete(cooldownKey).catch(() => undefined);
      throw error;
    }
    return { message: '验证码发送成功' };
  }

  async consume(
    emailInput: string,
    purpose: VerificationPurpose,
    code: string,
    db: Prisma.TransactionClient,
  ) {
    const email = emailInput.trim().toLowerCase();
    const record = await db.sys_email_codes.findFirst({
      where: { email, purpose, used: false, expired_at: { gt: new Date() } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    if (!record || record.code_hash !== this.hash(email, purpose, code))
      throw new BusinessError(
        ErrorCode.VERIFICATION_INVALID,
        '验证码无效或已过期',
        'validation',
      );
    const consumed = await db.sys_email_codes.updateMany({
      where: {
        id: record.id,
        used: false,
        expired_at: { gt: new Date() },
      },
      data: { used: true },
    });
    // 条件更新承担并发控制：同一验证码只能被一个事务成功消费。
    if (consumed.count !== 1)
      throw new BusinessError(
        ErrorCode.VERIFICATION_INVALID,
        '验证码无效或已使用',
        'validation',
      );
  }

  private hash(email: string, purpose: number, code: string) {
    // HMAC 避免数据库泄露后可离线还原六位验证码，并绑定邮箱及业务用途。
    return createHmac('sha256', this.config.identity.verificationSecret)
      .update(`${purpose}:${email}:${code}`)
      .digest('hex');
  }
}
