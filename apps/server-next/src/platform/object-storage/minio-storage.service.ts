import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PassThrough, Readable } from 'node:stream';
import { RuntimeConfig } from '../config/runtime-config.service';
import {
  StorageError,
  type StorageAdapter,
  type StorageErrorKind,
  type StorageObject,
  type StoragePart,
} from './storage-adapter';

/** 基于 AWS SDK v3 的 MinIO/S3-compatible 对象存储适配器。 */
@Injectable()
export class MinioStorageService implements StorageAdapter, OnModuleDestroy {
  private readonly client: S3Client;

  constructor(private readonly config: RuntimeConfig) {
    const storage = config.documentStorage;
    this.client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      credentials: {
        accessKeyId: storage.accessKey,
        secretAccessKey: storage.secretKey,
      },
      forcePathStyle: true,
      maxAttempts: 3,
      // S3-compatible 服务不一定支持 AWS 默认追加的 CRC32 校验头。
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async putObject(input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) {
    const result = await this.execute('put-object', (abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
        { abortSignal },
      ),
    );
    return { etag: normalizeEtag(result.ETag) };
  }

  async createMultipart(input: {
    bucket: string;
    key: string;
    contentType: string;
  }) {
    const result = await this.execute(
      'create-multipart-upload',
      (abortSignal) =>
        this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: input.bucket,
            Key: input.key,
            ContentType: input.contentType,
          }),
          { abortSignal },
        ),
    );
    if (!result.UploadId) throw this.invalidResponse('create-multipart-upload');
    return { uploadId: result.UploadId };
  }

  async signPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }) {
    if (
      !Number.isInteger(input.partNumber) ||
      input.partNumber < 1 ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 1 ||
      input.expiresInSeconds > 604800
    )
      throw this.invalidResponse('sign-upload-part');
    try {
      return await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: input.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: input.partNumber,
        }),
        { expiresIn: input.expiresInSeconds },
      );
    } catch (error) {
      throw toStorageError(error, 'sign-upload-part');
    }
  }

  async listParts(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<StoragePart[]> {
    const parts: StoragePart[] = [];
    let marker: string | undefined;
    const seenMarkers = new Set<string>();
    do {
      const result = await this.execute('list-parts', (abortSignal) =>
        this.client.send(
          new ListPartsCommand({
            Bucket: input.bucket,
            Key: input.key,
            UploadId: input.uploadId,
            PartNumberMarker: marker,
          }),
          { abortSignal },
        ),
      );
      for (const part of result.Parts ?? []) {
        if (
          part.PartNumber === undefined ||
          part.PartNumber < 1 ||
          part.Size === undefined ||
          !Number.isInteger(part.Size) ||
          !part.ETag
        )
          throw this.invalidResponse('list-parts');
        parts.push({
          partNumber: part.PartNumber,
          etag: normalizeEtag(part.ETag) ?? '',
          size: part.Size,
        });
      }
      if (!result.IsTruncated) break;
      marker = result.NextPartNumberMarker?.toString();
      if (!marker || seenMarkers.has(marker))
        throw this.invalidResponse('list-parts');
      seenMarkers.add(marker);
    } while (marker);
    return parts;
  }

  async completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    const result = await this.execute(
      'complete-multipart-upload',
      (abortSignal) =>
        this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: input.bucket,
            Key: input.key,
            UploadId: input.uploadId,
            MultipartUpload: {
              Parts: input.parts.map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
              })),
            },
          }),
          { abortSignal },
        ),
    );
    const etag = normalizeEtag(result.ETag);
    if (!etag) throw this.invalidResponse('complete-multipart-upload');
    return { etag };
  }

  async abortMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }) {
    try {
      await this.execute('abort-multipart-upload', (abortSignal) =>
        this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: input.bucket,
            Key: input.key,
            UploadId: input.uploadId,
          }),
          { abortSignal },
        ),
      );
    } catch (error) {
      // Abort 需要保持幂等：上传会话已不存在时视为清理完成。
      if (error instanceof StorageError && error.storageKind === 'not-found')
        return;
      throw error;
    }
  }

  async headObject(input: {
    bucket: string;
    key: string;
  }): Promise<StorageObject> {
    const result = await this.execute('head-object', (abortSignal) =>
      this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal },
      ),
    );
    if (
      result.ContentLength === undefined ||
      !Number.isInteger(result.ContentLength) ||
      result.ContentLength < 0
    )
      throw this.invalidResponse('head-object');
    return {
      size: result.ContentLength,
      etag: normalizeEtag(result.ETag),
      contentType: result.ContentType ?? null,
    };
  }

  async readObject(input: { bucket: string; key: string }) {
    const result = await this.execute('get-object', (abortSignal) =>
      this.client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal },
      ),
    );
    if (!result.Body) throw this.invalidResponse('get-object');
    const source =
      result.Body instanceof Readable
        ? result.Body
        : Readable.fromWeb(result.Body.transformToWebStream() as never);
    return this.protectStream(source, 'get-object');
  }

  async deleteObject(input: { bucket: string; key: string }) {
    await this.execute('delete-object', (abortSignal) =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal },
      ),
    );
  }

  async listObjects(input: { bucket: string; prefix: string }) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const result = await this.execute('list-objects', (abortSignal) =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            ContinuationToken: continuationToken,
          }),
          { abortSignal },
        ),
      );
      for (const item of result.Contents ?? []) {
        if (item.Key === undefined) throw this.invalidResponse('list-objects');
        keys.push(item.Key);
      }
      if (!result.IsTruncated) break;
      continuationToken = result.NextContinuationToken;
      if (!continuationToken || seenTokens.has(continuationToken))
        throw this.invalidResponse('list-objects');
      seenTokens.add(continuationToken);
    } while (continuationToken);
    return keys;
  }

  onModuleDestroy() {
    this.client.destroy();
  }

  private async execute<Output>(
    operation: string,
    action: (abortSignal: AbortSignal) => Promise<Output>,
  ): Promise<Output> {
    try {
      return await action(
        AbortSignal.timeout(this.config.documentStorage.requestTimeoutMs),
      );
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw toStorageError(error, operation);
    }
  }

  private protectStream(source: Readable, operation: string) {
    const output = new PassThrough();
    const timer = setTimeout(
      () => output.destroy(new StorageError('timeout', operation)),
      this.config.documentStorage.streamTimeoutMs,
    );
    timer.unref();
    const clear = () => clearTimeout(timer);
    source.once('error', (error) =>
      output.destroy(toStorageError(error, operation)),
    );
    output.once('close', () => {
      clear();
      if (!source.destroyed) source.destroy();
    });
    output.once('end', clear);
    output.once('error', clear);
    source.pipe(output);
    return output;
  }

  private invalidResponse(operation: string) {
    return new StorageError('invalid-response', operation);
  }
}

function normalizeEtag(value: string | undefined) {
  const normalized = value?.trim().replaceAll('"', '');
  return normalized || null;
}

function toStorageError(error: unknown, operation: string) {
  if (error instanceof StorageError) return error;
  const candidate = asErrorRecord(error);
  const errorName = firstString(candidate?.name);
  const providerCode =
    errorName && errorName !== 'Error'
      ? errorName
      : firstString(candidate?.Code, candidate?.code, errorName);
  const metadata = asErrorRecord(candidate?.$metadata);
  const statusCode =
    typeof metadata?.httpStatusCode === 'number'
      ? metadata.httpStatusCode
      : undefined;
  const requestId =
    typeof metadata?.requestId === 'string' ? metadata.requestId : undefined;
  const kind = classifyError(providerCode, statusCode);
  return new StorageError(
    kind,
    operation,
    statusCode,
    providerCode,
    requestId,
    error instanceof Error ? { cause: error } : undefined,
  );
}

function classifyError(
  providerCode: string | undefined,
  statusCode: number | undefined,
): StorageErrorKind {
  if (
    statusCode === 408 ||
    (providerCode &&
      [
        'AbortError',
        'TimeoutError',
        'RequestTimeout',
        'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
      ].includes(providerCode))
  )
    return 'timeout';
  if (
    statusCode === 404 ||
    (providerCode &&
      ['NoSuchKey', 'NoSuchBucket', 'NoSuchUpload', 'NotFound'].includes(
        providerCode,
      ))
  )
    return 'not-found';
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    (providerCode &&
      ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(
        providerCode,
      ))
  )
    return 'authentication';
  if (
    statusCode === 429 ||
    (providerCode &&
      [
        'SlowDown',
        'TooManyRequests',
        'Throttling',
        'ThrottlingException',
        'RequestLimitExceeded',
      ].includes(providerCode))
  )
    return 'rate-limit';
  if (statusCode !== undefined && statusCode >= 500) return 'unavailable';
  if (
    providerCode &&
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'EAI_AGAIN',
      'ENOTFOUND',
      'UND_ERR_SOCKET',
      'NetworkingError',
      'ServiceUnavailable',
      'InternalError',
    ].includes(providerCode)
  )
    return 'unavailable';
  return 'unknown';
}

function asErrorRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string =>
    Boolean(typeof value === 'string' && value),
  );
}
