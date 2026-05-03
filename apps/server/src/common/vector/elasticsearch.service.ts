import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

export interface ChunkDocument {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface EsSearchHit {
  chunkId: string;
  docId: string;
  kbId: string;
  content: string;
  title?: string;
  score: number;
}

export interface BulkIndexResult {
  indexed: number;
  failed: number;
  errors: string[];
}

@Injectable()
export class ElasticsearchService {
  private readonly client: Client;
  private readonly indexName: string;
  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
  ) {
    const node = this.configService.get<string>('ELASTICSEARCH_NODE');
    if (!node) {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'ELASTICSEARCH_NODE 配置缺失',
        context: { config: 'ELASTICSEARCH_NODE' },
      });
    }

    const username = this.configService.get<string>('ELASTICSEARCH_USERNAME');
    const password = this.configService.get<string>('ELASTICSEARCH_PASSWORD');

    this.client = new Client({
      node,
      auth: username && password ? { username, password } : undefined,
    });

    this.indexName =
      this.configService.get<string>('ELASTICSEARCH_INDEX') ||
      'kb_document_chunks_es';
    this.logger = logger;
  }

  /**
   * 确保索引存在（若不存在则创建）
   */
  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({
      index: this.indexName,
    });

    if (!exists) {
      await this.client.indices.create({
        index: this.indexName,
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              chunk_analyzer: {
                type: 'custom',
                tokenizer: 'ik_max_word',
                filter: ['lowercase'],
              },
            },
          },
        },
        mappings: {
          properties: {
            chunkId: { type: 'keyword' },
            docId: { type: 'keyword' },
            kbId: { type: 'keyword' },
            content: {
              type: 'text',
              analyzer: 'chunk_analyzer',
            },
            title: {
              type: 'text',
              analyzer: 'chunk_analyzer',
            },
            metadata: {
              type: 'object',
              enabled: false,
            },
          },
        },
      });

      this.logger.log(`[Elasticsearch] 索引 ${this.indexName} 创建成功`);
    }
  }

  /**
   * 批量写入文档分块
   */
  async bulkIndexChunks(chunks: ChunkDocument[]): Promise<BulkIndexResult> {
    if (!chunks.length) {
      return { indexed: 0, failed: 0, errors: [] };
    }

    const operations = chunks.flatMap((chunk) => [
      { index: { _index: this.indexName, _id: chunk.chunkId } },
      {
        chunkId: chunk.chunkId,
        docId: chunk.docId,
        kbId: chunk.kbId,
        content: chunk.content,
        title: chunk.title,
        metadata: chunk.metadata,
      },
    ]);

    const result = await this.client.bulk({
      refresh: true,
      operations,
    });

    const errors: string[] = [];
    let failed = 0;

    if (result.errors) {
      for (const item of result.items) {
        if (item.index?.error) {
          failed++;
          errors.push(
            `${item.index._id}: ${item.index.error.reason}`,
          );
        }
      }
    }

    const indexed = chunks.length - failed;

    this.logger.log(
      `[Elasticsearch] bulk index 完成: 成功 ${indexed}, 失败 ${failed}`,
    );

    return { indexed, failed, errors };
  }

  /**
   * 搜索文档
   */
  async search(
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<EsSearchHit[]> {
    const response = await this.client.search({
      index: this.indexName,
      query: {
        bool: {
          should: [
            {
              match: {
                content: {
                  query,
                  boost: 1.0,
                },
              },
            },
            {
              match_phrase: {
                content: {
                  query,
                  boost: 2.0,
                },
              },
            },
          ],
          filter: [{ terms: { kbId: kbIds } }],
        },
      },
      size: topK,
      _source: ['chunkId', 'docId', 'kbId', 'content', 'title'],
    });

    const hits: EsSearchHit[] = [];

    for (const hit of response.hits.hits) {
      const source = hit._source as Record<string, unknown>;
      hits.push({
        chunkId: String(source['chunkId']),
        docId: String(source['docId']),
        kbId: String(source['kbId']),
        content: String(source['content']),
        title: source['title'] ? String(source['title']) : undefined,
        score: hit._score ?? 0,
      });
    }

    return hits;
  }

  /**
   * 删除知识库关联的所有文档
   */
  async deleteByKbId(kbId: string): Promise<void> {
    await this.client.deleteByQuery({
      index: this.indexName,
      query: {
        term: { kbId },
      },
    });

    this.logger.log(`[Elasticsearch] 已删除 kbId=${kbId} 的所有文档`);
  }

  /**
   * 健康检查
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
