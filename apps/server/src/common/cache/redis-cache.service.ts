import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

/**
 * 基于 Redis 的通用键值缓存服务。
 *
 * 接入方式：复用项目已有 Redis 实例（REDIS_URL / REDIS_PASSWORD），
 * 通过 lazyConnect + try-catch 包裹所有操作，保证 Redis 不可用时不影响业务主流程。
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly defaultTTL = 30 * 24 * 3600; // 30 天

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    const url = this.configService.get<string>('REDIS_URL');
    const password = this.configService.get<string>('REDIS_PASSWORD');

    this.client = new Redis(url!, {
      password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.connect().catch((err: unknown) => {
      this.logger.warn(`[RedisCache] 连接失败，缓存不可用: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(`[RedisCache] get 失败: ${error}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds ?? this.defaultTTL);
    } catch (error) {
      this.logger.warn(`[RedisCache] set 失败: ${error}`);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
