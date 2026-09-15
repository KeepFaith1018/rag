import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  QUEUE_NAME,
  dispatchEventKey,
  taskKey,
} from '../contracts/identifiers';
import {
  CURRENT_SCHEMA_VERSION,
  IndexTargetsSchema,
  RetrievalPolicySchema,
  TaskPayloadSchema,
} from '../contracts/schemas';
import { ModelAccessService } from '../../model-access/model-access.service';

const ES_MAPPING_VERSION = 1;
const ES_MAPPING = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
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
};

export const DEFAULT_PARSER_CONFIG = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  parser: { name: 'unified-markdown-adapter', version: '1' },
  astSchemaVersion: CURRENT_SCHEMA_VERSION,
  tokenizer: { name: 'cl100k_base', version: 'tiktoken-1.0.22' },
};

export const DEFAULT_CHUNKING_CONFIG = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  tokenizer: { name: 'cl100k_base', version: 'tiktoken-1.0.22' },
  rootTokenLimit: 4096,
  parentTokenLimit: 2048,
  childTokenLimit: 512,
  overlapTokens: 48,
  titlePrefix: '> 章节路径：',
};

export const DEFAULT_RETRIEVAL_POLICY = RetrievalPolicySchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  levels: {
    '1': { embedding: false, vectorIndex: false, searchIndex: false },
    '2': { embedding: false, vectorIndex: false, searchIndex: false },
    '3': { embedding: true, vectorIndex: true, searchIndex: true },
  },
});

@Injectable()
export class ProcessingCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelAccessService,
  ) {}

  /** 在上传 Complete 的同一事务中创建 document 的首个不可变 run。 */
  async createInitialRun(
    tx: Prisma.TransactionClient,
    input: { documentId: bigint; sourceSha256: string },
  ) {
    const embedding = await this.models.defaultEmbedding();
    const qdrant = {
      collection: `server_next_chunks_${embedding.hash}`,
      vectorName: 'dense' as const,
      dimension: embedding.config.dimension,
      metric: 'Cosine' as const,
      schemaHash: hashJson({
        vectorName: 'dense',
        dimension: embedding.config.dimension,
        metric: 'Cosine',
        payloadIndexes: [
          'kbId',
          'documentId',
          'processingRunId',
          'chunkId',
          'chunkLevel',
          'embeddingConfigHash',
        ],
      }),
    };
    const elasticsearch = {
      physicalIndex: `server-next-chunks-v${ES_MAPPING_VERSION}`,
      mappingVersion: ES_MAPPING_VERSION,
      mappingHash: hashJson(ES_MAPPING),
    };
    const indexTargets = IndexTargetsSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      qdrant,
      elasticsearch,
    });
    const runNo = await this.nextRunNo(tx, input.documentId);
    const run = await tx.b_document_processing_runs.create({
      data: {
        document_id: input.documentId,
        run_no: runNo,
        trigger_type: 'upload',
        status: 'queued',
        current_stage: 'parse',
        source_sha256: input.sourceSha256,
        parser_config_json: DEFAULT_PARSER_CONFIG,
        chunking_config_json: DEFAULT_CHUNKING_CONFIG,
        embedding_model_name: embedding.config.model,
        embedding_dimension: embedding.config.dimension,
        embedding_config_json:
          embedding.config as unknown as Prisma.InputJsonValue,
        embedding_config_hash: embedding.hash,
        index_targets_json: indexTargets,
        retrieval_policy_json: DEFAULT_RETRIEVAL_POLICY,
        queued_at: new Date(),
      },
    });
    const task = await tx.b_document_processing_tasks.create({
      data: {
        processing_run_id: run.id,
        stage: 'parse',
        task_key: taskKey(run.id, 'parse', 'document'),
        queue_name: QUEUE_NAME,
        attempts_allowed: 3,
        status: 'queued',
        payload_json: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          taskId: run.id.toString(),
          processingRunId: run.id.toString(),
          attemptNo: 1,
        },
      },
    });
    const taskPayload = TaskPayloadSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      taskId: task.id.toString(),
      processingRunId: run.id.toString(),
      attemptNo: 1,
    });
    await tx.b_document_processing_tasks.update({
      where: { id: task.id },
      data: { payload_json: taskPayload },
    });
    await tx.b_documents.update({
      where: { id: input.documentId },
      data: { desired_run_id: run.id, status: 'processing' },
    });
    await tx.b_outbox_events.create({
      data: {
        event_key: dispatchEventKey(task.id, 1),
        event_type: 'dispatch_processing_task',
        aggregate_type: 'processing_task',
        aggregate_id: task.id.toString(),
        payload_json: taskPayload,
      },
    });
    return { run, task };
  }

  private async nextRunNo(tx: Prisma.TransactionClient, documentId: bigint) {
    const latest = await tx.b_document_processing_runs.findFirst({
      where: { document_id: documentId },
      orderBy: { run_no: 'desc' },
      select: { run_no: true },
    });
    return (latest?.run_no ?? 0) + 1;
  }
}

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
