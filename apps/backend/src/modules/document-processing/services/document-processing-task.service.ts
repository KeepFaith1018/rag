import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  DOCUMENT_PROCESSING_TASK_STATUS,
  DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE,
} from '../constants/document-processing.constants';

/**
 * 负责管理文档处理阶段任务记录与耗时统计。
 */
@Injectable()
export class DocumentProcessingTaskService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 在阶段开始时创建或重置任务记录。
   */
  async startStageTask(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    attempt: number;
    jobId?: string;
  }) {
    const now = new Date();
    const existingTask = await this.findStageTask(options);

    if (existingTask) {
      await this.prisma.b_document_processing_tasks.update({
        where: {
          id: existingTask.id,
        },
        data: {
          job_id: options.jobId,
          status: DOCUMENT_PROCESSING_TASK_STATUS.RUNNING,
          error_code: null,
          error_message: null,
          started_at: now,
          finished_at: null,
          duration_ms: null,
          heartbeat_at: now,
          updated_at: now,
        },
      });
    } else {
      await this.prisma.b_document_processing_tasks.create({
        data: {
          document_id: options.documentId,
          processing_version: options.processingVersion,
          job_id: options.jobId,
          stage: options.stage,
          status: DOCUMENT_PROCESSING_TASK_STATUS.RUNNING,
          attempt: options.attempt,
          started_at: now,
          heartbeat_at: now,
          updated_at: now,
        },
      });
    }

    this.logger.info('[DocumentProcessingTaskStarted]', {
      documentId: options.documentId.toString(),
      processingVersion: options.processingVersion,
      stage: options.stage,
      attempt: options.attempt,
      jobId: options.jobId,
    });
  }

  /**
   * 在阶段执行中刷新任务心跳时间。
   */
  async touchStageTask(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    attempt: number;
  }) {
    const existingTask = await this.findStageTask(options);
    if (!existingTask) {
      return;
    }

    await this.prisma.b_document_processing_tasks.update({
      where: {
        id: existingTask.id,
      },
      data: {
        heartbeat_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在阶段成功完成时记录结束时间与耗时。
   */
  async completeStageTask(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    attempt: number;
  }) {
    const existingTask = await this.findStageTask(options);
    if (!existingTask) {
      return;
    }

    const now = new Date();
    await this.prisma.b_document_processing_tasks.update({
      where: {
        id: existingTask.id,
      },
      data: {
        status: DOCUMENT_PROCESSING_TASK_STATUS.COMPLETED,
        finished_at: now,
        duration_ms: this.calculateDurationMs(existingTask.started_at, now),
        heartbeat_at: now,
        updated_at: now,
      },
    });

    this.logger.info('[DocumentProcessingTaskCompleted]', {
      taskId: existingTask.id.toString(),
      documentId: options.documentId.toString(),
      processingVersion: options.processingVersion,
      stage: options.stage,
      attempt: options.attempt,
      durationMs: this.calculateDurationMs(existingTask.started_at, now),
    });
  }

  /**
   * 在阶段失败时记录失败原因与耗时。
   */
  async failStageTask(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    attempt: number;
    errorCode: string;
    errorMessage: string;
    status?: string;
  }) {
    const existingTask = await this.findStageTask(options);
    if (!existingTask) {
      return;
    }

    const now = new Date();
    const finalStatus = options.status || DOCUMENT_PROCESSING_TASK_STATUS.FAILED;
    await this.prisma.b_document_processing_tasks.update({
      where: {
        id: existingTask.id,
      },
      data: {
        status: finalStatus,
        error_code: options.errorCode,
        error_message: options.errorMessage,
        finished_at: now,
        duration_ms: this.calculateDurationMs(existingTask.started_at, now),
        heartbeat_at: now,
        updated_at: now,
      },
    });

    this.logger.warn('[DocumentProcessingTaskFailed]', {
      taskId: existingTask.id.toString(),
      documentId: options.documentId.toString(),
      processingVersion: options.processingVersion,
      stage: options.stage,
      attempt: options.attempt,
      status: finalStatus,
      errorCode: options.errorCode,
      errorMessage: options.errorMessage,
    });
  }

  /**
   * 查询所有已超时但仍处于 running 状态的阶段任务。
   */
  async findTimedOutRunningTasks(timeoutMs: number) {
    const deadline = new Date(Date.now() - timeoutMs);
    return this.prisma.b_document_processing_tasks.findMany({
      where: {
        status: DOCUMENT_PROCESSING_TASK_STATUS.RUNNING,
        OR: [
          {
            heartbeat_at: {
              lte: deadline,
            },
          },
          {
            heartbeat_at: null,
            started_at: {
              lte: deadline,
            },
          },
        ],
      },
      orderBy: {
        started_at: 'asc',
      },
    });
  }

  /**
   * 将超时任务标记为 timed_out。
   */
  async markTaskTimedOut(options: {
    taskId: bigint;
    errorMessage: string;
  }) {
    const task = await this.prisma.b_document_processing_tasks.findUnique({
      where: {
        id: options.taskId,
      },
    });
    if (!task) {
      return null;
    }

    const now = new Date();
    const updatedTask = await this.prisma.b_document_processing_tasks.update({
      where: {
        id: options.taskId,
      },
      data: {
        status: DOCUMENT_PROCESSING_TASK_STATUS.TIMED_OUT,
        error_code: DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE,
        error_message: options.errorMessage,
        finished_at: now,
        duration_ms: this.calculateDurationMs(task.started_at, now),
        heartbeat_at: now,
        updated_at: now,
      },
    });

    this.logger.warn('[DocumentProcessingTaskTimedOut]', {
      taskId: updatedTask.id.toString(),
      documentId: updatedTask.document_id.toString(),
      processingVersion: updatedTask.processing_version,
      stage: updatedTask.stage,
      attempt: updatedTask.attempt,
      errorCode: DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE,
    });

    return updatedTask;
  }

  /**
   * 分页查询指定文档的处理任务记录。
   */
  async listDocumentTasks(options: {
    documentId: bigint;
    processingVersion?: number;
    stage?: string;
    status?: string;
    skip: number;
    take: number;
  }) {
    const where = {
      document_id: options.documentId,
      processing_version: options.processingVersion,
      stage: options.stage,
      status: options.status,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.b_document_processing_tasks.findMany({
        where,
        orderBy: [
          { processing_version: 'desc' },
          { started_at: 'desc' },
          { id: 'desc' },
        ],
        skip: options.skip,
        take: options.take,
      }),
      this.prisma.b_document_processing_tasks.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  /**
   * 查询指定文档最近的处理任务记录。
   */
  async getRecentDocumentTasks(documentId: bigint, take = 10) {
    return this.prisma.b_document_processing_tasks.findMany({
      where: {
        document_id: documentId,
      },
      orderBy: [
        { processing_version: 'desc' },
        { started_at: 'desc' },
        { id: 'desc' },
      ],
      take,
    });
  }

  /**
   * 查询指定阶段任务。
   */
  private async findStageTask(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    attempt: number;
  }) {
    return this.prisma.b_document_processing_tasks.findFirst({
      where: {
        document_id: options.documentId,
        processing_version: options.processingVersion,
        stage: options.stage,
        attempt: options.attempt,
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  /**
   * 计算任务阶段耗时，单位毫秒。
   */
  private calculateDurationMs(startedAt: Date, finishedAt: Date) {
    return Math.max(0, finishedAt.getTime() - startedAt.getTime());
  }
}
