import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
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
      sniffOnStart: false,
      sniffOnConnectionFault: false,
    } as any);

    this.indexName =
      this.configService.get<string>('ELASTICSEARCH_INDEX') ||
      'kb_document_chunks_es';
    this.logger = logger;
  }

  /**
   * 确保索引存在且 mapping 版本兼容（E1: search_analyzer 分离, E2: 同义词词典）。
   *
   * 若已有索引缺 search_analyzer 则删除并重建，保证索引阶段 ik_max_word +
   * 搜索阶段 ik_smart 正确分离。
   */
  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({
      index: this.indexName,
    });

    if (exists) {
      const currentMapping = await this.client.indices.getMapping({
        index: this.indexName,
      });
      const properties =
        (currentMapping[this.indexName]?.mappings?.properties as Record<string, Record<string, unknown>>) ?? {};
      const contentProp = properties['content'];
      if (contentProp && !contentProp['search_analyzer']) {
        this.logger.warn(
          `[Elasticsearch] 索引 ${this.indexName} 缺少 search_analyzer，重建中...`,
        );
        await this.client.indices.delete({ index: this.indexName });
        await this.createIndex();
        return;
      }
      return;
    }

    await this.createIndex();
  }

  /**
   * 创建索引，包含完整的 settings/mappings（E1+E2 组合配置）。
   */
  private async createIndex(): Promise<void> {
    await this.client.indices.create({
      index: this.indexName,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          filter: {
            rag_synonym: {
              type: 'synonym',
              synonyms: [
                'RAG, 检索增强生成',
                'LLM, 大模型, 大语言模型',
                'Embedding, 向量化, 向量嵌入',
                '向量检索, 语义检索, 稠密检索',
                '混合检索, 混合搜索, 多路召回',
                'Rerank, 重排序, 精排',
                '知识库, 知识底座, 知识管理',
                '切块, 分块, 分片',
              ],
            },
          },
          analyzer: {
            chunk_analyzer: {
              type: 'custom',
              tokenizer: 'ik_max_word',
              filter: ['lowercase', 'rag_synonym'],
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
            search_analyzer: 'ik_smart',
          },
          title: {
            type: 'text',
            analyzer: 'chunk_analyzer',
            search_analyzer: 'ik_smart',
          },
          metadata: {
            type: 'object',
            enabled: false,
          },
        },
      },
    });

    this.logger.info(`[Elasticsearch] 索引 ${this.indexName} 创建成功`);
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

    this.logger.info(
      `[Elasticsearch] bulk index 完成: 成功 ${indexed}, 失败 ${failed}`,
    );

    return { indexed, failed, errors };
  }

  /**
   * 搜索文档（E6: 二阶段 Rescore）。
   *
   * 第一阶段宽召回 topK*3 候选，第二阶段用 AND 严格匹配前 topK 条重排序，
   * title 字段天然加权 ^2，确保标题命中优先于正文命中。
   */
  async search(
    query: string,
    kbIds: string[],
    topK: number,
  ): Promise<EsSearchHit[]> {
    const recallWindow = topK * 3;

    const response = await this.client.search({
      index: this.indexName,
      query: {
        bool: {
          should: [
            {
              multi_match: {
                query,
                fields: ['title^2', 'content^1'],
                type: 'best_fields',
              },
            },
            {
              match_phrase: {
                content: { query, boost: 2.0 },
              },
            },
          ],
          minimum_should_match: 1,
          filter: [{ terms: { kbId: kbIds } }],
        },
      },
      size: recallWindow,
      rescore: {
        window_size: topK,
        query: {
          query_weight: 0.2,
          rescore_query_weight: 1.0,
          rescore_query: {
            match: {
              content: { query, operator: 'AND' },
            },
          },
        },
      },
      _source: ['chunkId', 'docId', 'kbId', 'content', 'title'],
    });

    const hits: EsSearchHit[] = [];

    for (const hit of response.hits.hits.slice(0, topK)) {
      const source = hit._source as Record<string, unknown>;
      hits.push({
        chunkId: String(source['chunkId']),
        docId: String(source['docId']),
        kbId: String(source['kbId']),
        content: String(source['content']),
        title: typeof source['title'] === 'string' ? source['title'] : undefined,
        score: hit._score ?? 0,
      });
    }

    return hits;
  }

  /**
   * 删除知识库关联的所有文档
   */
  async deleteByKbId(kbId: string): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) return;

    await this.client.deleteByQuery({
      index: this.indexName,
      query: {
        term: { kbId },
      },
    });

    this.logger.info(`[Elasticsearch] 已删除 kbId=${kbId} 的所有文档`);
  }

  /**
   * 删除指定文档的全部索引文档（所有版本）。
   */
  async deleteByDocument(docId: string): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) return;

    await this.client.deleteByQuery({
      index: this.indexName,
      refresh: true,
      query: {
        term: { docId },
      },
    });

    this.logger.info(
      `[Elasticsearch] 已删除 docId=${docId} 的全部索引文档`,
    );
  }

  /**
   * 删除指定文档版本的索引文档（用于 reparse 时清理旧版本 ES 数据）。
   */
  async deleteByDocumentVersion(
    docId: string,
    processingVersion: number,
  ): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) return;

    await this.client.deleteByQuery({
      index: this.indexName,
      query: {
        bool: {
          must: [
            { term: { docId } },
            { term: { 'metadata.processingVersion': processingVersion } },
          ],
        },
      },
    });

    this.logger.info(
      `[Elasticsearch] 已删除 docId=${docId} v${processingVersion} 的文档`,
    );
  }

  /**
   * 遍历索引中所有文档的 docId，通过回调找出孤立文档 ID。
   *
   * 回调接收去重后的 docId 列表，返回其中已不存在的 docId。
   */
  async findOrphanDocIds(
    resolveOrphans: (docIds: string[]) => Promise<string[]>,
  ): Promise<string[]> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) return [];

    const docIds = new Set<string>();
    const batchSize = 1000;

    let searchResponse = await this.client.search({
      index: this.indexName,
      scroll: '2m',
      size: batchSize,
      _source: ['docId'],
      query: { match_all: {} },
    });

    while (true) {
      for (const hit of searchResponse.hits.hits) {
        const source = hit._source as Record<string, unknown> | undefined;
        const docId = source?.['docId'];
        if (typeof docId === 'string') {
          docIds.add(docId);
        }
      }

      if (searchResponse.hits.hits.length < batchSize) {
        break;
      }

      searchResponse = await this.client.scroll({
        scroll_id: searchResponse._scroll_id!,
        scroll: '2m',
      });
    }

    return resolveOrphans([...docIds]);
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
