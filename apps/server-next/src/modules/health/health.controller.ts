import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';
import { Public } from '../identity/http/public.decorator';

/** 提供编排系统使用的存活与就绪探针；探针本身无需认证。 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 仅说明 API 进程仍可响应，不探测外部依赖。 */
  @Get('live')
  live() {
    return { status: 'ok', application: 'server-next', process: 'api' };
  }

  /** 数据库和 Redis 均可用时才报告就绪。 */
  @Get('ready')
  async ready() {
    const results = await Promise.allSettled([
      this.database.ping(),
      this.redis.ping(),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new BusinessError(
        ErrorCode.SERVICE_UNAVAILABLE,
        '基础依赖尚未就绪',
        'unavailable',
      );
    }
    return { status: 'ok', checks: { database: 'up', redis: 'up' } };
  }
}
