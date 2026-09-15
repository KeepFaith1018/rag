import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { RuntimeConfig } from '../config/runtime-config.service';
import { AppLogger } from '../observability/app-logger.service';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  constructor(
    config: RuntimeConfig,
    private readonly logger: AppLogger,
  ) {
    const settings = config.redis;
    this.client = new Redis(settings.url, {
      password: settings.password,
      keyPrefix: settings.keyPrefix,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    this.client.on('error', () =>
      this.logger.warn('Redis connection unavailable'),
    );
  }
  async onModuleInit() {
    try {
      await this.client.connect();
    } catch {
      this.logger.warn(
        'Redis initial connection failed; readiness remains unavailable',
      );
    }
  }
  async ping(): Promise<void> {
    await this.client.ping();
  }
  async assertNoEviction(): Promise<void> {
    const rows = (await this.client.config(
      'GET',
      'maxmemory-policy',
    )) as string[];
    if (rows[1] !== 'noeviction')
      throw new Error('Redis maxmemory-policy must be noeviction for BullMQ');
  }
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      throw this.unavailable();
    }
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1)
      throw new Error('TTL must be a positive integer');
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      throw this.unavailable();
    }
  }
  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1)
      throw new Error('TTL must be a positive integer');
    try {
      return (
        (await this.client.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK'
      );
    } catch {
      throw this.unavailable();
    }
  }
  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1)
      throw new Error('TTL must be a positive integer');
    try {
      const results = await this.client
        .multi()
        .incr(key)
        .expire(key, ttlSeconds, 'NX')
        .exec();
      const count = results?.[0]?.[1];
      if (typeof count !== 'number') throw new Error('Invalid Redis counter');
      return count;
    } catch {
      throw this.unavailable();
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      throw this.unavailable();
    }
  }
  private unavailable() {
    return new BusinessError(
      ErrorCode.SERVICE_UNAVAILABLE,
      '缓存服务暂不可用',
      'unavailable',
    );
  }
  async onModuleDestroy() {
    try {
      if (this.client.status === 'ready') await this.client.quit();
    } finally {
      this.client.disconnect();
    }
  }
}
