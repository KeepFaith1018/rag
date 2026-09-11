import type { Readable } from 'node:stream';

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
  hashObject(input: { bucket: string; key: string }): Promise<string>;
}
