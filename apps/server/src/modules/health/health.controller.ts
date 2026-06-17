import { Controller, Get, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisCacheService } from '@common/cache/redis-cache.service';
import { ElasticsearchService } from '@common/vector/elasticsearch.service';

interface HealthCheckResult {
  status: 'ok' | 'error';
  message?: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly elasticsearch: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 存活探针 — 进程在运行即返回 200。
   */
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * 就绪探针 — 检查所有依赖服务的连接状态。
   * 任一关键服务不可用返回 503。
   */
  @Get('ready')
  async ready() {
    const [mysql, redis, qdrant, elasticsearch] = await Promise.allSettled([
      this.checkMySQL(),
      this.checkRedis(),
      this.checkQdrant(),
      this.checkElasticsearch(),
    ]);

    const checks = {
      mysql: this.extractResult(mysql),
      redis: this.extractResult(redis),
      qdrant: this.extractResult(qdrant),
      elasticsearch: this.extractResult(elasticsearch),
    };

    const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

    const response = {
      status: allHealthy ? ('ok' as const) : ('degraded' as const),
      timestamp: new Date().toISOString(),
      checks,
    };

    if (!allHealthy) {
      throw new HttpException(response, 503);
    }

    return response;
  }

  private async checkMySQL(): Promise<HealthCheckResult> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    const client = this.redis.getClient();
    const result = await client.ping();
    return result === 'PONG' ? { status: 'ok' } : { status: 'error', message: 'unexpected response' };
  }

  private async checkQdrant(): Promise<HealthCheckResult> {
    const qdrantUrl = this.configService.get<string>('QDRANT_URL');
    if (!qdrantUrl) {
      return { status: 'error', message: 'QDRANT_URL not configured' };
    }

    const response = await fetch(`${qdrantUrl}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });

    return response.ok
      ? { status: 'ok' }
      : { status: 'error', message: `HTTP ${response.status}` };
  }

  private async checkElasticsearch(): Promise<HealthCheckResult> {
    const ok = await this.elasticsearch.ping();
    return ok ? { status: 'ok' } : { status: 'error', message: 'ping failed' };
  }

  private extractResult(
    result: PromiseSettledResult<HealthCheckResult>,
  ): HealthCheckResult {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      status: 'error',
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  }
}
