/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// Elasticsearch SDK mock calls are dynamically shaped by the client library.
import { Client } from '@elastic/elasticsearch';
import { ElasticsearchService } from '@platform/search/search.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn(),
}));

const HASH = 'a'.repeat(64);

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    physicalIndex: 'server-next-chunks-v1',
    mappingVersion: 1,
    mappingHash: HASH,
    ...overrides,
  };
}

function makeClient() {
  return {
    indices: {
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue({}),
      getMapping: jest.fn(),
      refresh: jest.fn().mockResolvedValue({}),
    },
    bulk: jest.fn().mockResolvedValue({ errors: false, items: [] }),
    deleteByQuery: jest.fn().mockResolvedValue({ deleted: 1 }),
    count: jest.fn().mockResolvedValue({ count: 1 }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService() {
  const client = makeClient();
  (Client as unknown as jest.Mock).mockReturnValue(client);
  const runtime = {
    worker: { taskTimeoutMs: 1000 },
    elasticsearch: {
      url: 'http://es:9200',
      username: 'elastic',
      password: 'secret',
    },
  } as unknown as RuntimeConfig;
  const service = new ElasticsearchService(runtime);
  return { service, client, runtime };
}

describe('ElasticsearchService SDK 适配（P4-6）', () => {
  it('物理索引不存在时创建并写入 mapping hash 元数据', async () => {
    const { service, client } = makeService();

    await service.ensure(makeTarget());

    expect(client.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'server-next-chunks-v1',
        mappings: expect.objectContaining({
          _meta: { serverNextMappingHash: HASH },
          dynamic: 'strict',
        }),
      }),
    );
  });

  it('物理索引已存在且 mapping hash 匹配时复用', async () => {
    const { service, client } = makeService();
    client.indices.exists.mockResolvedValue(true);
    client.indices.getMapping.mockResolvedValue({
      'server-next-chunks-v1': {
        mappings: { _meta: { serverNextMappingHash: HASH } },
      },
    });

    await service.ensure(makeTarget());

    expect(client.indices.create).not.toHaveBeenCalled();
  });

  it('已存在索引的 mapping hash 不一致时拒绝写入', async () => {
    const { service, client } = makeService();
    client.indices.exists.mockResolvedValue(true);
    client.indices.getMapping.mockResolvedValue({
      'server-next-chunks-v1': {
        mappings: { _meta: { serverNextMappingHash: 'b'.repeat(64) } },
      },
    });

    await expect(service.ensure(makeTarget())).rejects.toThrow(
      'ELASTICSEARCH_MAPPING_CONFLICT',
    );
  });

  it('bulk 使用扁平 operations 与稳定 document ID', async () => {
    const { service, client } = makeService();
    const doc = {
      id: 'stable-id',
      kbId: '9',
      documentId: '30',
      processingRunId: '20',
      chunkId: '10',
      chunkLevel: 3,
      embeddingConfigHash: HASH,
      content: 'hello',
    };

    await service.bulk(makeTarget(), [doc]);

    expect(client.bulk).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [
          { index: { _index: 'server-next-chunks-v1', _id: 'stable-id' } },
          doc,
        ],
      }),
    );
  });

  it('bulk 响应存在失败项时抛错', async () => {
    const { service, client } = makeService();
    client.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { error: { type: 'mapper_parsing_exception' } } }],
    });

    await expect(
      service.bulk(makeTarget(), [
        {
          id: 'x',
          kbId: '9',
          documentId: '30',
          processingRunId: '20',
          chunkId: '10',
          chunkLevel: 3,
          embeddingConfigHash: HASH,
          content: 'hello',
        },
      ]),
    ).rejects.toThrow('ELASTICSEARCH_BULK_FAILED');
  });

  it('deleteRun 与 countRun 使用 processingRunId term 查询', async () => {
    const { service, client } = makeService();

    await service.deleteRun(makeTarget(), '20');
    expect(client.deleteByQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'server-next-chunks-v1',
        query: { term: { processingRunId: '20' } },
        conflicts: 'proceed',
        refresh: true,
      }),
    );

    await expect(service.countRun(makeTarget(), '20')).resolves.toBe(1);
    expect(client.count).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'server-next-chunks-v1',
        query: { term: { processingRunId: '20' } },
      }),
    );
  });

  it('销毁时关闭客户端连接', async () => {
    const { service, client } = makeService();

    await service.onModuleDestroy();

    expect(client.close).toHaveBeenCalled();
  });
});
