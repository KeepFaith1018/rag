import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  DATABASE_URL: Joi.string().required(),
  QDRANT_URL: Joi.string().required(),
  QDRANT_SERVICE_API_KEY: Joi.string().optional(),

  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  REDIS_URL: Joi.string().required(),
  REDIS_PASSWORD: Joi.string().required(),
  BAILIAN_API_KEY: Joi.string().optional(),
  BAILIAN_BASE_URL: Joi.string().uri().optional(),
  BAILIAN_EMBEDDING_MODEL: Joi.string().optional(),
  BAILIAN_DOCUMENT_EMBEDDING_TYPE: Joi.string()
    .valid('text', 'vision')
    .optional(),
  BAILIAN_VISION_EMBEDDING_MODEL: Joi.string().optional(),
  BAILIAN_EMBEDDING_DIMENSIONS: Joi.number().integer().positive().optional(),
  BAILIAN_EMBED_BATCH_SIZE: Joi.number().integer().min(1).max(100).optional(),
  BAILIAN_EMBED_RETRY_COUNT: Joi.number().integer().min(0).max(10).optional(),
  BAILIAN_EMBED_REQUEST_INTERVAL_MS: Joi.number().integer().min(0).optional(),
  DOCUMENT_PROCESSING_TIMEOUT_MS: Joi.number().integer().positive().optional(),
  DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS: Joi.number()
    .integer()
    .positive()
    .optional(),
  DOCUMENT_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(10).optional(),

  BAILIAN_LLM_MODEL: Joi.string().optional(),
  BAILIAN_LLM_LIGHT_MODEL: Joi.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_NODE: Joi.string().uri().optional(),
  ELASTICSEARCH_INDEX: Joi.string().optional(),
  ELASTICSEARCH_USERNAME: Joi.string().optional().allow(''),
  ELASTICSEARCH_PASSWORD: Joi.string().optional().allow(''),

  // Bailian Rerank Model
  BAILIAN_RERANK_MODEL: Joi.string().optional(),
  BAILIAN_RERANK_TOP_N: Joi.number().integer().positive().optional(),

  // Tavily Web Search
  TAVILY_API_KEY: Joi.string().optional(),
});
