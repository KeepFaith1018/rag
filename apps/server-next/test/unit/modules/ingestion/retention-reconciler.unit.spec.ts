/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
// Prisma JSON mock payloads are intentionally partial in this unit test.
import { RetentionReconcilerService } from '@app/modules/ingestion/cleanup/retention-reconciler.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';

const HASH = 'a'.repeat(64);

function makeRun() {
  return {
    id: 20n,
    document_id: 30n,
    status: 'failed',
    finished_at: new Date(Date.now() - 8 * 86400000),
    index_targets_json: {
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
    document: {
      id: 30n,
      storage_bucket: 'rag-documents',
      storage_key: 'knowledge-bases/9/documents/x.txt',
    },
  };
}

function makeService(
  overrides: {
    findRuns?: jest.Mock;
    findDocuments?: jest.Mock;
    findCleanup?: jest.Mock;
    upsert?: jest.Mock;
    deleteMany?: jest.Mock;
  } = {},
) {
  const prisma = {
    b_document_processing_runs: {
      findMany: overrides.findRuns ?? jest.fn().mockResolvedValue([]),
    },
    b_documents: {
      findMany: overrides.findDocuments ?? jest.fn().mockResolvedValue([]),
      deleteMany:
        overrides.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
    b_outbox_events: {
      upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
      findUnique:
        overrides.findCleanup ??
        jest.fn().mockResolvedValue({ status: 'completed' }),
    },
  } as unknown as PrismaService;
  const runtime = {
    retention: { failedRunArtifactDays: 7, deletedDocumentDays: 30 },
    worker: { reconcileIntervalMs: 30000, outboxBatchSize: 50 },
  } as unknown as RuntimeConfig;
  const service = new RetentionReconcilerService(prisma, runtime, {
    warn: jest.fn(),
  } as never);
  return { service, prisma };
}

describe('RetentionReconciler 保留策略（P4-8）', () => {
  it('到期 failed/superseded run 创建 cleanup_run Outbox，且不删除源文件', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { service, prisma } = makeService({
      findRuns: jest.fn().mockResolvedValue([makeRun()]),
      upsert,
    });

    await service.reconcileOnce();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_key: 'cleanup-run-20' },
        create: expect.objectContaining({
          event_type: 'cleanup_run',
          payload_json: expect.objectContaining({
            documentId: '30',
            deleteSource: false,
            runs: expect.arrayContaining([
              expect.objectContaining({
                runId: '20',
                prefix: 'documents/30/runs/20/',
              }),
            ]),
          }),
        }),
      }),
    );
    expect(prisma.b_documents.deleteMany).not.toHaveBeenCalled();
  });

  it('到期 tombstone 且 cleanup 已完成时执行硬删除', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({
      findDocuments: jest.fn().mockResolvedValue([{ id: 30n }]),
      findCleanup: jest.fn().mockResolvedValue({ status: 'completed' }),
      deleteMany,
    });

    await service.reconcileOnce();

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 30n, status: 'deleted' },
    });
  });

  it('tombstone 的 cleanup 尚未完成时禁止硬删除', async () => {
    const deleteMany = jest.fn();
    const { service } = makeService({
      findDocuments: jest.fn().mockResolvedValue([{ id: 30n }]),
      findCleanup: jest.fn().mockResolvedValue({ status: 'dispatched' }),
      deleteMany,
    });

    await service.reconcileOnce();

    expect(deleteMany).not.toHaveBeenCalled();
  });
});
