/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Fetch mock call records expose untyped RequestInit values.
import { EmbeddingService } from '@app/modules/ingestion/pipeline/embedding.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

function makeConfig() {
  return {
    schemaVersion: 1,
    provider: 'bailian',
    model: 'text-embedding-v4',
    revision: 'stable',
    dimension: 3,
    inputMode: 'document',
    normalization: { normalize: false },
    parameters: {},
  };
}

function makeService(worker: Record<string, number> = {}) {
  const runtime = {
    worker: {
      batchSize: 10,
      embeddingBatchTokens: 1000,
      taskTimeoutMs: 1000,
      providerRateLimitPerSecond: 100,
      ...worker,
    },
    embedding: {
      baseUrl: 'https://dashscope.example/v1',
      apiKey: 'secret',
    },
  } as unknown as RuntimeConfig;
  return new EmbeddingService(runtime);
}

function mockEmbeddingResponse(
  rows: Array<{ embedding: number[]; index: number }>,
) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ data: rows }),
  } as unknown as Response;
}

describe('EmbeddingService（P4-6）', () => {
  afterEach(() => jest.restoreAllMocks());

  it('按 run 配置维度调用并返回按 index 排序的向量', async () => {
    const service = makeService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      mockEmbeddingResponse([
        { embedding: [1, 0, 0], index: 1 },
        { embedding: [0, 1, 0], index: 0 },
      ]),
    );

    const vectors = await service.embed(makeConfig(), ['a', 'b']);

    expect(vectors).toEqual([
      [0, 1, 0],
      [1, 0, 0],
    ]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1]?.body as string) ?? '{}',
    );
    expect(body.model).toBe('text-embedding-v4');
    expect(body.dimensions).toBe(3);
    expect(body.input).toEqual(['a', 'b']);
  });

  it('返回向量数量与输入不一致时抛错', async () => {
    const service = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        mockEmbeddingResponse([{ embedding: [1, 0, 0], index: 0 }]),
      );

    await expect(service.embed(makeConfig(), ['a', 'b'])).rejects.toThrow(
      'EMBEDDING_COUNT_MISMATCH',
    );
  });

  it('返回维度与配置不一致时抛错', async () => {
    const service = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        mockEmbeddingResponse([{ embedding: [1, 0], index: 0 }]),
      );

    await expect(service.embed(makeConfig(), ['a'])).rejects.toThrow(
      'EMBEDDING_DIMENSION_MISMATCH',
    );
  });

  it('返回非有限数值时抛错', async () => {
    const service = makeService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        mockEmbeddingResponse([{ embedding: [1, Number.NaN, 0], index: 0 }]),
      );

    await expect(service.embed(makeConfig(), ['a'])).rejects.toThrow(
      'EMBEDDING_NON_FINITE',
    );
  });

  it('空输入直接返回空数组，不发起外部调用', async () => {
    const service = makeService();
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.embed(makeConfig(), [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('条数或实际 Token 超限时不会请求 Provider', async () => {
    const service = makeService({ batchSize: 1, embeddingBatchTokens: 1 });
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.embed(makeConfig(), ['a', 'b'])).rejects.toThrow(
      '上限',
    );
    await expect(service.embed(makeConfig(), ['hello world'])).rejects.toThrow(
      '上限',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('并发请求按 Provider 速率间隔启动', async () => {
    const service = makeService({ providerRateLimitPerSecond: 20 });
    const started: number[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      started.push(Date.now());
      return Promise.resolve(
        mockEmbeddingResponse([{ embedding: [1, 0, 0], index: 0 }]),
      );
    });
    await Promise.all([
      service.embed(makeConfig(), ['a']),
      service.embed(makeConfig(), ['b']),
      service.embed(makeConfig(), ['c']),
    ]);
    expect(started).toHaveLength(3);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(45);
    expect(started[2] - started[1]).toBeGreaterThanOrEqual(45);
  });

  it('限流等待被取消后不发起请求，后续请求仍能继续', async () => {
    const service = makeService({ providerRateLimitPerSecond: 10 });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        mockEmbeddingResponse([{ embedding: [1, 0, 0], index: 0 }]),
      );
    await service.embed(makeConfig(), ['a']);
    const controller = new AbortController();
    const pending = service.embed(makeConfig(), ['b'], controller.signal);
    controller.abort(new Error('TASK_TIMEOUT'));
    await expect(pending).rejects.toThrow('TASK_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(service.embed(makeConfig(), ['c'])).resolves.toEqual([
      [1, 0, 0],
    ]);
  });

  it('请求超时会中止挂起的 Fetch', async () => {
    const service = makeService({ taskTimeoutMs: 20 });
    jest.spyOn(global, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('EMBEDDING_REQUEST_ABORTED')),
            { once: true },
          );
        }),
    );
    await expect(service.embed(makeConfig(), ['a'])).rejects.toThrow();
  });
});
