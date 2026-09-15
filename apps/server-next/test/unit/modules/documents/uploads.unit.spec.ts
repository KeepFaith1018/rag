import { Readable } from 'node:stream';
import { UploadsService } from '@app/modules/documents/services/uploads.service';
import { DocumentsService } from '@app/modules/documents/services/documents.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { PrismaService } from '@platform/database/prisma.service';
import type { StorageAdapter } from '@platform/object-storage/storage-adapter';
import { ErrorCode } from '@shared/errors/error-code';

function makeSubject() {
  return {
    id: 9n,
    owner_id: 1n,
    visibility: 'private' as const,
    allow_public_download: false,
    kb_members: [],
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 11n,
    session_id: 'session-1',
    kb_id: 9n,
    user_id: 1n,
    document_id: null,
    storage_provider: 'minio',
    storage_bucket: 'rag-documents',
    storage_key: 'knowledge-bases/9/documents/session-1.txt',
    multipart_upload_id: 'multipart-1',
    file_name: 'notes.txt',
    title: 'notes.txt',
    file_size: 3n,
    mime_type: 'text/plain',
    client_sha256: null,
    file_extension: '.txt',
    part_size: 5 * 1024 * 1024,
    total_parts: 1,
    uploaded_parts: 0,
    uploaded_bytes: 0n,
    status: 'initiated',
    expires_at: new Date(Date.now() + 60_000),
    last_activity_at: null,
    completed_at: null,
    aborted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    upload_parts: [
      {
        id: 21n,
        upload_session_id: 11n,
        part_number: 1,
        expected_size: 3,
        actual_size: null,
        etag: null,
        checksum_sha256: null,
        status: 'pending',
        attempt_count: 0,
        last_error: null,
        uploaded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    ...overrides,
  };
}

function makeConfig() {
  return {
    documentStorage: {
      endpoint: 'http://127.0.0.1:19000',
      accessKey: 'access',
      secretKey: 'secret',
      bucket: 'rag-documents',
      region: 'us-east-1',
      partSize: 5 * 1024 * 1024,
      sessionTtlSeconds: 3600,
    },
  } as unknown as RuntimeConfig;
}

function makeAccess() {
  return {
    subject: jest.fn().mockResolvedValue(makeSubject()),
    requireRead: jest.fn().mockReturnValue('owner'),
    permissions: jest.fn().mockReturnValue({
      canUpload: true,
      canDeleteAnyDocument: true,
      canDeleteOwnDocument: true,
    }),
  };
}

function makeStorage(): jest.Mocked<StorageAdapter> {
  return {
    putObject: jest.fn().mockResolvedValue({ etag: 'avatar-etag' }),
    createMultipart: jest.fn().mockResolvedValue({ uploadId: 'multipart-1' }),
    signPart: jest.fn().mockResolvedValue('https://storage.test/signed-part'),
    listParts: jest.fn().mockResolvedValue([]),
    completeMultipart: jest.fn().mockResolvedValue({ etag: 'complete-etag' }),
    abortMultipart: jest.fn().mockResolvedValue(undefined),
    headObject: jest
      .fn()
      .mockResolvedValue({ size: 3, etag: 'etag', contentType: 'text/plain' }),
    readObject: jest
      .fn()
      .mockResolvedValue(Readable.from([Buffer.from('abc')])),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    listObjects: jest.fn().mockResolvedValue([]),
  };
}

describe('文档上传首期状态机', () => {
  it('同一知识库内命中可信对象时返回已有文档，不创建新 session', async () => {
    const storage = makeStorage();
    const document = {
      id: 31n,
      title: 'old.txt',
      original_filename: 'old.txt',
      file_extension: '.txt',
      mime_type: 'text/plain',
      storage_bucket: 'rag-documents',
      storage_key: 'documents/31.txt',
      file_size: 3n,
      file_sha256: 'a'.repeat(64),
      status: 'processing',
      created_at: new Date(),
      updated_at: new Date(),
    };
    storage.headObject.mockResolvedValue({
      size: 3,
      etag: 'etag-31',
      contentType: 'text/plain',
    });
    const findMany = jest.fn().mockResolvedValue([document]);
    const prisma = {
      b_documents: { findMany },
      b_upload_sessions: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      storage,
    );

    const result = await service.init(1n, '9', {
      fileName: 'new-name.txt',
      fileSize: 3,
      mimeType: 'text/plain',
      clientSha256: 'a'.repeat(64),
    });

    expect(result.isInstantUploaded).toBe(true);
    expect(result.uploadId).toBeNull();
    expect(result.documentId).toBe('31');
    expect(storage.createMultipart.mock.calls).toHaveLength(0);
  });

  it('重复 Complete 在已完成 session 上返回同一 document', async () => {
    const session = makeSession({ status: 'completed', document_id: 31n });
    const document = {
      id: 31n,
      title: 'notes.txt',
      original_filename: 'notes.txt',
      file_extension: '.txt',
      mime_type: 'text/plain',
      file_size: 3n,
      status: 'processing',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      b_upload_sessions: { findFirst: jest.fn().mockResolvedValue(session) },
      b_documents: { findUniqueOrThrow: jest.fn().mockResolvedValue(document) },
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      makeStorage(),
    );

    const result = await service.complete(1n, '9', 'session-1');

    expect(result.documentId).toBe('31');
    expect(result.uploadId).toBeNull();
  });

  it('初始化时创建 session 和连续的 part 记录', async () => {
    const storage = makeStorage();
    const created = makeSession({ file_size: 6_000_000, total_parts: 2 });
    const tx = {
      b_upload_sessions: {
        create: jest.fn().mockResolvedValue({ id: 11n }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
      b_upload_parts: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      b_documents: { findMany: jest.fn().mockResolvedValue([]) },
      b_upload_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      storage,
    );

    const result = await service.init(1n, '9', {
      fileName: 'notes.txt',
      fileSize: 6_000_000,
      mimeType: 'text/plain',
      clientSha256: 'a'.repeat(64),
    });

    expect(result.isInstantUploaded).toBe(false);
    const createManyCalls = tx.b_upload_parts.createMany.mock
      .calls as unknown as [
      [{ data: Array<{ part_number: number; expected_size: number }> }],
    ];
    expect(createManyCalls[0][0].data).toEqual([
      expect.objectContaining({
        part_number: 1,
        expected_size: 5 * 1024 * 1024,
      }),
      expect.objectContaining({ part_number: 2, expected_size: 757_120 }),
    ]);
  });

  it('拒绝扩展名和 MIME 不匹配的初始化请求', async () => {
    const prisma = {
      b_documents: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      makeStorage(),
    );

    await expect(
      service.init(1n, '9', {
        fileName: 'notes.txt',
        fileSize: 3,
        mimeType: 'application/pdf',
        clientSha256: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PARAM_ERROR });
  });

  it('重复确认同一 part 不重复累计字节', async () => {
    const storage = makeStorage();
    storage.listParts.mockResolvedValue([
      { partNumber: 1, etag: 'etag-1', size: 3 },
    ]);
    const initial = makeSession();
    const confirmed = makeSession({
      status: 'uploading',
      uploaded_parts: 1,
      uploaded_bytes: 3n,
      upload_parts: [
        {
          ...initial.upload_parts[0],
          status: 'uploaded',
          actual_size: 3,
          etag: 'etag-1',
        },
      ],
    });
    const tx = {
      b_upload_parts: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ actual_size: 3 }]),
      },
      b_upload_sessions: { update: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      b_upload_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(confirmed)
          .mockResolvedValueOnce(confirmed),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      storage,
    );

    const result = await service.confirmPart(1n, '9', 'session-1', 1, {
      etag: '"ETAG-1"',
    });

    expect(result.uploadedBytes).toBe(3n);
    expect(result.uploadedParts).toHaveLength(1);
    const updateCalls = tx.b_upload_sessions.update.mock.calls as unknown as [
      [{ data: { uploaded_bytes: bigint } }],
    ];
    expect(updateCalls[0][0].data.uploaded_bytes).toBe(3n);
  });

  it('服务端 SHA256 不匹配时不能登记文档', async () => {
    const storage = makeStorage();
    storage.listParts.mockResolvedValue([
      { partNumber: 1, etag: 'etag-1', size: 3 },
    ]);
    const session = makeSession({
      client_sha256: 'b'.repeat(64),
      status: 'uploading',
      upload_parts: [
        {
          ...makeSession().upload_parts[0],
          status: 'uploaded',
          actual_size: 3,
          etag: 'etag-1',
        },
      ],
    });
    const prisma = {
      b_upload_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(session)
          .mockResolvedValueOnce(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;
    const service = new UploadsService(
      prisma,
      makeAccess() as never,
      makeConfig(),
      storage,
    );

    await expect(service.complete(1n, '9', 'session-1')).rejects.toMatchObject({
      code: ErrorCode.DOCUMENT_UPLOAD_INTEGRITY_FAILED,
    });
  });
});

describe('文档删除故障边界', () => {
  it('删除请求只登记自包含 cleanup Outbox，不在 API 请求内删除对象', async () => {
    const storage = makeStorage();
    const document = {
      ...makeSession(),
      id: 31n,
      title: 'notes.txt',
      original_filename: 'notes.txt',
      file_extension: '.txt',
      mime_type: 'text/plain',
      uploader_id: 1n,
      file_sha256: 'a'.repeat(64),
      status: 'processing',
      storage_bucket: 'rag-documents',
      storage_key: 'documents/31.txt',
      b_users: { id: 1n, email: 'owner@example.test', full_name: 'Owner' },
      desired_run: null,
    };
    const updateMany = jest.fn((_input: unknown) =>
      Promise.resolve({ count: 1 }),
    );
    const transactionClient = {
      b_documents: { updateMany },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      b_document_processing_tasks: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      b_outbox_events: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      b_documents: {
        findFirst: jest.fn().mockResolvedValue(document),
        updateMany,
      },
      b_document_processing_runs: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (tx: typeof transactionClient) => unknown) =>
            callback(transactionClient),
        ),
    } as unknown as PrismaService;
    const service = new DocumentsService(
      prisma,
      makeAccess() as never,
      storage,
    );

    await expect(service.remove(1n, '9', '31')).resolves.toEqual({
      kbId: '9',
      documentId: '31',
      deleting: true,
      deleted: false,
    });
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { status: 'deleting' },
    });
    expect(storage.deleteObject.mock.calls).toHaveLength(0);
  });
});
