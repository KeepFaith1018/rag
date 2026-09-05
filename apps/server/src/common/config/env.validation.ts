import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  DATABASE_URL: Joi.string().uri({ scheme: ['mysql'] }).required(),
  QDRANT_URL: Joi.string().required(),
  QDRANT_SERVICE_API_KEY: Joi.string().optional(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  ENCRYPTION_KEY: Joi.string().min(16).required(),
  TRANSMISSION_SECRET: Joi.string().min(16).required(),
  REDIS_URL: Joi.string().required(),
  REDIS_PASSWORD: Joi.string().required(),
  AI_API_KEY: Joi.string().optional(),
  AI_BASE_URL: Joi.string().uri().optional(),
  AI_EMBEDDING_MODEL: Joi.string().optional(),
  AI_DOCUMENT_EMBEDDING_TYPE: Joi.string()
    .valid('text', 'vision')
    .optional(),
  AI_VISION_EMBEDDING_MODEL: Joi.string().optional(),
  AI_EMBEDDING_DIMENSIONS: Joi.number().integer().positive().optional(),
  AI_EMBED_BATCH_SIZE: Joi.number().integer().min(1).max(100).optional(),
  AI_EMBED_RETRY_COUNT: Joi.number().integer().min(0).max(10).optional(),
  AI_EMBED_REQUEST_INTERVAL_MS: Joi.number().integer().min(0).optional(),
  DOCUMENT_PROCESSING_TIMEOUT_MS: Joi.number().integer().positive().optional(),
  DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS: Joi.number()
    .integer()
    .positive()
    .optional(),
  DOCUMENT_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(10).optional(),

  AI_LLM_MODEL: Joi.string().optional(),
  AI_LLM_LIGHT_MODEL: Joi.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_NODE: Joi.string().uri().optional(),
  ELASTICSEARCH_INDEX: Joi.string().optional(),
  ELASTICSEARCH_USERNAME: Joi.string().optional().allow(''),
  ELASTICSEARCH_PASSWORD: Joi.string().optional().allow(''),

  // Rerank Model
  AI_RERANK_MODEL: Joi.string().optional(),
  AI_RERANK_TOP_N: Joi.number().integer().positive().optional(),

  // CORS
  CORS_ORIGINS: Joi.string().default('http://localhost:5173,http://localhost:5174'),

  // Email
  EMAIL_HOST: Joi.string().required(),
  EMAIL_PORT: Joi.number().required(),
  EMAIL_USER: Joi.string().required(),
  EMAIL_PASS: Joi.string().required(),
  EMAIL_FROM: Joi.string().email().required(),
});
