import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EVAL_QUEUE_NAME, EVAL_JOB_NAME } from '../constants/eval-queue.constants';

export interface EvalJobPayload {
  runId: string;
}

@Injectable()
export class EvalQueueService implements OnModuleDestroy {
  private readonly queue: Queue<EvalJobPayload>;

  constructor(private readonly configService: ConfigService) {
    const connection = this.buildRedisConnection();
    this.queue = new Queue<EvalJobPayload>(EVAL_QUEUE_NAME, { connection });
  }

  async enqueueEvaluation(runId: string) {
    await this.queue.add(EVAL_JOB_NAME, { runId }, {
      jobId: `eval-${runId}`,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 200,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  private buildRedisConnection() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) return { host: 'localhost', port: 6379 };

    const parsed = new URL(redisUrl);
    const password =
      this.configService.get<string>('REDIS_PASSWORD') ||
      (parsed.password ? decodeURIComponent(parsed.password) : undefined);

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      password,
      db: parsed.pathname?.slice(1) ? Number(parsed.pathname.slice(1)) : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }
}
