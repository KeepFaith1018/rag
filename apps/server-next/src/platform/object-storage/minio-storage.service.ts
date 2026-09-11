import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { RuntimeConfig } from '../config/runtime-config.service';
import type {
  StorageAdapter,
  StorageObject,
  StoragePart,
} from './storage-adapter';

type RequestOptions = {
  method: string;
  bucket: string;
  key: string;
  query?: Record<string, string>;
  body?: string | Buffer;
  contentType?: string;
};

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(key: string) {
  return `/${key.split('/').map(encode).join('/')}`;
}

function canonicalQuery(query: Record<string, string> = {}) {
  return Object.entries(query)
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB
        ? compareEncoded(valueA, valueB)
        : compareEncoded(keyA, keyB),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** AWS SigV4 按 URI 编码后的 ASCII 字节序排序查询参数。 */
function compareEncoded(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

/** 不依赖 SDK 的 AWS Signature V4 客户端，兼容 MinIO 的 S3 API。 */
@Injectable()
export class MinioStorageService implements StorageAdapter {
  constructor(private readonly config: RuntimeConfig) {}

  async putObject(input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) {
    const response = await this.request({
      method: 'PUT',
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      contentType: input.contentType,
    });
    return { etag: response.headers.get('etag')?.replaceAll('"', '') ?? null };
  }

  async createMultipart(input: {
    bucket: string;
    key: string;
    contentType: string;
  }) {
    const response = await this.request({
      method: 'POST',
      ...input,
      query: { uploads: '' },
      contentType: input.contentType,
    });
    const body = await response.text();
    const uploadId = this.xmlValue(body, 'UploadId');
    if (!uploadId)
      throw new Error('storage did not return multipart upload id');
    return { uploadId };
  }

  signPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }) {
    const { endpoint, accessKey, secretKey, region } =
      this.config.documentStorage;
    if (!accessKey || !secretKey)
      throw new Error('object storage credentials are not configured');
    const url = new URL(endpoint);
    const now = new Date();
    const amzDate = this.amzDate(now);
    const date = amzDate.slice(0, 8);
    const credentialScope = `${date}/${region}/s3/aws4_request`;
    const query = {
      partNumber: String(input.partNumber),
      uploadId: input.uploadId,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(input.expiresInSeconds),
      'X-Amz-SignedHeaders': 'host',
    };
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    const path = `${url.pathname.replace(/\/$/, '')}/${input.bucket}${canonicalPath(input.key)}`;
    const canonicalRequest = [
      'PUT',
      path,
      canonicalQuery(query),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const signature = this.signature(
      secretKey,
      date,
      region,
      amzDate,
      canonicalRequest,
    );
    return Promise.resolve(
      `${url.origin}${path}?${canonicalQuery({ ...query, 'X-Amz-Signature': signature })}`,
    );
  }

  async listParts(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<StoragePart[]> {
    const response = await this.request({
      method: 'GET',
      ...input,
      query: { uploadId: input.uploadId },
    });
    const body = await response.text();
    const parts: StoragePart[] = [];
    for (const match of body.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const value = match[1];
      const partNumber = Number(this.xmlValue(value, 'PartNumber'));
      const etag = this.xmlValue(value, 'ETag')?.replaceAll('"', '') ?? '';
      const size = Number(this.xmlValue(value, 'Size'));
      if (partNumber > 0 && etag && Number.isInteger(size))
        parts.push({ partNumber, etag, size });
    }
    return parts;
  }

  async completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    const body = [
      '<CompleteMultipartUpload>',
      ...input.parts.map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>"${part.etag.replaceAll('"', '')}"</ETag></Part>`,
      ),
      '</CompleteMultipartUpload>',
    ].join('');
    const response = await this.request({
      method: 'POST',
      ...input,
      query: { uploadId: input.uploadId },
      body,
      contentType: 'application/xml',
    });
    const result = await response.text();
    return { etag: this.xmlValue(result, 'ETag')?.replaceAll('"', '') ?? '' };
  }

  async abortMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }) {
    await this.request({
      method: 'DELETE',
      ...input,
      query: { uploadId: input.uploadId },
    });
  }

  async headObject(input: {
    bucket: string;
    key: string;
  }): Promise<StorageObject> {
    const response = await this.request({ method: 'HEAD', ...input });
    return {
      size: Number(response.headers.get('content-length') ?? 0),
      etag: response.headers.get('etag')?.replaceAll('"', '') ?? null,
      contentType: response.headers.get('content-type'),
    };
  }

  async readObject(input: { bucket: string; key: string }) {
    const response = await this.request({ method: 'GET', ...input });
    if (!response.body) throw new Error('storage response has no body');
    return Readable.fromWeb(response.body as never);
  }

  async deleteObject(input: { bucket: string; key: string }) {
    await this.request({ method: 'DELETE', ...input });
  }

  async hashObject(input: { bucket: string; key: string }) {
    const stream = await this.readObject(input);
    const digest = createHash('sha256');
    for await (const chunk of stream) digest.update(chunk as Buffer);
    return digest.digest('hex');
  }

  private async request(options: RequestOptions) {
    const { endpoint } = this.config.documentStorage;
    const url = new URL(endpoint);
    const { accessKey, secretKey, region } = this.config.documentStorage;
    if (!accessKey || !secretKey)
      throw new Error('object storage credentials are not configured');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const date = amzDate.slice(0, 8);
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    const path = `${url.pathname.replace(/\/$/, '')}/${options.bucket}${canonicalPath(options.key)}`;
    const payload = options.body ?? '';
    const payloadHash = sha256(payload);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (options.contentType) headers['content-type'] = options.contentType;
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((key) => `${key}:${headers[key].trim()}\n`)
      .join('');
    const query = options.query ?? {};
    const canonicalRequest = [
      options.method,
      path,
      canonicalQuery(query),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${date}/${region}/s3/aws4_request`;
    const signature = this.signature(
      secretKey,
      date,
      region,
      amzDate,
      canonicalRequest,
    );
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(
      `${url.origin}${path}${canonicalQuery(query) ? `?${canonicalQuery(query)}` : ''}`,
      {
        method: options.method,
        headers,
        // Node fetch 运行时支持 Buffer；这里仅补充其 BodyInit 类型声明。
        body: options.body as unknown as BodyInit,
      },
    );
    if (!response.ok)
      throw new Error(`object storage request failed: ${response.status}`);
    return response;
  }

  private signature(
    secret: string,
    date: string,
    region: string,
    timestamp: string,
    request: string,
  ) {
    const kDate = hmac(`AWS4${secret}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${date}/${region}/s3/aws4_request\n${sha256(request)}`;
    return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private xmlValue(body: string, tag: string) {
    const value = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
    return value === undefined ? null : decodeXmlEntities(value);
  }
}

/** MinIO 可能以 XML numeric entity 返回包含双引号的 ETag。 */
function decodeXmlEntities(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#x22;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
