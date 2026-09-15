import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { RuntimeConfig } from '../config/runtime-config.service';

/** Pub/Sub 使用独立 publisher/subscriber，subscriber 进入订阅模式后不执行普通命令。 */
@Injectable()
export class ProcessingPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Map<
    string,
    Set<(message: string) => void>
  >();

  constructor(private readonly runtime: RuntimeConfig) {
    const options = {
      password: runtime.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 2000,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5000),
    };
    this.publisher = new Redis(runtime.redis.url, options);
    this.subscriber = new Redis(runtime.redis.url, {
      ...options,
      retryStrategy: (attempt: number) => Math.min(attempt * 1000, 10000),
    });
    this.subscriber.on('message', (topic, message) => {
      for (const listener of this.listeners.get(topic) ?? []) listener(message);
    });
  }

  async onModuleInit() {
    await Promise.allSettled([
      this.publisher.connect(),
      this.subscriber.connect(),
    ]);
  }

  async publish(channel: string, message: string) {
    try {
      await this.publisher.publish(channel, message);
    } catch {
      // 处理状态已经在 MySQL 提交；通知丢失由 REST 快照和轮询收敛。
    }
  }

  async subscribe(channel: string, onMessage: (message: string) => void) {
    const listeners = this.listeners.get(channel) ?? new Set();
    const first = listeners.size === 0;
    listeners.add(onMessage);
    this.listeners.set(channel, listeners);
    if (first) await this.subscriber.subscribe(channel);
    return async () => this.unsubscribe(channel, onMessage);
  }

  async unsubscribe(channel: string, onMessage?: (message: string) => void) {
    const listeners = this.listeners.get(channel);
    if (!listeners) return;
    if (onMessage) listeners.delete(onMessage);
    else listeners.clear();
    if (listeners.size === 0) {
      this.listeners.delete(channel);
      await this.subscriber.unsubscribe(channel);
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.publisher.status === 'ready'
        ? this.publisher.quit()
        : Promise.resolve(),
      this.subscriber.status === 'ready'
        ? this.subscriber.quit()
        : Promise.resolve(),
    ]);
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
