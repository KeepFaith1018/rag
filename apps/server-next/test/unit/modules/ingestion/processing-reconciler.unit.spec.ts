/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// Prisma JSON mock payloads are intentionally partial in this unit test.
import { ProcessingReconcilerService } from '@app/modules/ingestion/jobs/processing-reconciler.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    processing_run_id: 20n,
    processing_run: { document_id: 30n, document: { id: 30n, kb_id: 9n } },
    stage: 'parse',
    status: 'running',
    attempts_made: 1,
    attempts_allowed: 3,
    execution_version: 1,
    heartbeat_at: new Date(Date.now() - 120_000),
    payload_json: {
      schemaVersion: 1,
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    },
    available_at: null,
    ...overrides,
  };
}

function makeService(
  overrides: {
    findMany?: jest.Mock;
    hasJob?: jest.Mock;
    transaction?: jest.Mock;
  } = {},
) {
  const prisma = {
    b_document_processing_tasks: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    },
    $transaction: overrides.transaction ?? jest.fn(),
  } as unknown as PrismaService;
  const runtime = {
    worker: {
      leaseSeconds: 60,
      reconcileIntervalMs: 30000,
      outboxBatchSize: 50,
    },
  } as unknown as RuntimeConfig;
  const queue = {
    hasJob: overrides.hasJob ?? jest.fn().mockResolvedValue(false),
  };
  const service = new ProcessingReconcilerService(
    prisma,
    runtime,
    queue as never,
  );
  return { service, prisma, queue };
}

describe('ProcessingReconciler 超时执行恢复（P4-3）', () => {
  it('运行中任务心跳超时且预算未耗尽时接管为 retrying 并投递下一 attempt', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { upsert: jest.fn().mockResolvedValue({}) },
      b_document_processing_runs: {
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
      },
      b_documents: { findUnique: jest.fn(), updateMany: jest.fn() },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const findMany = jest.fn().mockResolvedValue([makeTask()]);
    const { service } = makeService({ findMany, transaction });

    await (
      service as unknown as {
        recoverExpiredExecutions(): Promise<void>;
      }
    ).recoverExpiredExecutions();

    expect(
      transactionClient.b_document_processing_tasks.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 10n,
          status: 'running',
          execution_version: 1,
          heartbeat_at: { lt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          status: 'retrying',
          payload_json: expect.objectContaining({ attemptNo: 2 }),
        }),
      }),
    );
    expect(transactionClient.b_outbox_events.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_key: 'dispatch-task-10-attempt-2' },
        create: expect.objectContaining({
          event_type: 'dispatch_processing_task',
          payload_json: expect.objectContaining({ attemptNo: 2 }),
        }),
      }),
    );
  });

  it('运行中任务耗尽重试后接管为 failed 并收敛 run 与 document', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { upsert: jest.fn() },
      b_document_processing_runs: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
      },
      b_documents: {
        findUnique: jest.fn().mockResolvedValue({ active_run_id: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const findMany = jest
      .fn()
      .mockResolvedValue([makeTask({ attempts_made: 3 })]);
    const { service } = makeService({ findMany, transaction });

    await (
      service as unknown as {
        recoverExpiredExecutions(): Promise<void>;
      }
    ).recoverExpiredExecutions();

    expect(
      transactionClient.b_document_processing_runs.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error_code: 'TASK_LEASE_EXPIRED',
        }),
      }),
    );
    expect(transactionClient.b_documents.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 30n,
          desired_run_id: 20n,
          status: { notIn: ['deleting', 'deleted'] },
        },
        data: { status: 'failed' },
      }),
    );
  });
});

describe('ProcessingReconciler 缺失 Job 对账（P4-3）', () => {
  it('queued/retrying 任务缺失 Job 时重新投递，不产生新的业务尝试', async () => {
    const queued = makeTask({
      status: 'queued',
      attempts_made: 1,
      heartbeat_at: null,
    });
    const transactionClient = {
      b_document_processing_tasks: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const findMany = jest
      .fn()
      .mockImplementation(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(where.status === 'running' ? [] : [queued]),
      );
    const { service } = makeService({
      findMany,
      transaction,
      hasJob: jest.fn().mockResolvedValue(false),
    });

    await service.reconcileOnce();

    expect(transactionClient.b_outbox_events.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_key: 'dispatch-task-10-attempt-2' },
      }),
    );
  });
});
