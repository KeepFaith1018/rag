import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { DOCUMENT_VECTOR_INDEX_ERROR_CODE } from '../../modules/document/document-processing.constants';
import {
  QDRANT_DOCUMENT_COLLECTION_NAME,
  QDRANT_HNSW_M,
  QDRANT_HNSW_EF_CONSTRUCT,
  QDRANT_EF_SEARCH,
} from './qdrant.constants';

export interface QdrantChunkPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/** 向量检索返回的候选分片 */
export interface DenseHit {
  /** Qdrant point id */
  pointId: string;
  /** 知识库 ID */
  kbId: string;
  /** 文档 ID */
  docId: string;
  /** 分片 ID */
  chunkId: string;
  /** 分片文本内容 */
  content: string;
  /** 相似度分数 */
  score: number;
  /** 载荷中的附加信息 */
  payload: Record<string, unknown>;
}

export interface SearchChunkVectorsParams {
  vector: number[];
  kbIds: string[];
  topK: number;
  scoreThreshold?: number;
}

/**
 * 负责统一封装 Qdrant collection 初始化、写入与删除逻辑。
 */
@Injectable()
export class QdrantService {
  private readonly client: QdrantClient;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    const url = this.configService.get<string>('QDRANT_URL');
    if (!url) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Qdrant 配置缺失，无法初始化向量服务',
      );
    }

    this.client = new QdrantClient({
      url,
      apiKey: this.configService.get<string>('QDRANT_SERVICE_API_KEY'),
    });
  }

  /**
   * 确保统一文档分片 collection 已存在。
   */
  async ensureCollection(vectorSize: number) {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (item) => item.name === QDRANT_DOCUMENT_COLLECTION_NAME,
      );

      if (exists) {
        const info = await this.client.getCollection(
          QDRANT_DOCUMENT_COLLECTION_NAME,
        );
        const config = (info.config as Record<string, unknown> | undefined) ?? {};
        if (!config['quantization_config']) {
          this.logger.warn(
            `[Qdrant] collection ${QDRANT_DOCUMENT_COLLECTION_NAME} 未配置量化，建议运行迁移脚本`,
          );
        }
        // E13: 确保 payload 索引存在
        await this.ensurePayloadIndexes();
        return;
      }

      await this.client.createCollection(QDRANT_DOCUMENT_COLLECTION_NAME, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
        hnsw_config: {
          m: QDRANT_HNSW_M,
          ef_construct: QDRANT_HNSW_EF_CONSTRUCT,
        },
        quantization_config: {
          scalar: { type: 'int8', quantile: 0.99, always_ram: true },
        },
      });

      // E13: 为新 collection 创建 payload 索引
      await this.ensurePayloadIndexes();
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_INDEX_FAILED, {
        message: 'Qdrant collection 初始化失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_VECTOR_INDEX_ERROR_CODE,
          collectionName: QDRANT_DOCUMENT_COLLECTION_NAME,
        },
      });
    }
  }

  /**
   * 批量写入文档分片向量。
   */
  async upsertChunkVectors(points: QdrantChunkPoint[]) {
    if (points.length === 0) {
      return;
    }

    try {
      await this.ensureCollection(points[0].vector.length);
      await this.client.upsert(QDRANT_DOCUMENT_COLLECTION_NAME, {
        wait: true,
        points,
      });
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new BusinessException(ErrorCode.VECTOR_INDEX_FAILED, {
        message: 'Qdrant 向量写入失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_VECTOR_INDEX_ERROR_CODE,
          collectionName: QDRANT_DOCUMENT_COLLECTION_NAME,
          pointCount: points.length,
        },
      });
    }
  }

  /**
   * 删除指定文档的全部向量。
   */
  async deleteByDocument(documentId: string) {
    try {
      if (!(await this.collectionExists())) {
        return;
      }

      await this.client.delete(QDRANT_DOCUMENT_COLLECTION_NAME, {
        wait: true,
        filter: {
          must: [
            {
              key: 'docId',
              match: {
                value: documentId,
              },
            },
          ],
        },
      });
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_INDEX_FAILED, {
        message: 'Qdrant 删除文档向量失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_VECTOR_INDEX_ERROR_CODE,
          documentId,
        },
      });
    }
  }

  /**
   * 删除指定文档某个版本的向量。
   */
  async deleteByDocumentVersion(documentId: string, processingVersion: number) {
    try {
      if (!(await this.collectionExists())) {
        return;
      }

      await this.client.delete(QDRANT_DOCUMENT_COLLECTION_NAME, {
        wait: true,
        filter: {
          must: [
            {
              key: 'docId',
              match: {
                value: documentId,
              },
            },
            {
              key: 'processingVersion',
              match: {
                value: processingVersion,
              },
            },
          ],
        },
      });
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_INDEX_FAILED, {
        message: 'Qdrant 删除旧版本向量失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_VECTOR_INDEX_ERROR_CODE,
          documentId,
          processingVersion,
        },
      });
    }
  }

  /**
   * 删除指定知识库的全部向量。
   */
  async deleteByKbId(kbId: string) {
    try {
      if (!(await this.collectionExists())) {
        return;
      }

      await this.client.delete(QDRANT_DOCUMENT_COLLECTION_NAME, {
        wait: true,
        filter: {
          must: [
            {
              key: 'kbId',
              match: {
                value: kbId,
              },
            },
          ],
        },
      });

      this.logger.info(
        `[Qdrant] 已删除 kbId=${kbId} 的全部向量`,
      );
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_INDEX_FAILED, {
        message: 'Qdrant 删除知识库向量失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_VECTOR_INDEX_ERROR_CODE,
          kbId,
        },
      });
    }
  }

  /**
   * 向量相似度检索，支持多知识库过滤与分数阈值。
   */
  async searchChunkVectors(params: SearchChunkVectorsParams): Promise<DenseHit[]> {
    try {
      const kbFilters = params.kbIds.map((kbId) => ({
        key: 'kbId',
        match: { value: kbId },
      }));

      const filter = kbFilters.length > 0
        ? { should: kbFilters }
        : undefined;

      const results = await this.client.search(
        QDRANT_DOCUMENT_COLLECTION_NAME,
        {
          vector: params.vector,
          limit: params.topK,
          score_threshold: params.scoreThreshold,
          filter,
          params: { ef: QDRANT_EF_SEARCH },
          with_payload: true,
        },
      );

      return results.map((r) => {
        const payload = (r.payload ?? {});
        return {
          pointId: String(r.id),
          kbId: String((payload['kbId'] as string) ?? ''),
          docId: String((payload['docId'] as string) ?? ''),
          chunkId: String((payload['chunkId'] as string) ?? ''),
          content: String((payload['content'] as string) ?? ''),
          score: r.score,
          payload,
        };
      });
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new BusinessException(ErrorCode.VECTOR_SEARCH_FAILED, {
        message: 'Qdrant 向量检索失败',
        cause: error,
        context: {
          kbIds: params.kbIds,
          topK: params.topK,
        },
      });
    }
  }

  /**
   * 遍历 collection 中所有 point 的 docId，通过回调找出孤立文档 ID。
   *
   * 回调接收去重后的 docId 列表，返回其中已不存在的 docId。
   */
  async findOrphanDocIds(
    resolveOrphans: (docIds: string[]) => Promise<string[]>,
  ): Promise<string[]> {
    if (!(await this.collectionExists())) {
      return [];
    }

    const docIds = new Set<string>();
    let offset: string | number | null = null;
    const batchSize = 1000;

    do {
      const response = await this.client.scroll(
        QDRANT_DOCUMENT_COLLECTION_NAME,
        {
          limit: batchSize,
          offset,
          with_payload: ['docId'],
        },
      );

      for (const point of response.points) {
        const docId = (point.payload as Record<string, unknown> | null)?.['docId'];
        if (typeof docId === 'string') {
          docIds.add(docId);
        }
      }

      offset = (response.next_page_offset as string | number | null) ?? null;
    } while (offset !== null);

    return resolveOrphans([...docIds]);
  }

  /**
   * E13: 为常用过滤字段创建 payload 索引，避免大规模数据下全扫描。
   *
   * 幂等操作 — 重复创建已存在索引不会报错。
   */
  private async ensurePayloadIndexes() {
    const fields = ['kbId', 'docId', 'chunkLevel'] as const;
    for (const field of fields) {
      try {
        await this.client.createPayloadIndex(
          QDRANT_DOCUMENT_COLLECTION_NAME,
          { field_name: field, field_schema: 'keyword' },
        );
      } catch {
        // 索引已存在或创建失败均不阻塞
      }
    }
  }

  /**
   * 检查目标 collection 是否已存在。
   */
  private async collectionExists() {
    const collections = await this.client.getCollections();
    return collections.collections.some(
      (item) => item.name === QDRANT_DOCUMENT_COLLECTION_NAME,
    );
  }
}
