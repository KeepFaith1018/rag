/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// Prisma JSON mock payloads are intentionally partial in this unit test.
import { ProcessingCoordinatorService } from '@app/modules/ingestion/application/processing-coordinator.service';
import { PrismaService } from '@platform/database/prisma.service';
import { BusinessError } from '@shared/errors/business-error';
import { ErrorCode } from '@shared/errors/error-code';

const HASH = 'a'.repeat(64);

function makeEmbedding() {
  return {
    config: {
      schemaVersion: 1,
      provider: 'bailian',
      model: 'text-embedding-v4',
      revision: 'stable',
      dimension: 1024,
      inputMode: 'document',
      normalization: { normalize: true },
      parameters: {},
    },
    hash: HASH,
    apiKey: 'secret',
    baseUrl: 'https://dashscope.example/v1',
  };
}

function makeTransactionClient() {
  return {
    b_document_processing_runs: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 20n }),
    },
    b_document_processing_tasks: {
      create: jest.fn().mockResolvedValue({ id: 10n }),
      update: jest.fn().mockResolvedValue({}),
    },
    b_documents: { update: jest.fn().mockResolvedValue({}) },
    b_outbox_events: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeService(overrides: { defaultEmbedding?: jest.Mock } = {}) {
  const models = {
    defaultEmbedding:
      overrides.defaultEmbedding ??
      jest.fn().mockResolvedValue(makeEmbedding()),
  };
  const service = new ProcessingCoordinatorService(
    {} as PrismaService,
    models as never,
  );
  return { service, models };
}

describe('ProcessingCoordinator 首个 run 创建（P4-2）', () => {
  it('在同一事务创建 run、parse task 与 dispatch Outbox，并固定 desired_run_id', async () => {
    const tx = makeTransactionClient();
    const { service } = makeService();

    const result = await service.createInitialRun(tx as never, {
      documentId: 30n,
      sourceSha256: 'b'.repeat(64),
    });

    expect(result.run).toEqual({ id: 20n });
    expect(result.task).toEqual({ id: 10n });

    expect(tx.b_document_processing_runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          document_id: 30n,
          status: 'queued',
          current_stage: 'parse',
          embedding_config_hash: HASH,
          source_sha256: 'b'.repeat(64),
        }),
      }),
    );

    expect(tx.b_document_processing_tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload_json: expect.objectContaining({ taskId: '10' }),
        }),
      }),
    );

    expect(tx.b_documents.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 30n },
        data: { desired_run_id: 20n, status: 'processing' },
      }),
    );

    expect(tx.b_outbox_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_key: 'dispatch-task-10-attempt-1',
          event_type: 'dispatch_processing_task',
        }),
      }),
    );
  });

  it('默认 embedding 配置缺失时不创建任何 run，直接抛出稳定错误', async () => {
    const tx = makeTransactionClient();
    const { service } = makeService({
      defaultEmbedding: jest
        .fn()
        .mockRejectedValue(
          new BusinessError(
            ErrorCode.DOCUMENT_MODEL_CONFIG_UNAVAILABLE,
            '默认向量模型不可用',
            'conflict',
          ),
        ),
    });

    await expect(
      service.createInitialRun(tx as never, {
        documentId: 30n,
        sourceSha256: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DOCUMENT_MODEL_CONFIG_UNAVAILABLE,
    });

    expect(tx.b_document_processing_runs.create).not.toHaveBeenCalled();
    expect(tx.b_outbox_events.create).not.toHaveBeenCalled();
  });
});
