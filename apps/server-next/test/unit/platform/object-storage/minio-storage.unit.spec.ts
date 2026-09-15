import { PassThrough } from 'node:stream';
import { MinioStorageService } from '@platform/object-storage/minio-storage.service';
import { StorageError } from '@platform/object-storage/storage-adapter';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    documentStorage: {
      endpoint: 'http://127.0.0.1:19000',
      accessKey: 'access',
      secretKey: 'secret',
      region: 'us-east-1',
      requestTimeoutMs: 1000,
      streamTimeoutMs: 1000,
      ...overrides,
    },
  } as unknown as RuntimeConfig;
}

const services = new Set<MinioStorageService>();

function makeService(overrides: Record<string, unknown> = {}) {
  const service = new MinioStorageService(makeConfig(overrides));
  services.add(service);
  return service;
}

function mockSend(service: MinioStorageService) {
  const client = (
    service as unknown as {
      client: { send: (...args: unknown[]) => Promise<unknown> };
    }
  ).client;
  return jest.spyOn(client, 'send');
}

describe('MinioStorageService', () => {
  afterEach(() => {
    for (const service of services) service.onModuleDestroy();
    services.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('生成限定到指定分片和上传会话的预签名 URL', async () => {
    const service = makeService();

    const url = new URL(
      await service.signPart({
        bucket: 'rag-documents',
        key: 'knowledge-bases/9/documents/session-1.txt',
        uploadId: 'multipart-1',
        partNumber: 2,
        expiresInSeconds: 900,
      }),
    );

    expect(url.pathname).toBe(
      '/rag-documents/knowledge-bases/9/documents/session-1.txt',
    );
    expect(url.searchParams.get('partNumber')).toBe('2');
    expect(url.searchParams.get('uploadId')).toBe('multipart-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('遍历 ListParts 的全部分页并规范化 ETag', async () => {
    const service = makeService();
    const send = mockSend(service)
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 5 }],
        IsTruncated: true,
        NextPartNumberMarker: '1',
      })
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 2, ETag: 'etag-2', Size: 3 }],
        IsTruncated: false,
      });

    await expect(
      service.listParts({
        bucket: 'rag-documents',
        key: 'document.txt',
        uploadId: 'multipart-1',
      }),
    ).resolves.toEqual([
      { partNumber: 1, etag: 'etag-1', size: 5 },
      { partNumber: 2, etag: 'etag-2', size: 3 },
    ]);
    expect(
      (send.mock.calls[1][0] as { input: { PartNumberMarker?: string } }).input
        .PartNumberMarker,
    ).toBe('1');
  });

  it('遍历 ListObjectsV2 的全部分页', async () => {
    const service = makeService();
    const send = mockSend(service)
      .mockResolvedValueOnce({
        Contents: [{ Key: 'runs/1/a' }],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'runs/1/b' }],
        IsTruncated: false,
      });

    await expect(
      service.listObjects({ bucket: 'rag-documents', prefix: 'runs/1/' }),
    ).resolves.toEqual(['runs/1/a', 'runs/1/b']);
    expect(
      (send.mock.calls[1][0] as { input: { ContinuationToken?: string } }).input
        .ContinuationToken,
    ).toBe('next-page');
  });

  it('拒绝缺少 ETag 的分片合并响应', async () => {
    const service = makeService();
    mockSend(service).mockResolvedValue({});

    await expect(
      service.completeMultipart({
        bucket: 'rag-documents',
        key: 'document.txt',
        uploadId: 'multipart-1',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      }),
    ).rejects.toMatchObject<Partial<StorageError>>({
      storageKind: 'invalid-response',
      operation: 'complete-multipart-upload',
    });
  });

  it('将 Provider 异常转换成稳定的存储错误分类', async () => {
    const service = makeService();
    mockSend(service).mockRejectedValue(
      Object.assign(new Error('provider detail'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404, requestId: 'request-1' },
      }),
    );

    await expect(
      service.headObject({ bucket: 'rag-documents', key: 'missing.txt' }),
    ).rejects.toMatchObject<Partial<StorageError>>({
      storageKind: 'not-found',
      statusCode: 404,
      providerCode: 'NoSuchKey',
      requestId: 'request-1',
    });
  });

  it('中止一个已不存在的分片会话时保持幂等', async () => {
    const service = makeService();
    mockSend(service).mockRejectedValue(
      Object.assign(new Error('provider detail'), {
        name: 'NoSuchUpload',
        $metadata: { httpStatusCode: 404 },
      }),
    );

    await expect(
      service.abortMultipart({
        bucket: 'rag-documents',
        key: 'document.txt',
        uploadId: 'missing-upload',
      }),
    ).resolves.toBeUndefined();
  });

  it('为命令传入请求截止信号', async () => {
    const service = makeService();
    const send = mockSend(service).mockResolvedValue({ ContentLength: 1 });

    await service.headObject({ bucket: 'rag-documents', key: 'document.txt' });

    const options = send.mock.calls[0][1] as { abortSignal?: unknown };
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('流读取超过期限时主动中止源连接', async () => {
    jest.useFakeTimers();
    const source = new PassThrough();
    const service = makeService({ streamTimeoutMs: 10 });
    mockSend(service).mockResolvedValue({ Body: source });
    const stream = await service.readObject({
      bucket: 'rag-documents',
      key: 'document.txt',
    });
    const error = new Promise<Error>((resolve) =>
      stream.once('error', resolve),
    );

    jest.advanceTimersByTime(11);

    await expect(error).resolves.toMatchObject<Partial<StorageError>>({
      storageKind: 'timeout',
      operation: 'get-object',
    });
    expect(source.destroyed).toBe(true);
  });
});
