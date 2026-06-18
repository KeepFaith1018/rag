import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { JwtUser } from '@app/modules/auth/interface/jwtUser';
import { RedisCacheService } from '@common/cache/redis-cache.service';

/**
 * 基于 Redis 滑动窗口的限流 Guard。
 *
 * 使用 Redis sorted set 实现：
 * - ZREMRANGEBYSCORE 清理过期时间戳
 * - ZCARD 计算窗口内请求数
 * - ZADD 添加当前请求
 * 通过 MULTI 事务保证原子性。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(
    private readonly redis: RedisCacheService,
    windowMs = 60_000,
    maxRequests = 30,
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const userId = request.user?.sub;

    if (!userId) {
      return true;
    }

    const key = `rate:user:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const ttlSeconds = Math.ceil(this.windowMs / 1000) + 1;

    const client = this.redis.getClient();
    const multi = client.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);
    multi.zadd(key, now, `${now}:${randomUUID()}`);
    multi.expire(key, ttlSeconds);

    const results = await multi.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= this.maxRequests) {
      throw new HttpException(
        {
          success: false,
          code: 42900,
          message: '请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

/**
 * 流式请求专用限流 Guard。
 *
 * 由于流式请求持续时间长，采用更宽松的限流策略：
 * - 每分钟最多 10 次流式请求
 */
@Injectable()
export class StreamRateLimitGuard implements CanActivate {
  private readonly windowMs = 60_000;
  private readonly maxRequests = 10;

  constructor(private readonly redis: RedisCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const userId = request.user?.sub;

    if (!userId) {
      return true;
    }

    const key = `rate:stream:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const ttlSeconds = Math.ceil(this.windowMs / 1000) + 1;

    const client = this.redis.getClient();
    const multi = client.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);
    multi.zadd(key, now, `${now}:${randomUUID()}`);
    multi.expire(key, ttlSeconds);

    const results = await multi.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= this.maxRequests) {
      throw new HttpException(
        {
          success: false,
          code: 42901,
          message: '流式请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
