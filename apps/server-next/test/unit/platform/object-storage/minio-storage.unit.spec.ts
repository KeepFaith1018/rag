import { MinioStorageService } from '@platform/object-storage/minio-storage.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

function makeConfig() {
  return {
    documentStorage: {
      endpoint: 'http://127.0.0.1:19000',
      accessKey: 'access',
      secretKey: 'secret',
      region: 'us-east-1',
    },
  } as unknown as RuntimeConfig;
}

describe('MinioStorageService XML 响应解析', () => {
  afterEach(() => jest.restoreAllMocks());

  it('解析分片列表时解码 XML numeric entity，返回可比较的 ETag', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(
        '<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>&#34;4acc4903a9b4b3c432b5a7d9647ef5f5&#34;</ETag><Size>16212</Size></Part></ListPartsResult>',
      ),
    } as unknown as Response);

    const service = new MinioStorageService(makeConfig());

    await expect(
      service.listParts({
        bucket: 'rag-documents',
        key: 'knowledge-bases/9/documents/session-1.txt',
        uploadId: 'multipart-1',
      }),
    ).resolves.toEqual([
      {
        partNumber: 1,
        etag: '4acc4903a9b4b3c432b5a7d9647ef5f5',
        size: 16212,
      },
    ]);
  });
});
