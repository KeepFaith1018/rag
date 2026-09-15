import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { ProcessingQueueService } from '../../../platform/queue/queue.service';
import { dispatchEventKey } from '../contracts/identifiers';
import {
  lockKnowledgeBaseById,
  lockDocumentById,
  lockProcessingRunById,
  lockProcessingTaskById,
} from '../../../platform/database/transaction-locks';

/** 对账数据库任务、丢失 Job 和超时 execution；MySQL 始终是尝试次数权威。 */
@Injectable()
export class ProcessingReconcilerService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
    private readonly queue: ProcessingQueueService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.reconcileOnce().catch(() => undefined),
      this.runtime.worker.reconcileIntervalMs,
    );
    void this.reconcileOnce().catch(() => undefined);
  }

  async reconcileOnce() {
    if (this.active) return;
    this.active = true;
    try {
      await this.recoverExpiredExecutions();
      const tasks = await this.prisma.b_document_processing_tasks.findMany({
        where: {
          status: { in: ['queued', 'retrying'] },
          OR: [{ available_at: null }, { available_at: { lte: new Date() } }],
        },
        orderBy: { id: 'asc' },
        take: this.runtime.worker.outboxBatchSize,
      });
      for (const task of tasks) {
        const attemptNo = task.attempts_made + 1;
        if (attemptNo > task.attempts_allowed) continue;
        const jobId = `task-${task.id}-attempt-${attemptNo}`;
        if (await this.queue.hasJob(jobId)) continue;
        const payload = {
          schemaVersion: 1,
          taskId: task.id.toString(),
          processingRunId: task.processing_run_id.toString(),
          attemptNo,
        };
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.b_document_processing_tasks.updateMany({
            where: { id: task.id, status: task.status },
            data: { payload_json: payload },
          });
          if (current.count !== 1) return;
          await tx.b_outbox_events.upsert({
            where: { event_key: dispatchEventKey(task.id, attemptNo) },
            create: {
              event_key: dispatchEventKey(task.id, attemptNo),
              event_type: 'dispatch_processing_task',
              aggregate_type: 'processing_task',
              aggregate_id: task.id.toString(),
              payload_json: payload,
            },
            update: {
              status: 'pending',
              available_at: new Date(),
              completed_at: null,
              dispatched_at: null,
              last_error: null,
            },
          });
        });
      }
    } finally {
      this.active = false;
    }
  }

  private async recoverExpiredExecutions() {
    const staleBefore = new Date(
      Date.now() - this.runtime.worker.leaseSeconds * 1000,
    );
    const tasks = await this.prisma.b_document_processing_tasks.findMany({
      where: { status: 'running', heartbeat_at: { lt: staleBefore } },
      orderBy: { heartbeat_at: 'asc' },
      take: this.runtime.worker.outboxBatchSize,
      include: {
        processing_run: {
          include: { document: { select: { id: true, kb_id: true } } },
        },
      },
    });
    for (const task of tasks) {
      if (task.attempts_made >= task.attempts_allowed) {
        await this.prisma.$transaction(async (tx) => {
          await lockKnowledgeBaseById(tx, task.processing_run.document.kb_id);
          await lockDocumentById(tx, task.processing_run.document_id);
          await lockProcessingRunById(tx, task.processing_run_id);
          await lockProcessingTaskById(tx, task.id);
          const currentRun = await tx.b_document_processing_runs.findUnique({
            where: { id: task.processing_run_id },
            select: { status: true },
          });
          if (!currentRun || !['queued', 'running'].includes(currentRun.status))
            return;
          const failed = await tx.b_document_processing_tasks.updateMany({
            where: {
              id: task.id,
              status: 'running',
              execution_version: task.execution_version,
              heartbeat_at: { lt: staleBefore },
            },
            data: {
              status: 'failed',
              execution_version: { increment: 1 },
              last_error_code: 'TASK_LEASE_EXPIRED',
              last_error_message: '任务执行租约已过期',
              finished_at: new Date(),
              worker_id: null,
              locked_at: null,
              heartbeat_at: null,
            },
          });
          if (failed.count !== 1) return;
          const failedRun = await tx.b_document_processing_runs.updateMany({
            where: {
              id: task.processing_run_id,
              status: { in: ['queued', 'running'] },
            },
            data: {
              status: 'failed',
              error_code: 'TASK_LEASE_EXPIRED',
              error_message: '任务执行租约已过期',
              finished_at: new Date(),
            },
          });
          if (failedRun.count !== 1)
            throw new Error('PROCESSING_RUN_NOT_RUNNABLE');
          await tx.b_document_processing_tasks.updateMany({
            where: {
              processing_run_id: task.processing_run_id,
              id: { not: task.id },
              status: { in: ['queued', 'running', 'retrying'] },
            },
            data: {
              status: 'cancelled',
              execution_version: { increment: 1 },
              finished_at: new Date(),
              worker_id: null,
              locked_at: null,
              heartbeat_at: null,
            },
          });
          {
            const document = await tx.b_documents.findUnique({
              where: { id: task.processing_run.document_id },
              select: { active_run_id: true },
            });
            if (!document?.active_run_id)
              await tx.b_documents.updateMany({
                where: {
                  id: task.processing_run.document_id,
                  desired_run_id: task.processing_run_id,
                  status: { notIn: ['deleting', 'deleted'] },
                },
                data: { status: 'failed' },
              });
          }
        });
        continue;
      }
      const nextAttempt = task.attempts_made + 1;
      const payload = {
        schemaVersion: 1,
        taskId: task.id.toString(),
        processingRunId: task.processing_run_id.toString(),
        attemptNo: nextAttempt,
      };
      await this.prisma.$transaction(async (tx) => {
        await lockKnowledgeBaseById(tx, task.processing_run.document.kb_id);
        await lockDocumentById(tx, task.processing_run.document_id);
        await lockProcessingRunById(tx, task.processing_run_id);
        await lockProcessingTaskById(tx, task.id);
        const currentRun = await tx.b_document_processing_runs.findUnique({
          where: { id: task.processing_run_id },
          select: { status: true },
        });
        if (!currentRun || !['queued', 'running'].includes(currentRun.status))
          return;
        const recovered = await tx.b_document_processing_tasks.updateMany({
          where: {
            id: task.id,
            status: 'running',
            execution_version: task.execution_version,
            heartbeat_at: { lt: staleBefore },
          },
          data: {
            status: 'retrying',
            execution_version: { increment: 1 },
            worker_id: null,
            locked_at: null,
            heartbeat_at: null,
            available_at: new Date(),
            payload_json: payload,
            last_error_code: 'TASK_LEASE_EXPIRED',
          },
        });
        if (recovered.count !== 1) return;
        await tx.b_outbox_events.upsert({
          where: { event_key: dispatchEventKey(task.id, nextAttempt) },
          create: {
            event_key: dispatchEventKey(task.id, nextAttempt),
            event_type: 'dispatch_processing_task',
            aggregate_type: 'processing_task',
            aggregate_id: task.id.toString(),
            payload_json: payload,
          },
          update: { status: 'pending', available_at: new Date() },
        });
      });
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
