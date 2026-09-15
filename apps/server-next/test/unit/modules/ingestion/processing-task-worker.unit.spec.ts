/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
// Worker tests use partial Prisma rows and inspect mocked call records.
import {
  ProcessingTaskWorkerService,
  batchEmbeddingChunks,
} from '@app/modules/ingestion/jobs/processing-task-worker.service';
import { Readable } from 'node:stream';
import { MarkdownParserService } from '@app/modules/ingestion/pipeline/markdown-parser.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';
import { BusinessError } from '@shared/errors/business-error';
import { ErrorCode } from '@shared/errors/error-code';

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    processing_run_id: 20n,
    stage: 'parse',
    task_key: 'run:20:parse:document',
    queue_name: 'document-processing',
    status: 'queued',
    attempts_allowed: 3,
    attempts_made: 0,
    execution_version: 0,
    payload_json: {
      schemaVersion: 1,
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    },
    available_at: null,
    worker_id: null,
    locked_at: null,
    heartbeat_at: null,
    processing_run: {
      id: 20n,
      document_id: 30n,
      status: 'queued',
    },
    ...overrides,
  };
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 30n,
    kb_id: 9n,
    storage_bucket: 'rag-documents',
    storage_key: 'knowledge-bases/9/documents/x.txt',
    file_extension: '.txt',
    status: 'processing',
    deleted_at: null,
    ...overrides,
  };
}

function makeService(
  overrides: {
    findTask?: jest.Mock;
    findDocument?: jest.Mock;
    updateTask?: jest.Mock;
    transaction?: jest.Mock;
  } = {},
) {
  const prisma = {
    b_document_processing_tasks: {
      findUnique: overrides.findTask ?? jest.fn(),
      updateMany:
        overrides.updateTask ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
    b_documents: {
      findUnique: overrides.findDocument ?? jest.fn(),
    },
    $transaction: overrides.transaction ?? jest.fn(),
  } as unknown as PrismaService;
  const runtime = {
    redis: { url: 'redis://localhost:6379', password: undefined },
    queue: {
      bullmqPrefix: 'server-next:bullmq',
      processingChannelPrefix: 'server-next:documents:processing',
    },
    worker: { concurrency: 2, taskTimeoutMs: 1000, heartbeatIntervalMs: 10000 },
  } as unknown as RuntimeConfig;
  const pubsub = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ProcessingTaskWorkerService(
    prisma,
    runtime,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    pubsub as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, pubsub };
}

type ClaimFn = (payload: {
  taskId: string;
  processingRunId: string;
  attemptNo: number;
}) => Promise<unknown>;

describe('ProcessingTaskWorker 执行权（P4-3）', () => {
  it('原子领取成功时递增 execution_version 并置 running', async () => {
    const findTask = jest.fn().mockResolvedValue(makeTaskRow());
    const findDocument = jest.fn().mockResolvedValue(makeDocument());
    const updateTask = jest.fn().mockResolvedValue({ count: 1 });
    const { service, prisma } = makeService({
      findTask,
      findDocument,
      updateTask,
    });

    const claimed = (await (service as unknown as { claim: ClaimFn }).claim({
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    })) as {
      executionVersion: number;
    };

    expect(claimed).not.toBeNull();
    expect(claimed.executionVersion).toBe(1);
    const update = prisma.b_document_processing_tasks.updateMany;
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10n, status: 'queued', execution_version: 0 },
        data: expect.objectContaining({
          status: 'running',
          execution_version: 1,
          attempts_made: { increment: 1 },
        }),
      }),
    );
  });

  it('run 已进入终态时拒绝领取', async () => {
    const findTask = jest.fn().mockResolvedValue(
      makeTaskRow({
        processing_run: { id: 20n, document_id: 30n, status: 'failed' },
      }),
    );
    const { service } = makeService({ findTask });

    const claimed = await (service as unknown as { claim: ClaimFn }).claim({
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    });

    expect(claimed).toBeNull();
  });

  it('Job attempt 与数据库当前 attempt 不一致时拒绝领取（重复投递去重）', async () => {
    const findTask = jest.fn().mockResolvedValue(
      makeTaskRow({
        payload_json: {
          schemaVersion: 1,
          taskId: '10',
          processingRunId: '20',
          attemptNo: 2,
        },
      }),
    );
    const { service } = makeService({ findTask });

    const claimed = await (service as unknown as { claim: ClaimFn }).claim({
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    });

    expect(claimed).toBeNull();
  });

  it('文档已删除或进入删除流程时拒绝领取', async () => {
    const findTask = jest.fn().mockResolvedValue(makeTaskRow());
    const findDocument = jest
      .fn()
      .mockResolvedValue(makeDocument({ status: 'deleting' }));
    const { service } = makeService({ findTask, findDocument });

    const claimed = await (service as unknown as { claim: ClaimFn }).claim({
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    });

    expect(claimed).toBeNull();
  });

  it('并发领取条件更新失败（count=0）时返回空', async () => {
    const findTask = jest.fn().mockResolvedValue(makeTaskRow());
    const findDocument = jest.fn().mockResolvedValue(makeDocument());
    const updateTask = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = makeService({ findTask, findDocument, updateTask });

    const claimed = await (service as unknown as { claim: ClaimFn }).claim({
      taskId: '10',
      processingRunId: '20',
      attemptNo: 1,
    });

    expect(claimed).toBeNull();
  });
});

describe('ProcessingTaskWorker 失败收敛（P4-3）', () => {
  function claimedTask(overrides: Record<string, unknown> = {}) {
    return {
      task: makeTaskRow(),
      run: { id: 20n, document_id: 30n, status: 'running' },
      document: makeDocument(),
      executionVersion: 1,
      ...overrides,
    };
  }

  it('可重试错误未耗尽预算时写 retrying 并创建下一 attempt Outbox', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        findUnique: jest.fn().mockResolvedValue({
          processing_run_id: 20n,
          status: 'running',
          execution_version: 1,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { create: jest.fn().mockResolvedValue({}) },
      b_document_processing_runs: {
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
        updateMany: jest.fn(),
      },
      b_documents: { findUnique: jest.fn(), updateMany: jest.fn() },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const { service } = makeService({ transaction });

    await (
      service as unknown as {
        failOrRetry(
          claimed: ReturnType<typeof claimedTask>,
          error: unknown,
        ): Promise<void>;
      }
    ).failOrRetry(claimedTask(), new Error('transient'));

    const taskUpdate = transactionClient.b_document_processing_tasks.updateMany;
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10n, status: 'running', execution_version: 1 },
        data: expect.objectContaining({
          status: 'retrying',
          payload_json: expect.objectContaining({ attemptNo: 2 }),
        }),
      }),
    );
    expect(transactionClient.b_outbox_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_key: 'dispatch-task-10-attempt-2',
        }),
      }),
    );
  });

  it('不可重试的业务错误直接收敛 run 与 document', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        findUnique: jest.fn().mockResolvedValue({
          processing_run_id: 20n,
          status: 'running',
          execution_version: 1,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { create: jest.fn() },
      b_document_processing_runs: {
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_documents: {
        findUnique: jest.fn().mockResolvedValue({ active_run_id: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const { service } = makeService({ transaction });

    await (
      service as unknown as {
        failOrRetry(
          claimed: ReturnType<typeof claimedTask>,
          error: unknown,
        ): Promise<void>;
      }
    ).failOrRetry(
      claimedTask(),
      new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_FAILED,
        '文档处理失败',
        'validation',
      ),
    );

    expect(
      transactionClient.b_document_processing_runs.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 20n,
          status: { notIn: ['succeeded', 'failed', 'cancelled'] },
        },
        data: expect.objectContaining({ status: 'failed' }),
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

  it('耗尽重试预算后取消后继任务且不再创建 Outbox', async () => {
    const task = makeTaskRow({ attempts_made: 2 }); // 2+1 >= 3 视为耗尽
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        findUnique: jest.fn().mockResolvedValue({
          processing_run_id: 20n,
          status: 'running',
          execution_version: 1,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_outbox_events: { create: jest.fn() },
      b_document_processing_runs: {
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      b_documents: {
        findUnique: jest.fn().mockResolvedValue({ active_run_id: 50n }),
        updateMany: jest.fn(),
      },
    };
    const transaction = jest.fn(
      (cb: (tx: typeof transactionClient) => unknown) => cb(transactionClient),
    );
    const { service } = makeService({ transaction });

    await (
      service as unknown as {
        failOrRetry(
          claimed: ReturnType<typeof claimedTask>,
          error: unknown,
        ): Promise<void>;
      }
    ).failOrRetry(claimedTask({ task }), new Error('retry exhausted'));

    // 存在 active run 时 document 保持 ready，不置 failed。
    expect(transactionClient.b_documents.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.b_outbox_events.create).not.toHaveBeenCalled();
    expect(
      transactionClient.b_document_processing_tasks.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['queued', 'running', 'retrying'] },
        }),
        data: expect.objectContaining({ execution_version: { increment: 1 } }),
      }),
    );
  });
});

describe('Worker 迟到回写与容量屏障', () => {
  afterEach(() => jest.restoreAllMocks());

  function ownedTx(status = 'running', executionVersion = 1, updateCount = 1) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_runs: {
        findUnique: jest.fn().mockResolvedValue({ status }),
        updateMany: jest.fn(),
      },
      b_document_processing_tasks: {
        findUnique: jest.fn().mockResolvedValue({
          processing_run_id: 20n,
          status: 'running',
          execution_version: executionVersion,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        create: jest.fn(),
      },
      b_documents: { findUnique: jest.fn(), updateMany: jest.fn() },
      b_outbox_events: { create: jest.fn() },
    };
  }

  it.each([
    ['failed', 1],
    ['running', 2],
  ])(
    'run=%s 或 execution=%s 失效时，迟到 parse 不创建后继任务',
    async (status, version) => {
      const tx = ownedTx(status, version);
      const { service, pubsub } = makeService({
        transaction: jest.fn((cb: (value: typeof tx) => unknown) => cb(tx)),
      });
      const parser = {
        parse: jest.fn().mockResolvedValue({
          markdown: '正文',
          markdownSha256: 'a'.repeat(64),
          parser: 'test',
          parserVersion: '1',
          warnings: [],
          degraded: false,
        }),
      };
      Object.assign(service, {
        parser,
        storage: {
          readObject: jest.fn().mockResolvedValue(Readable.from(['正文'])),
          putObject: jest.fn().mockResolvedValue({}),
        },
        runtime: { parser: { maxBytes: 1000 } },
      });
      await (
        service as unknown as {
          executeParse(value: unknown, signal: AbortSignal): Promise<void>;
        }
      ).executeParse(
        {
          task: makeTaskRow(),
          run: { id: 20n },
          document: makeDocument(),
          executionVersion: 1,
        },
        new AbortController().signal,
      );
      expect(tx.b_document_processing_tasks.create).not.toHaveBeenCalled();
      expect(tx.b_document_processing_tasks.updateMany).not.toHaveBeenCalled();
      expect(pubsub.publish).not.toHaveBeenCalled();
    },
  );

  it('失去执行权或条件更新失败的旧 Worker 不能令 run/document 失败', async () => {
    for (const [version, count] of [
      [2, 1],
      [1, 0],
    ]) {
      const tx = ownedTx('running', version, count);
      const { service, pubsub } = makeService({
        transaction: jest.fn((cb: (value: typeof tx) => unknown) => cb(tx)),
      });
      await (
        service as unknown as {
          failOrRetry(value: unknown, error: Error): Promise<void>;
        }
      ).failOrRetry(
        {
          task: makeTaskRow({ attempts_made: 2 }),
          run: { id: 20n, document_id: 30n },
          document: makeDocument(),
          executionVersion: 1,
        },
        new Error('exhausted'),
      );
      expect(tx.b_document_processing_runs.updateMany).not.toHaveBeenCalled();
      expect(tx.b_documents.updateMany).not.toHaveBeenCalled();
      expect(pubsub.publish).not.toHaveBeenCalled();
    }
  });

  it.each(['chunk', 'embed', 'vector_index', 'search_index'])(
    '%s 的迟到完成不能推进失败 run 或失效 execution',
    async (stage) => {
      const hash = 'a'.repeat(64);
      const ast = new MarkdownParserService({} as RuntimeConfig).parseMarkdown(
        '正文',
      );
      const artifact = {
        schemaVersion: 1,
        processingRunId: '20',
        taskId: '10',
        batchNo: 1,
        executionVersion: 1,
        embeddingConfigHash: hash,
        dimension: 3,
        rows: [{ chunkId: '11', contentHash: hash, vector: [1, 0, 0] }],
        createdAt: new Date().toISOString(),
      };
      const targets = {
        schemaVersion: 1,
        qdrant: {
          collection: 'server_next_chunks_abc',
          vectorName: 'dense',
          dimension: 3,
          metric: 'Cosine',
          schemaHash: hash,
        },
        elasticsearch: {
          physicalIndex: 'server-next-chunks-v1',
          mappingVersion: 1,
          mappingHash: hash,
        },
      };
      for (const [status, version] of [
        ['failed', 1],
        ['running', 2],
      ] as const) {
        const tx = ownedTx(status, version);
        const { service, prisma, pubsub } = makeService({
          transaction: jest.fn((cb: (value: typeof tx) => unknown) => cb(tx)),
          findTask: jest
            .fn()
            .mockResolvedValue({ result_json: { vectorKey: 'vectors.json' } }),
        });
        const publishing = { tryPublish: jest.fn() };
        Object.assign(prisma.b_document_processing_tasks, {
          findFirst: jest
            .fn()
            .mockResolvedValue({ result_json: { astKey: 'ast.json' } }),
        });
        Object.assign(prisma, {
          b_document_chunks: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 11n,
                content: '正文',
                content_hash: hash,
                chunk_level: 3,
              },
            ]),
          },
        });
        Object.assign(service, {
          chunker: { createChunks: jest.fn().mockReturnValue([]) },
          embedding: { embed: jest.fn().mockResolvedValue([[1, 0, 0]]) },
          qdrant: { ensure: jest.fn(), upsert: jest.fn() },
          elasticsearch: {
            ensure: jest.fn(),
            bulk: jest.fn(),
            refresh: jest.fn(),
          },
          publishing,
          storage: {
            putObject: jest.fn(),
            readObject: jest
              .fn()
              .mockImplementation(({ key }: { key: string }) =>
                Promise.resolve(
                  Readable.from([
                    JSON.stringify(key === 'ast.json' ? ast : artifact),
                  ]),
                ),
              ),
          },
        });
        await (
          service as unknown as {
            executeClaimed(value: unknown, signal: AbortSignal): Promise<void>;
          }
        ).executeClaimed(
          {
            task: makeTaskRow({
              stage,
              scope_json: { chunkIds: ['11'] },
              parent_task_id: 9n,
            }),
            run: {
              id: 20n,
              embedding_dimension: 3,
              embedding_config_hash: hash,
              index_targets_json: targets,
            },
            document: makeDocument(),
            executionVersion: 1,
          },
          new AbortController().signal,
        );
        expect(tx.b_document_processing_tasks.create).not.toHaveBeenCalled();
        expect(
          tx.b_document_processing_tasks.updateMany,
        ).not.toHaveBeenCalled();
        expect(tx.b_document_processing_runs.updateMany).not.toHaveBeenCalled();
        expect(tx.b_outbox_events.create).not.toHaveBeenCalled();
        expect(publishing.tryPublish).not.toHaveBeenCalled();
        expect(pubsub.publish).not.toHaveBeenCalled();
      }
    },
  );

  it('挂起任务到期后停止心跳并进入失败/重试处理', async () => {
    const { service, prisma } = makeService();
    Object.assign(service, {
      runtime: { worker: { taskTimeoutMs: 20, heartbeatIntervalMs: 5 } },
    });
    const internals = service as unknown as {
      claim(): Promise<unknown>;
      executeClaimed(value: unknown, signal: AbortSignal): Promise<void>;
      failOrRetry(value: unknown, error: Error): Promise<void>;
    };
    jest
      .spyOn(internals, 'claim')
      .mockResolvedValue({ task: makeTaskRow(), executionVersion: 1 });
    let signal: AbortSignal | undefined;
    jest
      .spyOn(internals, 'executeClaimed')
      .mockImplementation((_claimed, value) => {
        signal = value;
        return new Promise(() => undefined);
      });
    const fail = jest
      .spyOn(internals, 'failOrRetry')
      .mockResolvedValue(undefined);
    await service.handle({
      data: {
        schemaVersion: 1,
        taskId: '10',
        processingRunId: '20',
        attemptNo: 1,
      },
    } as never);
    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'TASK_TIMEOUT' }),
    );
    expect(signal?.aborted).toBe(true);
    const heartbeatCalls = (
      prisma.b_document_processing_tasks.updateMany as jest.Mock
    ).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(prisma.b_document_processing_tasks.updateMany).toHaveBeenCalledTimes(
      heartbeatCalls,
    );
  });

  it('Embedding 按条数和 Token 双重组批，并拒绝不可拆分的超限 Chunk', () => {
    const chunks = [4, 6, 3, 2].map((token_count, index) => ({
      id: BigInt(index + 1),
      token_count,
    }));
    expect(
      batchEmbeddingChunks(chunks, 2, 8).map((batch) =>
        batch.map((chunk) => chunk.id),
      ),
    ).toEqual([[1n], [2n], [3n, 4n]]);
    expect(() => batchEmbeddingChunks(chunks, 2, 5)).toThrow('Token 上限');
  });
});
