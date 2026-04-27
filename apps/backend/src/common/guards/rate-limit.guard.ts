import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * 简单内存限流实现。
 *
 * 生产环境建议使用 Redis + Lua 脚本实现分布式限流。
 * 这里采用滑动窗口算法，限制每个用户每分钟的最大请求数。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly requests = new Map<string, number[]>();

  constructor(windowMs = 60_000, maxRequests = 30) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      return true;
    }

    const key = `rate:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // 获取该用户的请求时间戳列表
    const timestamps = this.requests.get(key) || [];

    // 清理过期的 timestamps
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      throw new HttpException(
        {
          success: false,
          code: 42900,
          message: '请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 添加当前请求时间戳
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);

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
  private readonly requests = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      return true;
    }

    const key = `stream:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const timestamps = this.requests.get(key) || [];
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      throw new HttpException(
        {
          success: false,
          code: 42901,
          message: '流式请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);

    return true;
  }
}
