import { Injectable } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'node:crypto';
import { RuntimeConfig } from '../config/runtime-config.service';

export interface QdrantTarget {
  collection: string;
  vectorName: 'dense';
  dimension: number;
  metric: 'Cosine' | 'Dot' | 'Euclid';
  schemaHash: string;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, string | number>;
}

/** Qdrant 的最小业务适配器；collection 是 embedding_config_hash 的隔离边界。 */
@Injectable()
export class QdrantService {
  private readonly client: QdrantClient;

  constructor(private readonly runtime: RuntimeConfig) {
    this.client = new QdrantClient({
      url: runtime.qdrant.url || 'http://127.0.0.1:6333',
      apiKey: runtime.qdrant.apiKey,
      checkCompatibility: false,
      timeout: runtime.worker.taskTimeoutMs,
    });
  }

  async ensure(targetInput: unknown) {
    const target = parseTarget(targetInput);
    const expectedHash = hashJson({
      vectorName: target.vectorName,
      dimension: target.dimension,
      metric: target.metric,
      payloadIndexes: PAYLOAD_INDEXES,
    });
    if (target.schemaHash !== expectedHash)
      throw new Error('QDRANT_SCHEMA_HASH_CONFLICT');
    const exists = await this.call(() =>
      this.client.collectionExists(target.collection),
    );
    if (!exists.exists) {
      await this.call(() =>
        this.client.createCollection(target.collection, {
          vectors: {
            [target.vectorName]: {
              size: target.dimension,
              distance: target.metric,
            },
          },
        }),
      );
      for (const field of PAYLOAD_INDEXES) {
        await this.call(() =>
          this.client.createPayloadIndex(target.collection, {
            field_name: field,
            field_schema: field === 'chunkLevel' ? 'integer' : 'keyword',
          }),
        );
      }
      return target;
    }
    const info = await this.call(() =>
      this.client.getCollection(target.collection),
    );
    const vectors = info.config.params.vectors as
      | Record<string, { size?: number; distance?: string } | undefined>
      | undefined;
    const vector = vectors?.[target.vectorName];
    if (
      !vector ||
      vector.size !== target.dimension ||
      vector.distance !== target.metric
    )
      throw new Error('QDRANT_SCHEMA_CONFLICT');
    for (const field of PAYLOAD_INDEXES) {
      const expectedType = field === 'chunkLevel' ? 'integer' : 'keyword';
      if (info.payload_schema[field]?.data_type !== expectedType)
        throw new Error('QDRANT_PAYLOAD_INDEX_CONFLICT');
    }
    return target;
  }

  async upsert(target: QdrantTarget, points: VectorPoint[]) {
    await this.call(() =>
      this.client.upsert(target.collection, {
        wait: true,
        points: points.map((point) => ({
          id: point.id,
          vector: { [target.vectorName]: point.vector },
          payload: point.payload,
        })),
      }),
    );
  }

  async deleteRun(target: QdrantTarget, processingRunId: string) {
    // 解析阶段失败的 run 可能从未创建 collection，缺失目标视为已清理。
    const exists = await this.call(() =>
      this.client.collectionExists(target.collection),
    );
    if (!exists.exists) return;
    await this.call(() =>
      this.client.delete(target.collection, {
        wait: true,
        filter: {
          must: [{ key: 'processingRunId', match: { value: processingRunId } }],
        },
      }),
    );
  }

  async countRun(target: QdrantTarget, processingRunId: string) {
    const exists = await this.call(() =>
      this.client.collectionExists(target.collection),
    );
    if (!exists.exists) return 0;
    const result = await this.call(() =>
      this.client.count(target.collection, {
        filter: {
          must: [{ key: 'processingRunId', match: { value: processingRunId } }],
        },
        exact: true,
      }),
    );
    return result.count;
  }

  /** 将 SDK 网络/协议错误统一为稳定内部错误码，业务校验错误原样向上传播。 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.runtime.qdrant.url) throw new Error('QDRANT_NOT_CONFIGURED');
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error && /^QDRANT_/.test(error.message)) throw error;
      throw new Error('QDRANT_UNAVAILABLE');
    }
  }
}

function parseTarget(value: unknown): QdrantTarget {
  const target = value as Partial<QdrantTarget> | null;
  if (
    !target ||
    typeof target.collection !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(target.collection) ||
    target.vectorName !== 'dense' ||
    !Number.isInteger(target.dimension) ||
    (target.dimension ?? 0) < 1 ||
    !['Cosine', 'Dot', 'Euclid'].includes(target.metric ?? '') ||
    typeof target.schemaHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(target.schemaHash)
  )
    throw new Error('QDRANT_TARGET_INVALID');
  return target as QdrantTarget;
}

const PAYLOAD_INDEXES = [
  'kbId',
  'documentId',
  'processingRunId',
  'chunkId',
  'chunkLevel',
  'embeddingConfigHash',
];

function hashJson(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
