import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { DOCUMENT_VECTOR_INDEX_ERROR_CODE } from '../../modules/document-processing/constants/document-processing.constants';
import { QDRANT_DOCUMENT_COLLECTION_NAME } from './qdrant.constants';

export interface QdrantChunkPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * 负责统一封装 Qdrant collection 初始化、写入与删除逻辑。
 */
@Injectable()
export class QdrantService {
  private readonly client: QdrantClient;

  constructor(private readonly configService: ConfigService) {
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
        return;
      }

      await this.client.createCollection(QDRANT_DOCUMENT_COLLECTION_NAME, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });
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
   * 检查目标 collection 是否已存在。
   */
  private async collectionExists() {
    const collections = await this.client.getCollections();
    return collections.collections.some(
      (item) => item.name === QDRANT_DOCUMENT_COLLECTION_NAME,
    );
  }
}
