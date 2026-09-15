import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ProcessingQueueService } from '../../../platform/queue/queue.service';
import { AppLogger } from '../../../platform/observability/app-logger.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { TaskPayloadSchema, parseVersioned } from '../contracts/schemas';

/** Transactional Outbox 投递器；任务投递的 completed 只表示 BullMQ Job 已存在。 */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ProcessingQueueService,
    private readonly runtime: RuntimeConfig,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.dispatchOnce().catch(() => undefined),
      1000,
    );
    void this.dispatchOnce().catch(() => undefined);
  }

  async dispatchOnce(limit = this.runtime.worker.outboxBatchSize) {
    if (this.active) return;
    this.active = true;
    try {
      const now = new Date();
      const events = await this.prisma.b_outbox_events.findMany({
        where: {
          event_type: 'dispatch_processing_task',
          available_at: { lte: now },
          OR: [
            { status: 'pending' },
            { status: 'dispatching', locked_until: { lt: now } },
          ],
        },
        orderBy: { id: 'asc' },
        take: limit,
      });
      for (const event of events) await this.dispatchEvent(event);
    } finally {
      this.active = false;
    }
  }

  private async dispatchEvent(event: Prisma.b_outbox_eventsGetPayload<object>) {
    const token = randomUUID();
    const claimed = await this.prisma.b_outbox_events.updateMany({
      where: {
        id: event.id,
        OR: [
          { status: 'pending' },
          { status: 'dispatching', locked_until: { lt: new Date() } },
        ],
      },
      data: {
        status: 'dispatching',
        lock_token: token,
        locked_until: new Date(Date.now() + 30000),
        attempts_made: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return;
    try {
      const payload = parseVersioned(TaskPayloadSchema, event.payload_json);
      const jobId = `task-${payload.taskId}-attempt-${payload.attemptNo}`;
      if (!(await this.queue.hasJob(jobId))) await this.queue.add(payload);
      await this.prisma.b_outbox_events.updateMany({
        where: { id: event.id, status: 'dispatching', lock_token: token },
        data: {
          status: 'completed',
          dispatched_at: new Date(),
          completed_at: new Date(),
          locked_until: null,
          lock_token: null,
          last_error: null,
        },
      });
    } catch (error) {
      await this.prisma.b_outbox_events.updateMany({
        where: { id: event.id, status: 'dispatching', lock_token: token },
        data: {
          status: 'pending',
          available_at: new Date(Date.now() + 1000),
          locked_until: null,
          lock_token: null,
          last_error: safeError(error),
        },
      });
      this.logger.warn('Processing task outbox dispatch failed', {
        eventId: event.id.toString(),
      });
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message === 'SCHEMA_VERSION_UNSUPPORTED')
    return error.message;
  return 'OUTBOX_DISPATCH_FAILED';
}
