/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Jest mock call records do not retain the production argument types.
import { CleanupWorkerService } from '@app/modules/ingestion/cleanup/cleanup-worker.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';
import { StorageError } from '@platform/object-storage/storage-adapter';

const HASH = 'a'.repeat(64);

function makeCleanupPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    documentId: '30',
    source: {
      bucket: 'rag-documents',
      key: 'knowledge-bases/9/documents/x.txt',
    },
    deleteSource: true,
    runs: [
      {
        runId: '20',
        prefix: 'documents/30/runs/20/',
        indexTargets: {
          schemaVersion: 1,
          qdrant: {
            collection: 'server_next_chunks_abc',
            vectorName: 'dense',
            dimension: 1024,
            metric: 'Cosine',
            schemaHash: HASH,
          },
          elasticsearch: {
            physicalIndex: 'server-next-chunks-v1',
            mappingVersion: 1,
            mappingHash: HASH,
          },
        },
      },
    ],
    reason: 'user_delete',
    createdAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeService(
  overrides: {
    listObjects?: jest.Mock;
    deleteObject?: jest.Mock;
    claimUpdateMany?: jest.Mock;
    firstPass?: boolean;
    activeTasks?: number;
  } = {},
) {
  const tx = {
    b_documents: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    b_outbox_events: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const claimUpdateMany =
    overrides.claimUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    b_outbox_events: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1n,
          event_type: 'cleanup_document',
          status: overrides.firstPass ? 'pending' : 'dispatched',
          dispatched_at: overrides.firstPass
            ? null
            : new Date(Date.now() - 5000),
          payload_json: makeCleanupPayload(),
        },
      ]),
      updateMany: claimUpdateMany,
    },
    b_document_processing_tasks: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(overrides.activeTasks ?? 0),
    },
    $transaction: jest.fn((cb: (value: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const runtime = {
    worker: {
      reconcileIntervalMs: 30000,
      taskTimeoutMs: 1000,
      leaseSeconds: 10,
      heartbeatIntervalMs: 10000,
      cleanupSafetyWindowMs: 1000,
    },
    documentStorage: { requestTimeoutMs: 1000 },
  } as unknown as RuntimeConfig;
  const qdrant = {
    deleteRun: jest.fn().mockResolvedValue(undefined),
    countRun: jest.fn().mockResolvedValue(0),
  };
  const elasticsearch = {
    deleteRun: jest.fn().mockResolvedValue(undefined),
    countRun: jest.fn().mockResolvedValue(0),
  };
  const queue = { remove: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    headObject: jest
      .fn()
      .mockRejectedValue(new StorageError('not-found', 'headObject', 404)),
    deleteObject:
      overrides.deleteObject ?? jest.fn().mockResolvedValue(undefined),
    listObjects:
      overrides.listObjects ??
      jest.fn().mockResolvedValueOnce(['obj1']).mockResolvedValue([]),
  };
  const service = new CleanupWorkerService(
    prisma,
    runtime,
    qdrant as never,
    elasticsearch as never,
    { warn: jest.fn() } as never,
    queue as never,
    storage as never,
  );
  return { service, prisma, tx, qdrant, elasticsearch, storage };
}

describe('CleanupWorker 外部资源清理（P4-8）', () => {
  it('清理双索引与派生产物，二次核验无残留后置 document deleted 并完成 Outbox', async () => {
    const { service, tx, qdrant, elasticsearch, storage } = makeService();

    await service.cleanupOnce();

    expect(qdrant.deleteRun).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'server_next_chunks_abc' }),
      '20',
    );
    expect(elasticsearch.deleteRun).toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'rag-documents',
      key: 'knowledge-bases/9/documents/x.txt',
    });

    expect(tx.b_documents.updateMany).toHaveBeenCalledWith({
      where: { id: 30n, status: 'deleting' },
      data: { status: 'deleted', active_run_id: null, desired_run_id: null },
    });
    expect(tx.b_outbox_events.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 1n,
          status: 'dispatched',
          lock_token: expect.any(String),
        }),
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('外部清理失败时 Outbox 标记 failed 并保留可重试状态', async () => {
    const deleteObject = jest.fn().mockRejectedValue(new Error('minio down'));
    const claimUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({ deleteObject, claimUpdateMany });

    await service.cleanupOnce();

    const failedCall = claimUpdateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'failed',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![0].data.last_error).toBe(
      'CLEANUP_EXTERNAL_RESOURCE_FAILED',
    );
  });

  it('二次扫描发现残留对象时不完成清理', async () => {
    const listObjects = jest.fn().mockResolvedValue(['residual']);
    const claimUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({ listObjects, claimUpdateMany });

    await service.cleanupOnce();

    expect(
      claimUpdateMany.mock.calls.some(
        (call) => call[0]?.data?.status === 'failed',
      ),
    ).toBe(true);
  });

  it('首轮清理后保持 dispatched/deleting，并持久化覆盖任务与请求生命周期的安全窗口', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, tx } = makeService({
      firstPass: true,
      claimUpdateMany: updateMany,
    });
    const before = Date.now();
    await service.cleanupOnce();
    expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
    expect(tx.b_outbox_events.updateMany).not.toHaveBeenCalled();
    const scheduled = updateMany.mock.calls.find(
      (call) => call[0].data.dispatched_at,
    );
    expect(scheduled).toBeDefined();
    expect(
      (scheduled![0].data.available_at as Date).getTime(),
    ).toBeGreaterThanOrEqual(before + 2000);
    expect(scheduled![0].data.lock_token).toBeNull();
  });

  it('仍有合法执行任务时不删除资源，保留执行屏障等待状态', async () => {
    const { service, tx, storage, qdrant } = makeService({ activeTasks: 1 });
    await service.cleanupOnce();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(qdrant.deleteRun).not.toHaveBeenCalled();
    expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
  });

  it('安全窗口后的第二轮会删除迟到对象并重新核验双索引', async () => {
    const listObjects = jest
      .fn()
      .mockResolvedValueOnce(['late-object'])
      .mockResolvedValue([]);
    const { service, storage, qdrant, elasticsearch } = makeService({
      listObjects,
    });
    await service.cleanupOnce();
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'rag-documents',
      key: 'late-object',
    });
    expect(qdrant.countRun).toHaveBeenCalledWith(expect.anything(), '20');
    expect(elasticsearch.countRun).toHaveBeenCalledWith(
      expect.anything(),
      '20',
    );
  });

  it('清理 lease token 已失效时不能把 document 置为 deleted', async () => {
    const { service, tx } = makeService();
    tx.b_outbox_events.updateMany.mockResolvedValue({ count: 0 });
    await service.cleanupOnce();
    expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
  });
  it.each(['exists', 'unavailable'])(
    '源对象核验结果为 %s 时不能完成清理',
    async (kind) => {
      const { service, storage, tx } = makeService();
      if (kind === 'exists') storage.headObject.mockResolvedValue({} as never);
      else
        storage.headObject.mockRejectedValue(
          new StorageError('unavailable', 'headObject', 503),
        );
      await service.cleanupOnce();
      expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
      expect(tx.b_outbox_events.updateMany).not.toHaveBeenCalled();
    },
  );
});
