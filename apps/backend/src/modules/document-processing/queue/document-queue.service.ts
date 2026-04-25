import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import {
  DOCUMENT_PROCESSING_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
} from '../constants/document-processing.constants';
import { DocumentProcessingJobPayload } from '../interfaces/document-processing-job.interface';

type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

/**
 * 统一构造文档处理队列与 Worker 共用的 Redis 连接配置。
 */
export function buildDocumentProcessingRedisConnection(
  configService: ConfigService,
): RedisConnectionOptions {
  const redisUrl = configService.get<string>('REDIS_URL');
  if (!redisUrl) {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Redis 配置缺失，无法初始化文档处理队列',
    );
  }

  try {
    const parsed = new URL(redisUrl);
    const pathname = parsed.pathname.startsWith('/')
      ? parsed.pathname.slice(1)
      : parsed.pathname;
    const databaseIndex = pathname ? Number(pathname) : undefined;
    const port = parsed.port ? Number(parsed.port) : 6379;
    const password =
      configService.get<string>('REDIS_PASSWORD') ||
      (parsed.password ? decodeURIComponent(parsed.password) : undefined);

    return {
      host: parsed.hostname,
      port,
      username: parsed.username
        ? decodeURIComponent(parsed.username)
        : undefined,
      password,
      db:
        typeof databaseIndex === 'number' && !Number.isNaN(databaseIndex)
          ? databaseIndex
          : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Redis 连接地址格式不正确，无法初始化文档处理队列',
    );
  }
}

/**
 * 负责封装文档处理队列入队逻辑。
 */
@Injectable()
export class DocumentQueueService implements OnModuleDestroy {
  private readonly queue: Queue<DocumentProcessingJobPayload>;

  constructor(private readonly configService: ConfigService) {
    this.queue = new Queue<DocumentProcessingJobPayload>(
      DOCUMENT_PROCESSING_QUEUE_NAME,
      {
        connection: buildDocumentProcessingRedisConnection(this.configService),
      },
    );
  }

  /**
   * 将指定文档处理任务投递到 BullMQ 队列。
   */
  async enqueueDocumentProcessing(payload: DocumentProcessingJobPayload) {
    await this.queue.add(DOCUMENT_PROCESSING_JOB_NAME, payload, {
      jobId: this.buildJobId(payload.documentId, payload.processingVersion),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  /**
   * 统一生成文档处理任务主键，避免同文档同版本重复入队。
   */
  buildJobId(documentId: string, processingVersion: number) {
    return `doc-${documentId}-v-${processingVersion}`;
  }
  async onModuleDestroy() {
    await this.queue.close();
  }
}
