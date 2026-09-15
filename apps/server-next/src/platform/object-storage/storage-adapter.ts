import type { Readable } from 'node:stream';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface StoragePart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface StorageObject {
  size: number;
  etag: string | null;
  contentType: string | null;
}

export type StorageErrorKind =
  | 'not-found'
  | 'authentication'
  | 'rate-limit'
  | 'timeout'
  | 'unavailable'
  | 'invalid-response'
  | 'unknown';

/** 对象存储协议错误的稳定分类，避免业务层依赖具体 S3 Provider 的异常结构。 */
export class StorageError extends BusinessError {
  constructor(
    readonly storageKind: StorageErrorKind,
    readonly operation: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
    readonly requestId?: string,
    options?: ErrorOptions,
  ) {
    super(
      ErrorCode.SERVICE_UNAVAILABLE,
      '对象存储暂时不可用，请稍后重试',
      'unavailable',
      options,
    );
    this.name = 'StorageError';
  }
}

/** 文件业务只依赖这些能力，业务层不感知 MinIO/S3 的具体 SDK。 */
export interface StorageAdapter {
  putObject(input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ etag: string | null }>;
  createMultipart(input: {
    bucket: string;
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }>;
  signPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<string>;
  listParts(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<StoragePart[]>;
  completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<{ etag: string }>;
  abortMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<void>;
  headObject(input: { bucket: string; key: string }): Promise<StorageObject>;
  readObject(input: { bucket: string; key: string }): Promise<Readable>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  listObjects(input: { bucket: string; prefix: string }): Promise<string[]>;
}
