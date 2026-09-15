import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { RuntimeConfig } from '../config/runtime-config.service';

export interface SearchIndexTarget {
  physicalIndex: string;
  mappingVersion: number;
  mappingHash: string;
}

export interface SearchDocument {
  id: string;
  kbId: string;
  documentId: string;
  processingRunId: string;
  chunkId: string;
  chunkLevel: number;
  embeddingConfigHash: string;
  content: string;
}

/** Elasticsearch 共享 mapping 版本适配器；所有写入均使用稳定 document ID。 */
@Injectable()
export class ElasticsearchService implements OnModuleDestroy {
  private readonly client: Client;

  constructor(private readonly runtime: RuntimeConfig) {
    const auth =
      runtime.elasticsearch.username && runtime.elasticsearch.password
        ? {
            username: runtime.elasticsearch.username,
            password: runtime.elasticsearch.password,
          }
        : undefined;
    this.client = new Client({
      node: runtime.elasticsearch.url || 'http://127.0.0.1:9200',
      auth,
      requestTimeout: runtime.worker.taskTimeoutMs,
      maxRetries: 0,
    });
  }

  async ensure(targetInput: unknown) {
    const target = parseTarget(targetInput);
    const exists = await this.call(() =>
      this.client.indices.exists({ index: target.physicalIndex }),
    );
    if (!exists) {
      await this.call(() =>
        this.client.indices.create({
          index: target.physicalIndex,
          settings: { number_of_shards: 1, number_of_replicas: 0 },
          mappings: {
            _meta: { serverNextMappingHash: target.mappingHash },
            dynamic: 'strict',
            properties: {
              kbId: { type: 'keyword' },
              documentId: { type: 'keyword' },
              processingRunId: { type: 'keyword' },
              chunkId: { type: 'keyword' },
              chunkLevel: { type: 'integer' },
              embeddingConfigHash: { type: 'keyword' },
              content: { type: 'text' },
            },
          },
        }),
      );
      return target;
    }
    const mapping: unknown = await this.call(() =>
      this.client.indices.getMapping({ index: target.physicalIndex }),
    );
    const actualHash = mappingHash(mapping, target.physicalIndex);
    if (actualHash !== target.mappingHash)
      throw new Error('ELASTICSEARCH_MAPPING_CONFLICT');
    return target;
  }

  async bulk(target: SearchIndexTarget, documents: SearchDocument[]) {
    const result = await this.call(() =>
      this.client.bulk({
        operations: documents.flatMap((doc) => [
          { index: { _index: target.physicalIndex, _id: doc.id } },
          doc,
        ]),
      }),
    );
    if (
      result.errors ||
      result.items.some((item) =>
        Object.values(item).some((value) => value?.error),
      )
    )
      throw new Error('ELASTICSEARCH_BULK_FAILED');
  }

  async refresh(target: SearchIndexTarget) {
    await this.call(() =>
      this.client.indices.refresh({ index: target.physicalIndex }),
    );
  }

  async deleteRun(target: SearchIndexTarget, processingRunId: string) {
    await this.call(() =>
      this.client.deleteByQuery({
        index: target.physicalIndex,
        ignore_unavailable: true,
        allow_no_indices: true,
        query: { term: { processingRunId } },
        conflicts: 'proceed',
        refresh: true,
      }),
    );
  }

  async countRun(target: SearchIndexTarget, processingRunId: string) {
    const result = await this.call(() =>
      this.client.count({
        index: target.physicalIndex,
        ignore_unavailable: true,
        allow_no_indices: true,
        query: { term: { processingRunId } },
      }),
    );
    return result.count;
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  /** 将 SDK 网络/协议错误统一为稳定内部错误码，业务校验错误原样向上传播。 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.runtime.elasticsearch.url)
      throw new Error('ELASTICSEARCH_NOT_CONFIGURED');
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error && /^ELASTICSEARCH_/.test(error.message))
        throw error;
      throw new Error('ELASTICSEARCH_UNAVAILABLE');
    }
  }
}

function parseTarget(value: unknown): SearchIndexTarget {
  const target = value as Partial<SearchIndexTarget> | null;
  if (
    !target ||
    typeof target.physicalIndex !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(target.physicalIndex) ||
    !Number.isInteger(target.mappingVersion) ||
    (target.mappingVersion ?? 0) < 1 ||
    typeof target.mappingHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(target.mappingHash)
  )
    throw new Error('ELASTICSEARCH_TARGET_INVALID');
  return target as SearchIndexTarget;
}

function mappingHash(value: unknown, physicalIndex: string): unknown {
  if (!isRecord(value)) return undefined;
  const index = value[physicalIndex];
  if (
    !isRecord(index) ||
    !isRecord(index.mappings) ||
    !isRecord(index.mappings._meta)
  )
    return undefined;
  return index.mappings._meta.serverNextMappingHash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
