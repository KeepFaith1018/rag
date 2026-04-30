import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import {
  DOCUMENT_PROCESSING_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
} from '../document-processing.constants';
import { buildDocumentProcessingRedisConnection } from '../queue/document-queue.service';
import { DocumentProcessingService } from '../services/document-processing.service';
import { DocumentProcessingJobPayload } from '../document-processing-job.interface';

/**
 * 负责承接文档异步处理消费入口。
 */
@Injectable()
export class DocumentProcessingProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private worker?: Worker<DocumentProcessingJobPayload>;

  constructor(
    private readonly configService: ConfigService,
    private readonly documentProcessingService: DocumentProcessingService,
  ) {}

  /**
   * 第二阶段启用同进程 Worker，消费文档处理任务。
   */
  async process(job: Job<DocumentProcessingJobPayload>) {
    await this.documentProcessingService.processDocument(
      job.data,
      job.attemptsMade + 1,
      typeof job.id === 'string' ? job.id : String(job.id),
    );
  }

  async onModuleInit() {
    this.worker = new Worker<DocumentProcessingJobPayload>(
      DOCUMENT_PROCESSING_QUEUE_NAME,
      async (job) => {
        if (job.name !== DOCUMENT_PROCESSING_JOB_NAME) {
          return;
        }

        await this.process(job);
      },
      {
        connection: buildDocumentProcessingRedisConnection(this.configService),
        concurrency: 1,
      },
    );
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
