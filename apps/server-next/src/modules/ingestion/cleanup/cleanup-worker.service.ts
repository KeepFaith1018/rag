import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { randomUUID } from 'node:crypto';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { AppLogger } from '../../../platform/observability/app-logger.service';
import {
  STORAGE_ADAPTER,
  StorageError,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { ElasticsearchService } from '../../../platform/search/search.service';
import { QdrantService } from '../../../platform/vector/vector.service';
import { CleanupPayloadSchema, parseVersioned } from '../contracts/schemas';
import { ProcessingQueueService } from '../../../platform/queue/queue.service';
import { bullmqJobId } from '../contracts/identifiers';

/** cleanup Outbox 同时承担工作流状态，只有外部资源二次核验无残留后才 completed。 */
@Injectable()
export class CleanupWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
    private readonly qdrant: QdrantService,
    private readonly elasticsearch: ElasticsearchService,
    private readonly logger: AppLogger,
    private readonly queue: ProcessingQueueService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.cleanupOnce().catch(() => undefined),
      this.runtime.worker.reconcileIntervalMs,
    );
    void this.cleanupOnce().catch(() => undefined);
  }

  async cleanupOnce(limit = 10) {
    if (this.active) return;
    this.active = true;
    try {
      const events = await this.prisma.b_outbox_events.findMany({
        where: {
          event_type: {
            in: ['cleanup_document', 'cleanup_run', 'cleanup_knowledge_base'],
          },
          status: { in: ['pending', 'dispatched', 'failed'] },
          available_at: { lte: new Date() },
          OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }],
        },
        orderBy: { id: 'asc' },
        take: limit,
      });
      for (const event of events) {
        const token = randomUUID();
        const leaseMs = Math.max(
          this.runtime.worker.taskTimeoutMs,
          this.runtime.worker.leaseSeconds * 1000,
        );
        const claimed = await this.prisma.b_outbox_events.updateMany({
          where: {
            id: event.id,
            status: event.status,
            available_at: { lte: new Date() },
            OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }],
          },
          data: {
            status: 'dispatched',
            attempts_made: { increment: 1 },
            lock_token: token,
            locked_until: new Date(Date.now() + leaseMs),
          },
        });
        if (claimed.count !== 1) continue;
        const owned = {
          id: event.id,
          status: 'dispatched' as const,
          lock_token: token,
        };
        const heartbeat = setInterval(() => {
          void this.prisma.b_outbox_events
            .updateMany({
              where: owned,
              data: { locked_until: new Date(Date.now() + leaseMs) },
            })
            .catch(() => undefined);
        }, this.runtime.worker.heartbeatIntervalMs);
        try {
          const payload = parseVersioned(
            CleanupPayloadSchema,
            event.payload_json,
          );
          await this.cleanup(payload);
          if (!event.dispatched_at) {
            // dispatched_at 仅记录首轮清理成功时间；Worker 重启后仍能继续安全窗口。
            const safetyWindowMs = Math.max(
              this.runtime.worker.cleanupSafetyWindowMs,
              this.runtime.worker.taskTimeoutMs * 2,
              this.runtime.documentStorage.requestTimeoutMs,
            );
            await this.prisma.b_outbox_events.updateMany({
              where: owned,
              data: {
                dispatched_at: new Date(),
                available_at: new Date(Date.now() + safetyWindowMs),
                lock_token: null,
                locked_until: null,
                last_error: null,
              },
            });
            continue;
          }
          await this.prisma.$transaction(async (tx) => {
            const completed = await tx.b_outbox_events.updateMany({
              where: owned,
              data: {
                status: 'completed',
                completed_at: new Date(),
                locked_until: null,
                lock_token: null,
                last_error: null,
              },
            });
            if (completed.count !== 1) return;
            if (event.event_type === 'cleanup_document')
              await tx.b_documents.updateMany({
                where: { id: BigInt(payload.documentId), status: 'deleting' },
                data: {
                  status: 'deleted',
                  active_run_id: null,
                  desired_run_id: null,
                },
              });
          });
        } catch (error) {
          await this.prisma.b_outbox_events.updateMany({
            where: owned,
            data: {
              status: 'failed',
              lock_token: null,
              locked_until: null,
              last_error: safeCleanupError(error),
              available_at: new Date(
                Date.now() + this.runtime.worker.reconcileIntervalMs,
              ),
            },
          });
          this.logger.warn('Document cleanup will be retried', {
            eventId: event.id.toString(),
          });
        } finally {
          clearInterval(heartbeat);
        }
      }
    } finally {
      this.active = false;
    }
  }

  private async cleanup(
    payload: ReturnType<typeof CleanupPayloadSchema.parse>,
  ) {
    const activeTasks = await this.prisma.b_document_processing_tasks.count({
      where: {
        processing_run_id: { in: payload.runs.map((run) => BigInt(run.runId)) },
        status: { in: ['queued', 'running', 'retrying'] },
      },
    });
    if (activeTasks) throw new Error('CLEANUP_EXECUTION_BARRIER_PENDING');
    await this.removeQueuedAttempts(payload);
    for (const run of payload.runs) {
      await this.qdrant.deleteRun(run.indexTargets.qdrant, run.runId);
      await this.elasticsearch.deleteRun(
        run.indexTargets.elasticsearch,
        run.runId,
      );
      await this.deletePrefix(payload.source.bucket, run.prefix);
      const vectorCount = await this.qdrant.countRun(
        run.indexTargets.qdrant,
        run.runId,
      );
      const searchCount = await this.elasticsearch.countRun(
        run.indexTargets.elasticsearch,
        run.runId,
      );
      if (vectorCount || searchCount)
        throw new Error('CLEANUP_RESIDUAL_INDEXES');
    }
    if (payload.deleteSource) {
      await this.storage.deleteObject(payload.source);
      try {
        await this.storage.headObject(payload.source);
        throw new Error('CLEANUP_RESIDUAL_SOURCE');
      } catch (error) {
        if (
          !(error instanceof StorageError && error.storageKind === 'not-found')
        )
          throw error;
      }
    }
    for (const run of payload.runs) {
      const remaining = await this.storage.listObjects({
        bucket: payload.source.bucket,
        prefix: run.prefix,
      });
      if (remaining.length) throw new Error('CLEANUP_RESIDUAL_OBJECTS');
    }
  }

  private async removeQueuedAttempts(
    payload: ReturnType<typeof CleanupPayloadSchema.parse>,
  ) {
    const runIds = payload.runs.map((run) => BigInt(run.runId));
    if (!runIds.length) return;
    const tasks = await this.prisma.b_document_processing_tasks.findMany({
      where: { processing_run_id: { in: runIds } },
      select: { id: true, attempts_allowed: true },
    });
    for (const task of tasks) {
      for (let attempt = 1; attempt <= task.attempts_allowed; attempt++) {
        try {
          await this.queue.remove(bullmqJobId(task.id, attempt));
        } catch {
          // 数据库取消和 execution_version 是正确性屏障；队列删除只用于减少空转。
        }
      }
    }
  }

  private async deletePrefix(bucket: string, prefix: string) {
    const keys = await this.storage.listObjects({ bucket, prefix });
    for (const key of keys) await this.storage.deleteObject({ bucket, key });
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

function safeCleanupError(error: unknown) {
  return error instanceof Error &&
    error.message === 'SCHEMA_VERSION_UNSUPPORTED'
    ? error.message
    : 'CLEANUP_EXTERNAL_RESOURCE_FAILED';
}
