import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { RedisService } from '../../../platform/redis/redis.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';

/** 对未登录认证入口按规范化邮箱和来源 IP 执行不暴露原值的固定窗口限流。 */
@Injectable()
export class IdentityRateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: RuntimeConfig,
  ) {}

  async assertLoginAllowed(email: string, ip: string) {
    const { loginRateLimitMax, loginRateLimitWindowSeconds } =
      this.config.identity;
    const [emailCount, ipCount] = await Promise.all([
      this.increment('login:email', email, loginRateLimitWindowSeconds),
      this.increment('login:ip', ip, loginRateLimitWindowSeconds),
    ]);
    if (emailCount > loginRateLimitMax || ipCount > loginRateLimitMax)
      throw new BusinessError(
        ErrorCode.RATE_LIMITED,
        '登录请求过于频繁',
        'rate-limit',
      );
  }

  async assertVerificationIpAllowed(ip: string) {
    const { verificationIpLimitMax, verificationIpWindowSeconds } =
      this.config.identity;
    const count = await this.increment(
      'verification:ip',
      ip,
      verificationIpWindowSeconds,
    );
    if (count > verificationIpLimitMax)
      throw new BusinessError(
        ErrorCode.VERIFICATION_RATE_LIMITED,
        '验证码发送过于频繁',
        'rate-limit',
      );
  }

  emailCooldownKey(email: string, purpose: number) {
    return `verification:cooldown:${purpose}:${this.digest(email)}`;
  }

  private increment(scope: string, value: string, ttlSeconds: number) {
    return this.redis.incrementWithExpiry(
      `rate:${scope}:${this.digest(value || 'unknown')}`,
      ttlSeconds,
    );
  }

  private digest(value: string) {
    return createHmac('sha256', this.config.identity.verificationSecret)
      .update(value)
      .digest('hex');
  }
}
