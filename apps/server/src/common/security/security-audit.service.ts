import { Injectable, Inject } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

/**
 * 安全事件审计日志服务。
 *
 * 记录登录失败、权限拒绝、token 重放、限流触发等安全事件。
 * 纯 Winston 结构化日志，不建数据库表，后续可接入 ELK/Grafana Loki。
 */
@Injectable()
export class SecurityAuditService {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  logLoginFailure(
    email: string,
    reason: string,
    context?: Record<string, unknown>,
  ) {
    this.logger.warn('[SECURITY] Login failure', {
      event: 'LOGIN_FAILURE',
      email,
      reason,
      ...context,
    });
  }

  logPermissionDenied(
    userId: string,
    resource: string,
    action: string,
  ) {
    this.logger.warn('[SECURITY] Permission denied', {
      event: 'PERMISSION_DENIED',
      userId,
      resource,
      action,
    });
  }

  logTokenReplay(userId: string, sessionId: string) {
    this.logger.warn('[SECURITY] Token replay detected', {
      event: 'TOKEN_REPLAY',
      userId,
      sessionId,
    });
  }

  logRateLimitExceeded(userId: string, endpoint: string) {
    this.logger.warn('[SECURITY] Rate limit exceeded', {
      event: 'RATE_LIMIT_EXCEEDED',
      userId,
      endpoint,
    });
  }
}
