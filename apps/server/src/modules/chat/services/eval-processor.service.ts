import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { EVAL_QUEUE_NAME, EVAL_JOB_NAME } from '../constants/eval-queue.constants';
import { EvalPipelineService } from './eval-pipeline.service';
import type { EvalJobPayload } from './eval-queue.service';

@Injectable()
export class EvalProcessorService implements OnModuleInit, OnModuleDestroy {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger!: Logger;
  private worker?: Worker<EvalJobPayload>;

  constructor(
    private readonly configService: ConfigService,
    private readonly evalPipeline: EvalPipelineService,
  ) {}

  onModuleInit() {
    const connection = this.buildRedisConnection();
    this.worker = new Worker<EvalJobPayload>(
      EVAL_QUEUE_NAME,
      async (job: Job<EvalJobPayload>) => {
        if (job.name !== EVAL_JOB_NAME) return;
        this.logger.info(`[EvalProcessor] 开始评估 runId=${job.data.runId}`);
        try {
          const metrics = await this.evalPipeline.evaluate(job.data.runId);
          this.logger.info(
            `[EvalProcessor] 评估完成 runId=${job.data.runId} ` +
            `faithfulness=${metrics.faithfulness?.score ?? 'N/A'} ` +
            `relevancy=${metrics.answerRelevancy?.score ?? 'N/A'} ` +
            `recall=${metrics.contextRecall?.score ?? 'N/A'}`,
          );
        } catch (err) {
          this.logger.error(`[EvalProcessor] 评估失败 runId=${job.data.runId}: ${err}`);
          throw err;
        }
      },
      {
        connection,
        concurrency: 2,
      },
    );
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
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
