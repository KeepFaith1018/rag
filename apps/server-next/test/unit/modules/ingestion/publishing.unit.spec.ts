/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Transaction lock SQL and Prisma JSON mock payloads are intentionally partial.
import { PublishingService } from '@app/modules/ingestion/application/publishing.service';
import { PrismaService } from '@platform/database/prisma.service';

const HASH = 'a'.repeat(64);

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 20n,
    document_id: 30n,
    status: 'running',
    retrieval_policy_json: {
      schemaVersion: 1,
      levels: {
        '1': { embedding: false, vectorIndex: false, searchIndex: false },
        '2': { embedding: false, vectorIndex: false, searchIndex: false },
        '3': { embedding: true, vectorIndex: true, searchIndex: true },
      },
    },
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
      kb_id: 9n,
      desired_run_id: 20n,
      deleted_at: null,
      status: 'processing',
    },
    processing_tasks: [{ status: 'succeeded' }],
    ...overrides,
  };
}

function makeService(
  overrides: {
    findRun?: jest.Mock;
    findChunks?: jest.Mock;
    countRun?: jest.Mock;
    transaction?: jest.Mock;
  } = {},
) {
  const prisma = {
    b_document_processing_runs: {
      findUnique: overrides.findRun ?? jest.fn().mockResolvedValue(makeRun()),
    },
    b_document_chunks: {
      findMany:
        overrides.findChunks ??
        jest.fn().mockResolvedValue([
          {
            embedding_status: 'completed',
            vector_index_status: 'completed',
            search_index_status: 'completed',
          },
        ]),
    },
    $transaction: overrides.transaction ?? jest.fn(),
  } as unknown as PrismaService;
  const qdrant = {
    ensure: jest.fn().mockResolvedValue({}),
    countRun: overrides.countRun ?? jest.fn().mockResolvedValue(1),
  };
  const elasticsearch = {
    ensure: jest.fn().mockResolvedValue({}),
    countRun: overrides.countRun ?? jest.fn().mockResolvedValue(1),
  };
  const service = new PublishingService(
    prisma,
    qdrant as never,
    elasticsearch as never,
  );
  return { service, prisma, qdrant, elasticsearch };
}

function transactionClient(updateDocumentCount = 1, updateRunCount = 1) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
    b_documents: {
      updateMany: jest.fn().mockResolvedValue({ count: updateDocumentCount }),
    },
    b_document_processing_runs: {
      updateMany: jest.fn().mockResolvedValue({ count: updateRunCount }),
    },
  };
}

describe('PublishingService 发布（P4-7）', () => {
  it('所有条件满足时按 kb → document → run 顺序加锁并切换 active run', async () => {
    const tx = transactionClient(1);
    const transaction = jest.fn((cb: (value: typeof tx) => unknown) => cb(tx));
    const { service } = makeService({ transaction });

    await expect(service.tryPublish(20n)).resolves.toBe(true);

    const locks = tx.$queryRaw.mock.calls.map((call) => call[0][0] as string);
    expect(locks[0]).toContain('b_knowledge_bases');
    expect(locks[1]).toContain('b_documents');
    expect(locks[2]).toContain('b_document_processing_runs');

    expect(tx.b_documents.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 30n,
          desired_run_id: 20n,
          deleted_at: null,
          status: { notIn: ['deleting', 'deleted'] },
        },
        data: { active_run_id: 20n, status: 'ready' },
      }),
    );
    expect(tx.b_document_processing_runs.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20n, status: { in: ['queued', 'running'] } },
        data: expect.objectContaining({
          status: 'succeeded',
          current_stage: 'completed',
        }),
      }),
    );
  });

  it('run 已不是 desired run 时拒绝发布', async () => {
    const run = makeRun({
      document: {
        id: 30n,
        kb_id: 9n,
        desired_run_id: 99n,
        deleted_at: null,
        status: 'processing',
      },
    });
    const transaction = jest.fn();
    const { service } = makeService({
      findRun: jest.fn().mockResolvedValue(run),
      transaction,
    });

    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('任一必需任务未成功时拒绝发布', async () => {
    const run = makeRun({ processing_tasks: [{ status: 'running' }] });
    const transaction = jest.fn();
    const { service } = makeService({
      findRun: jest.fn().mockResolvedValue(run),
      transaction,
    });

    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('存在未完成索引步骤的 Chunk 时拒绝发布', async () => {
    const transaction = jest.fn();
    const { service } = makeService({
      findChunks: jest.fn().mockResolvedValue([
        {
          embedding_status: 'completed',
          vector_index_status: 'pending',
          search_index_status: 'completed',
        },
      ]),
      transaction,
    });

    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('外部索引目标点数量与 Chunk 不一致时拒绝发布', async () => {
    const transaction = jest.fn();
    const { service } = makeService({
      countRun: jest.fn().mockResolvedValue(0),
      transaction,
    });

    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('短事务内 document 条件更新失败（竞争/已删除）时返回 false', async () => {
    const tx = transactionClient(0);
    const transaction = jest.fn((cb: (value: typeof tx) => unknown) => cb(tx));
    const { service } = makeService({ transaction });

    await expect(service.tryPublish(20n)).resolves.toBe(false);
  });

  it('外部核验后 run 已失败时，条件更新为零且不切换 active run', async () => {
    const tx = transactionClient(1, 0);
    const transaction = jest.fn((cb: (value: typeof tx) => unknown) => cb(tx));
    const { service } = makeService({ transaction });
    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
  });

  it('document 竞争失败通过抛出冲突令数据库事务回滚，而非提交 succeeded run', async () => {
    const tx = transactionClient(0);
    const rollback = jest.fn();
    const transaction = jest.fn(async (cb: (value: typeof tx) => unknown) => {
      try {
        return await cb(tx);
      } catch (error) {
        rollback();
        throw error;
      }
    });
    const { service } = makeService({ transaction });
    await expect(service.tryPublish(20n)).resolves.toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
