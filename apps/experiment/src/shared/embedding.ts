/**
 * Embedding 向量化。
 * 从 EmbeddingService 简化。
 */
import { OpenAIEmbeddings } from '@langchain/openai';
import { env } from './env.js';

let _client: OpenAIEmbeddings | null = null;

function getClient(): OpenAIEmbeddings {
  if (!_client) {
    _client = new OpenAIEmbeddings({
      model: env('BAILIAN_EMBEDDING_MODEL', 'text-embedding-v4'),
      apiKey: env('BAILIAN_API_KEY'),
      dimensions: parseInt(env('BAILIAN_EMBEDDING_DIMENSIONS', '1024')),
      batchSize: parseInt(env('BAILIAN_EMBED_BATCH_SIZE', '10')),
      maxRetries: 0,
      configuration: {
        baseURL: env('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      },
    });
  }
  return _client;
}

/** 批量向量化 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const client = getClient();
  const allVectors: number[][] = [];
  // 分批调用
  const batchSize = parseInt(env('BAILIAN_EMBED_BATCH_SIZE', '10'));
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await client.embedDocuments(batch);
    allVectors.push(...vectors);
    if (i + batchSize < texts.length) {
      const interval = parseInt(env('BAILIAN_EMBED_REQUEST_INTERVAL_MS', '1000'));
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  return allVectors;
}

/** 单条向量化 */
export async function embedQuery(text: string): Promise<number[]> {
  const client = getClient();
  const results = await client.embedDocuments([text]);
  return results[0];
}
