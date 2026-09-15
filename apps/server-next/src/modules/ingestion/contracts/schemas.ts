import { z } from 'zod';

/** 持久化 JSON 的当前版本。Reader 明确兼容上一版本，未知版本拒绝继续处理。 */
export const CURRENT_SCHEMA_VERSION = 1;
export const PREVIOUS_SCHEMA_VERSION = 0;
export const SupportedSchemaVersionSchema = z.union([
  z.literal(CURRENT_SCHEMA_VERSION),
  z.literal(PREVIOUS_SCHEMA_VERSION),
]);

export const SourceSpanSchema = z.object({
  nodeId: z.string().min(1),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  pageStart: z.number().int().positive().nullable().optional(),
  pageEnd: z.number().int().positive().nullable().optional(),
  bbox: z.array(z.number().finite()).length(4).nullable().optional(),
  anchor: z.string().nullable().optional(),
  confidence: z
    .enum(['exact', 'aligned', 'derived', 'unknown'])
    .default('unknown'),
  derived: z.boolean().default(false),
});

export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export type AstNodeType =
  | 'document'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listItem'
  | 'blockquote'
  | 'code'
  | 'table'
  | 'image'
  | 'equation'
  | 'thematicBreak'
  | 'text'
  | 'emphasis'
  | 'strong'
  | 'link';

export const AstNodeSchema: z.ZodType<AstNode> = z.lazy(() =>
  z.object({
    schemaVersion: SupportedSchemaVersionSchema,
    id: z.string().min(1),
    type: z.enum([
      'document',
      'heading',
      'paragraph',
      'list',
      'listItem',
      'blockquote',
      'code',
      'table',
      'image',
      'equation',
      'thematicBreak',
      'text',
      'emphasis',
      'strong',
      'link',
    ]),
    value: z.string().optional(),
    language: z.string().optional(),
    url: z.string().optional(),
    titlePath: z.array(z.string()).default([]),
    source: SourceSpanSchema.nullable().optional(),
    children: z.array(AstNodeSchema).default([]),
  }),
);

export interface AstNode {
  schemaVersion: number;
  id: string;
  type: AstNodeType;
  value?: string;
  language?: string;
  url?: string;
  titlePath: string[];
  source?: SourceSpan | null;
  children: AstNode[];
}

export const AstDocumentSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  markdown: z.string().min(1),
  markdownSha256: z.string().regex(/^[a-f0-9]{64}$/),
  root: AstNodeSchema,
  parser: z.string().min(1),
  parserVersion: z.string().min(1),
  degraded: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});
export type AstDocument = z.infer<typeof AstDocumentSchema>;

export const ParserManifestSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  documentId: z.string(),
  processingRunId: z.string(),
  taskId: z.string(),
  executionVersion: z.number().int().positive(),
  parserUsed: z.string(),
  parserVersion: z.string(),
  markdownSha256: z.string().regex(/^[a-f0-9]{64}$/),
  artifacts: z.array(
    z.object({
      bucket: z.string(),
      key: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      format: z.string(),
    }),
  ),
  degraded: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});
export type ParserManifest = z.infer<typeof ParserManifestSchema>;

export const VectorArtifactSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  processingRunId: z.string(),
  taskId: z.string(),
  batchNo: z.number().int().positive(),
  executionVersion: z.number().int().positive(),
  embeddingConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
  dimension: z.number().int().positive(),
  rows: z.array(
    z.object({
      chunkId: z.string(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      vector: z.array(z.number().finite()),
    }),
  ),
  createdAt: z.string().datetime(),
});
export type VectorArtifact = z.infer<typeof VectorArtifactSchema>;

export const RunConfigSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  parser: z.object({ name: z.string(), version: z.string() }),
  astSchemaVersion: z.number().int(),
  tokenizer: z.object({ name: z.string(), version: z.string() }),
});

export const EmbeddingConfigSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  revision: z.string().min(1),
  dimension: z.number().int().positive(),
  inputMode: z.enum(['document', 'query']).default('document'),
  normalization: z
    .object({ normalize: z.boolean().default(true) })
    .default({ normalize: true }),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export const IndexTargetsSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  qdrant: z.object({
    collection: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z0-9_-]+$/),
    vectorName: z.literal('dense'),
    dimension: z.number().int().positive(),
    metric: z.enum(['Cosine', 'Dot', 'Euclid']),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  elasticsearch: z.object({
    physicalIndex: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    mappingVersion: z.number().int().positive(),
    mappingHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export type IndexTargets = z.infer<typeof IndexTargetsSchema>;

export const RetrievalPolicySchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  levels: z.record(
    z.string(),
    z.object({
      embedding: z.boolean(),
      vectorIndex: z.boolean(),
      searchIndex: z.boolean(),
    }),
  ),
});
export type RetrievalPolicy = z.infer<typeof RetrievalPolicySchema>;

export const ChunkMetadataSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  markdownSha256: z.string().regex(/^[a-f0-9]{64}$/),
  titlePath: z.array(z.string()),
  astNodeIds: z.array(z.string()),
  sourceSpans: z.array(SourceSpanSchema),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

export const TaskPayloadSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  taskId: z.string(),
  processingRunId: z.string(),
  attemptNo: z.number().int().positive(),
});
export type TaskPayload = z.infer<typeof TaskPayloadSchema>;

export const CleanupPayloadSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  documentId: z.string(),
  source: z.object({ bucket: z.string(), key: z.string() }),
  deleteSource: z.boolean().default(true),
  runs: z.array(
    z.object({
      runId: z.string(),
      prefix: z.string(),
      indexTargets: IndexTargetsSchema,
    }),
  ),
  reason: z.string(),
  createdAt: z.string().datetime(),
});
export type CleanupPayload = z.infer<typeof CleanupPayloadSchema>;

export const ProcessingSnapshotSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  documentId: z.string(),
  status: z.enum(['processing', 'ready', 'failed', 'deleting', 'deleted']),
  processingStage: z.enum([
    'parsing',
    'chunking',
    'embedding',
    'indexing',
    'ready',
    'failed',
  ]),
  searchable: z.boolean(),
  servingPreviousVersion: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type ProcessingSnapshot = z.infer<typeof ProcessingSnapshotSchema>;

export const ProcessingChangedEventSchema = z.object({
  schemaVersion: SupportedSchemaVersionSchema,
  eventType: z.literal('document_processing_changed'),
  documentId: z.string(),
  updatedAt: z.string().datetime(),
});
export type ProcessingChangedEvent = z.infer<
  typeof ProcessingChangedEventSchema
>;

export function parseVersioned<T>(schema: z.ZodType<T>, value: unknown): T {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== CURRENT_SCHEMA_VERSION && version !== PREVIOUS_SCHEMA_VERSION)
    throw new Error('SCHEMA_VERSION_UNSUPPORTED');
  return schema.parse(
    version === PREVIOUS_SCHEMA_VERSION ? upgradeSchemaVersions(value) : value,
  );
}

function upgradeSchemaVersions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeSchemaVersions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'schemaVersion' && item === PREVIOUS_SCHEMA_VERSION
        ? CURRENT_SCHEMA_VERSION
        : upgradeSchemaVersions(item),
    ]),
  );
}
