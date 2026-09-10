import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 应用运行时配置的类型化访问入口。
 *
 * 原始环境变量已由 validateEnvironment 校验和转换，因此这里使用 getOrThrow 尽早暴露
 * 装配错误，并按领域分组返回配置，避免业务代码依赖环境变量名称。
 */
@Injectable()
export class RuntimeConfig {
  constructor(private readonly config: ConfigService) {}

  get http() {
    return {
      host: this.config.getOrThrow<string>('HOST'),
      port: this.config.getOrThrow<number>('PORT'),
      origins: this.config
        .getOrThrow<string>('CORS_ORIGINS')
        .split(',')
        .map((s) => s.trim()),
    };
  }

  get databaseUrl() {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  get logLevel() {
    return this.config.getOrThrow<string>('LOG_LEVEL');
  }

  get redis() {
    return {
      url: this.config.getOrThrow<string>('REDIS_URL'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      keyPrefix: this.config.getOrThrow<string>('REDIS_KEY_PREFIX'),
    };
  }

  get mail() {
    return {
      enabled: this.config.getOrThrow<boolean>('EMAIL_ENABLED'),
      host: this.config.getOrThrow<string>('EMAIL_HOST'),
      port: this.config.getOrThrow<number>('EMAIL_PORT'),
      user: this.config.getOrThrow<string>('EMAIL_USER'),
      password: this.config.getOrThrow<string>('EMAIL_PASS'),
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
    };
  }

  get identity() {
    return {
      jwtSecret: this.config.getOrThrow<string>('JWT_SECRET'),
      accessTtlSeconds: this.config.getOrThrow<number>(
        'JWT_ACCESS_TTL_SECONDS',
      ),
      refreshTtlSeconds: this.config.getOrThrow<number>(
        'JWT_REFRESH_TTL_SECONDS',
      ),
      verificationSecret: this.config.getOrThrow<string>(
        'VERIFICATION_CODE_SECRET',
      ),
      verificationTtlSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_CODE_TTL_SECONDS',
      ),
      verificationCooldownSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_CODE_COOLDOWN_SECONDS',
      ),
      verificationIpLimitMax: this.config.getOrThrow<number>(
        'VERIFICATION_IP_LIMIT_MAX',
      ),
      verificationIpWindowSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_IP_WINDOW_SECONDS',
      ),
      loginRateLimitMax: this.config.getOrThrow<number>('LOGIN_RATE_LIMIT_MAX'),
      loginRateLimitWindowSeconds: this.config.getOrThrow<number>(
        'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      ),
    };
  }

  get avatar() {
    return {
      directory: this.config.getOrThrow<string>('AVATAR_STORAGE_DIR'),
      maxBytes: this.config.getOrThrow<number>('AVATAR_MAX_BYTES'),
    };
  }
}
