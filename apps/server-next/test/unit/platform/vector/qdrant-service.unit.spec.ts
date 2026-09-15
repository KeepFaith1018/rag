import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantService } from '@platform/vector/vector.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn(),
}));

const PAYLOAD_INDEXES = [
  'kbId',
  'documentId',
  'processingRunId',
  'chunkId',
  'chunkLevel',
  'embeddingConfigHash',
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hashJson(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    collection: 'server_next_chunks_abc',
    vectorName: 'dense' as const,
    dimension: 1024,
    metric: 'Cosine' as const,
    schemaHash: hashJson({
      vectorName: 'dense',
      dimension: 1024,
      metric: 'Cosine',
      payloadIndexes: PAYLOAD_INDEXES,
    }),
    ...overrides,
  };
}

function makeClient() {
  return {
    collectionExists: jest.fn().mockResolvedValue({ exists: false }),
    createCollection: jest.fn().mockResolvedValue(true),
    createPayloadIndex: jest.fn().mockResolvedValue({}),
    getCollection: jest.fn(),
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue({ count: 1 }),
  };
}

function makeService() {
  const client = makeClient();
  (QdrantClient as unknown as jest.Mock).mockReturnValue(client);
  const runtime = {
    worker: { taskTimeoutMs: 1000 },
    qdrant: { url: 'http://qdrant:6333', apiKey: 'key' },
  } as unknown as RuntimeConfig;
  const service = new QdrantService(runtime);
  return { service, client };
}

function collectionInfo(
  overrides: {
    vectorSize?: number;
    vectorDistance?: string;
    chunkLevelType?: string;
  } = {},
) {
  return {
    config: {
      params: {
        vectors: {
          dense: {
            size: overrides.vectorSize ?? 1024,
            distance: overrides.vectorDistance ?? 'Cosine',
          },
        },
      },
    },
    payload_schema: {
      kbId: { data_type: 'keyword' },
      documentId: { data_type: 'keyword' },
      processingRunId: { data_type: 'keyword' },
      chunkId: { data_type: 'keyword' },
      chunkLevel: { data_type: overrides.chunkLevelType ?? 'integer' },
      embeddingConfigHash: { data_type: 'keyword' },
    },
  };
}

describe('QdrantService SDK 适配（P4-6）', () => {
  it('collection 不存在时创建并建立 payload 索引', async () => {
    const { service, client } = makeService();

    await service.ensure(makeTarget());

    expect(client.createCollection).toHaveBeenCalledWith(
      'server_next_chunks_abc',
      expect.objectContaining({
        vectors: { dense: { size: 1024, distance: 'Cosine' } },
      }),
    );
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(6);
    expect(client.createPayloadIndex).toHaveBeenCalledWith(
      'server_next_chunks_abc',
      expect.objectContaining({
        field_name: 'chunkLevel',
        field_schema: 'integer',
      }),
    );
  });

  it('collection 已存在且 Schema 匹配时复用，不重复创建', async () => {
    const { service, client } = makeService();
    client.collectionExists.mockResolvedValue({ exists: true });
    client.getCollection.mockResolvedValue(collectionInfo());

    await service.ensure(makeTarget());

    expect(client.createCollection).not.toHaveBeenCalled();
    expect(client.getCollection).toHaveBeenCalledWith('server_next_chunks_abc');
  });

  it('已存在 collection 的向量维度/度量不匹配时拒绝', async () => {
    const { service, client } = makeService();
    client.collectionExists.mockResolvedValue({ exists: true });
    client.getCollection.mockResolvedValue(collectionInfo({ vectorSize: 512 }));

    await expect(service.ensure(makeTarget())).rejects.toThrow(
      'QDRANT_SCHEMA_CONFLICT',
    );
  });

  it('Schema hash 与运行配置不一致时拒绝', async () => {
    const { service } = makeService();

    await expect(
      service.ensure(makeTarget({ schemaHash: 'f'.repeat(64) })),
    ).rejects.toThrow('QDRANT_SCHEMA_HASH_CONFLICT');
  });

  it('upsert 使用命名向量与稳定 payload', async () => {
    const { service, client } = makeService();
    const target = makeTarget();

    await service.upsert(target, [
      {
        id: 'point-1',
        vector: [1, 0, 0],
        payload: { kbId: '9', chunkLevel: 3 },
      },
    ]);

    expect(client.upsert).toHaveBeenCalledWith(
      'server_next_chunks_abc',
      expect.objectContaining({
        wait: true,
        points: [
          expect.objectContaining({
            id: 'point-1',
            vector: { dense: [1, 0, 0] },
            payload: { kbId: '9', chunkLevel: 3 },
          }),
        ],
      }),
    );
  });

  it('deleteRun 与 countRun 使用 processingRunId 过滤', async () => {
    const { service, client } = makeService();
    client.collectionExists.mockResolvedValue({ exists: true });

    await service.deleteRun(makeTarget(), '20');
    expect(client.delete).toHaveBeenCalledWith(
      'server_next_chunks_abc',
      expect.objectContaining({
        filter: {
          must: [{ key: 'processingRunId', match: { value: '20' } }],
        },
      }),
    );

    await expect(service.countRun(makeTarget(), '20')).resolves.toBe(1);
    expect(client.count).toHaveBeenCalledWith(
      'server_next_chunks_abc',
      expect.objectContaining({ exact: true }),
    );
  });
  it('清理从未创建 collection 的 run 时幂等成功，不吞掉网络错误', async () => {
    const { service, client } = makeService();
    await expect(
      service.deleteRun(makeTarget(), '20'),
    ).resolves.toBeUndefined();
    await expect(service.countRun(makeTarget(), '20')).resolves.toBe(0);
    expect(client.delete).not.toHaveBeenCalled();
    client.collectionExists.mockRejectedValue(new Error('network failure'));
    await expect(service.countRun(makeTarget(), '20')).rejects.toThrow(
      'QDRANT_UNAVAILABLE',
    );
  });
});
