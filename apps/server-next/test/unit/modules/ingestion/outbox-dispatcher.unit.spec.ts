/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
// Jest mock call records are intentionally inspected by these behavior tests.
import { OutboxDispatcherService } from '@app/modules/ingestion/jobs/outbox-dispatcher.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    event_key: 'dispatch-task-10-attempt-1',
    event_type: 'dispatch_processing_task',
    aggregate_type: 'processing_task',
    aggregate_id: '10',
    payload_json: {
      schemaVersion: 1,
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    },
    status: 'pending',
    attempts_made: 0,
    available_at: new Date(Date.now() - 1000),
    lock_token: null,
    locked_until: null,
    dispatched_at: null,
    completed_at: null,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeService(
  overrides: {
    findMany?: jest.Mock;
    updateMany?: jest.Mock;
    hasJob?: jest.Mock;
    add?: jest.Mock;
  } = {},
) {
  const updateMany =
    overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    b_outbox_events: {
      findMany:
        overrides.findMany ?? jest.fn().mockResolvedValue([makeEvent()]),
      updateMany,
    },
  } as unknown as PrismaService;
  const queue = {
    hasJob: overrides.hasJob ?? jest.fn().mockResolvedValue(false),
    add: overrides.add ?? jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const runtime = {
    worker: { outboxBatchSize: 50 },
  } as unknown as RuntimeConfig;
  const logger = { warn: jest.fn() };
  const service = new OutboxDispatcherService(
    prisma,
    queue as never,
    runtime,
    logger as never,
  );
  return {
    service,
    updateMany,
    queue,
    findMany: prisma.b_outbox_events.findMany,
  };
}

describe('OutboxDispatcher 任务投递（P4-2）', () => {
  it('pending 事件被领取并投递，确认 Job 存在后标记 completed', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // claim → dispatching
      .mockResolvedValueOnce({ count: 1 }); // completed
    const { service, queue, updateMany: update } = makeService({ updateMany });

    await service.dispatchOnce();

    expect(queue.hasJob).toHaveBeenCalledWith('task-10-attempt-1');
    expect(queue.add).toHaveBeenCalledWith({
      schemaVersion: 1,
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    });
    const completed = update.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(completed.data.status).toBe('completed');
    expect(completed.data.completed_at).toBeInstanceOf(Date);
  });

  it('BullMQ Job 已存在时重复投递直接完成，不再调用 add', async () => {
    const { service, queue } = makeService({
      hasJob: jest.fn().mockResolvedValue(true),
    });

    await service.dispatchOnce();

    expect(queue.hasJob).toHaveBeenCalledWith('task-10-attempt-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('Queue.add 失败时事件回退 pending 并退避，不阻塞后续恢复', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // 失败回写 pending
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, updateMany: update } = makeService({ updateMany, add });

    await service.dispatchOnce();

    const failed = update.mock.calls[1]?.[0] as {
      data: { status: string; available_at: Date; last_error: string };
    };
    expect(failed.data.status).toBe('pending');
    expect(failed.data.available_at.getTime()).toBeGreaterThan(Date.now());
    expect(failed.data.last_error).toBe('OUTBOX_DISPATCH_FAILED');
  });

  it('未知 Schema 版本不会被投递，保留可诊断事件', async () => {
    const event = makeEvent({
      payload_json: {
        schemaVersion: 99,
        taskId: '10',
        processingRunId: '20',
        attemptNo: 1,
      },
    });
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const {
      service,
      queue,
      updateMany: update,
    } = makeService({
      findMany: jest.fn().mockResolvedValue([event]),
      updateMany,
    });

    await service.dispatchOnce();

    expect(queue.add).not.toHaveBeenCalled();
    const failed = update.mock.calls[1]?.[0] as {
      data: { last_error: string };
    };
    expect(failed.data.last_error).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('并发领取失败（claim count=0）时静默跳过该事件', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service, queue } = makeService({ updateMany });

    await service.dispatchOnce();

    expect(queue.add).not.toHaveBeenCalled();
  });
});
