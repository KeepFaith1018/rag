import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { AppLogger } from '../../../platform/observability/app-logger.service';
import {
  CleanupPayloadSchema,
  IndexTargetsSchema,
  parseVersioned,
} from '../contracts/schemas';
import { runPrefix } from '../contracts/identifiers';

/** 到期派生产物与 document tombstone 的保留策略对账器。 */
@Injectable()
export class RetentionReconcilerService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.reconcileOnce().catch(() => undefined),
      Math.max(this.runtime.worker.reconcileIntervalMs, 60000),
    );
    void this.reconcileOnce().catch(() => undefined);
  }

  async reconcileOnce() {
    if (this.active) return;
    this.active = true;
    try {
      await this.scheduleExpiredRuns();
      await this.hardDeleteExpiredTombstones();
    } finally {
      this.active = false;
    }
  }

  private async scheduleExpiredRuns() {
    const before = daysAgo(this.runtime.retention.failedRunArtifactDays);
    const runs = await this.prisma.b_document_processing_runs.findMany({
      where: {
        status: { in: ['failed', 'succeeded', 'cancelled'] },
        finished_at: { lt: before },
        active_document: { is: null },
        desired_document: { is: null },
        document: {
          deleted_at: null,
          status: { notIn: ['deleting', 'deleted'] },
        },
      },
      include: {
        document: {
          select: { id: true, storage_bucket: true, storage_key: true },
        },
      },
      orderBy: { finished_at: 'asc' },
      take: this.runtime.worker.outboxBatchSize,
    });
    for (const run of runs) {
      try {
        const payload = CleanupPayloadSchema.parse({
          schemaVersion: 1,
          documentId: run.document_id.toString(),
          source: {
            bucket: run.document.storage_bucket,
            key: run.document.storage_key,
          },
          deleteSource: false,
          runs: [
            {
              runId: run.id.toString(),
              prefix: runPrefix(run.document_id, run.id),
              indexTargets: parseVersioned(
                IndexTargetsSchema,
                run.index_targets_json,
              ),
            },
          ],
          reason: 'retention_expired',
          createdAt: new Date().toISOString(),
        });
        await this.prisma.b_outbox_events.upsert({
          where: { event_key: `cleanup-run-${run.id}` },
          create: {
            event_key: `cleanup-run-${run.id}`,
            event_type: 'cleanup_run',
            aggregate_type: 'processing_run',
            aggregate_id: run.id.toString(),
            payload_json: payload,
          },
          update: {},
        });
      } catch {
        this.logger.warn('Expired run cleanup could not be scheduled', {
          runId: run.id.toString(),
        });
      }
    }
  }

  private async hardDeleteExpiredTombstones() {
    const documents = await this.prisma.b_documents.findMany({
      where: {
        status: 'deleted',
        deleted_at: { lt: daysAgo(this.runtime.retention.deletedDocumentDays) },
        processing_runs: {
          none: {
            processing_tasks: {
              some: { status: { in: ['queued', 'running', 'retrying'] } },
            },
          },
        },
      },
      select: { id: true },
      orderBy: { deleted_at: 'asc' },
      take: this.runtime.worker.outboxBatchSize,
    });
    for (const document of documents) {
      const cleanup = await this.prisma.b_outbox_events.findUnique({
        where: { event_key: `cleanup-document-${document.id}` },
        select: { status: true },
      });
      if (cleanup?.status !== 'completed') continue;
      await this.prisma.b_documents.deleteMany({
        where: { id: document.id, status: 'deleted' },
      });
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000);
}
