import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { RuntimeConfig } from '../config/runtime-config.service';
import { DOCUMENT_PROCESSING_QUEUE } from './queue.constants';

export interface ProcessingJobPayload {
  schemaVersion: 0 | 1;
  taskId: string;
  processingRunId: string;
  attemptNo: number;
}

/** BullMQ Producer 专用连接；不复用普通 RedisService，也不设置 ioredis keyPrefix。 */
@Injectable()
export class ProcessingQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<ProcessingJobPayload>;

  constructor(private readonly runtime: RuntimeConfig) {
    const redis = runtime.redis;
    this.connection = new Redis(redis.url, {
      password: redis.password,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    this.queue = new Queue<ProcessingJobPayload>(DOCUMENT_PROCESSING_QUEUE, {
      connection: this.connection,
      prefix: runtime.queue.bullmqPrefix,
    });
    // BullMQ 会把底层 Redis 连接错误转发到 Queue 的 error 事件；未监听时 Node 会当作
    // 未处理异常抛出，导致进程在关闭或 Redis 短暂不可用时崩溃。
    this.queue.on('error', () => undefined);
  }

  async onModuleInit() {
    try {
      await this.connection.connect();
    } catch {
      // Outbox 调度器按 MySQL 事件重试，不在启动时阻塞 API。
    }
  }

  async add(payload: ProcessingJobPayload) {
    assertProcessingJobPayload(payload);
    const jobId = `task-${payload.taskId}-attempt-${payload.attemptNo}`;
    return this.queue.add('process-document-task', payload, {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    });
  }

  async hasJob(jobId: string) {
    return !!(await this.queue.getJob(jobId));
  }

  async remove(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove();
  }

  async onModuleDestroy() {
    // 先断开底层连接并让微任务 flush，使 BullMQ 内部 RedisConnection 的初始化在仍有
    // error 监听者时 settle；否则 close 会在移除监听后异步触发 "Connection is closed."。
    if (this.connection.status === 'ready') await this.connection.quit();
    else this.connection.disconnect();
    await new Promise((resolve) => setImmediate(resolve));
    await this.queue.close();
  }
}

function assertProcessingJobPayload(payload: ProcessingJobPayload) {
  if (
    ![0, 1].includes(payload.schemaVersion) ||
    !/^\d+$/.test(payload.taskId) ||
    !/^\d+$/.test(payload.processingRunId) ||
    !Number.isInteger(payload.attemptNo) ||
    payload.attemptNo < 1
  )
    throw new Error('PROCESSING_JOB_PAYLOAD_INVALID');
}
