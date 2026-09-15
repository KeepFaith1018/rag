import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  lockKnowledgeBaseById,
  lockDocumentById,
  lockProcessingRunById,
  lockProcessingTaskById,
} from '../../../platform/database/transaction-locks';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { AppLogger } from '../../../platform/observability/app-logger.service';
import {
  STORAGE_ADAPTER,
  StorageError,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { ProcessingPubSubService } from '../../../platform/queue/pubsub.service';
import { DOCUMENT_PROCESSING_QUEUE } from '../../../platform/queue/queue.constants';
import { ElasticsearchService } from '../../../platform/search/search.service';
import { QdrantService } from '../../../platform/vector/vector.service';
import {
  ChunkerService,
  DEFAULT_CHUNKING_CONFIG,
} from '../pipeline/chunker.service';
import { MarkdownParserService } from '../pipeline/markdown-parser.service';
import { EmbeddingService } from '../pipeline/embedding.service';
import {
  AstDocumentSchema,
  IndexTargetsSchema,
  ParserManifestSchema,
  TaskPayloadSchema,
  VectorArtifactSchema,
  parseVersioned,
} from '../contracts/schemas';
import {
  executionPrefix,
  processingChannel,
  stableExternalId,
  uuidV5,
} from '../contracts/identifiers';
import { PublishingService } from '../application/publishing.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';

type ClaimedTask = {
  task: Prisma.b_document_processing_tasksGetPayload<object>;
  run: Prisma.b_document_processing_runsGetPayload<object>;
  document: {
    id: bigint;
    kb_id: bigint;
    storage_bucket: string;
    storage_key: string;
    file_extension: string | null;
    status: string;
    deleted_at: Date | null;
  };
  executionVersion: number;
};

/** 共用任务执行协议：单次 Job、数据库尝试权威、条件回写和旧 execution 隔离。 */
@Injectable()
export class ProcessingTaskWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly connection: Redis;
  private worker?: Worker;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
    private readonly parser: MarkdownParserService,
    private readonly chunker: ChunkerService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly elasticsearch: ElasticsearchService,
    private readonly publishing: PublishingService,
    private readonly pubsub: ProcessingPubSubService,
    private readonly logger: AppLogger,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {
    this.connection = new Redis(runtime.redis.url, {
      password: runtime.redis.password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (attempt) => Math.min(attempt * 1000, 10000),
    });
  }

  onModuleInit() {
    this.worker = new Worker(
      DOCUMENT_PROCESSING_QUEUE,
      async (job) => this.handle(job),
      {
        connection: this.connection,
        prefix: this.runtime.queue.bullmqPrefix,
        concurrency: this.runtime.worker.concurrency,
      },
    );
    this.worker.on('error', () =>
      this.logger.warn('Document processing worker unavailable'),
    );
  }

  async handle(job: Job<unknown>) {
    if (this.stopping) return;
    const payload = parseVersioned(TaskPayloadSchema, job.data);
    const claimed = await this.claim(payload);
    if (!claimed) return;
    const heartbeat = setInterval(
      () =>
        void this.prisma.b_document_processing_tasks
          .updateMany({
            where: {
              id: claimed.task.id,
              status: 'running',
              execution_version: claimed.executionVersion,
            },
            data: { heartbeat_at: new Date() },
          })
          .catch(() => undefined),
      this.runtime.worker.heartbeatIntervalMs,
    );
    const abortController = new AbortController();
    try {
      await withTaskTimeout(
        this.executeClaimed(claimed, abortController.signal),
        this.runtime.worker.taskTimeoutMs,
        abortController,
      );
    } catch (error) {
      // 超时后立即停止续租，失败登记本身不可延长 execution 的生命周期。
      clearInterval(heartbeat);
      if (error instanceof StorageError)
        this.logger.warn('Object storage operation failed', {
          storageKind: error.storageKind,
          storageOperation: error.operation,
          storageStatusCode: error.statusCode,
          storageProviderCode: error.providerCode,
          storageRequestId: error.requestId,
        });
      await this.failOrRetry(claimed, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeClaimed(claimed: ClaimedTask, signal: AbortSignal) {
    if (claimed.task.stage === 'parse')
      return this.executeParse(claimed, signal);
    if (claimed.task.stage === 'chunk')
      return this.executeChunk(claimed, signal);
    if (claimed.task.stage === 'embed')
      return this.executeEmbed(claimed, signal);
    if (claimed.task.stage === 'vector_index')
      return this.executeVectorIndex(claimed, signal);
    if (claimed.task.stage === 'search_index')
      return this.executeSearchIndex(claimed, signal);
    throw new Error('PROCESSING_TASK_STAGE_UNSUPPORTED');
  }

  private async claim(
    payload: ReturnType<typeof TaskPayloadSchema.parse>,
  ): Promise<ClaimedTask | null> {
    const row = await this.prisma.b_document_processing_tasks.findUnique({
      where: { id: BigInt(payload.taskId) },
      include: { processing_run: true },
    });
    if (!row || row.processing_run.id.toString() !== payload.processingRunId)
      return null;
    if (
      ['failed', 'cancelled', 'succeeded'].includes(row.processing_run.status)
    )
      return null;
    const saved = row.payload_json as { attemptNo?: number } | null;
    if (
      saved?.attemptNo !== payload.attemptNo ||
      !['queued', 'retrying'].includes(row.status)
    )
      return null;
    if (row.available_at && row.available_at > new Date()) return null;
    const document = await this.prisma.b_documents.findUnique({
      where: { id: row.processing_run.document_id },
      select: {
        id: true,
        kb_id: true,
        storage_bucket: true,
        storage_key: true,
        file_extension: true,
        status: true,
        deleted_at: true,
      },
    });
    if (
      !document ||
      document.deleted_at ||
      ['deleting', 'deleted'].includes(document.status)
    )
      return null;
    const workerId = `worker-${process.pid}`;
    const version = row.execution_version + 1;
    const updated = await this.prisma.b_document_processing_tasks.updateMany({
      where: {
        id: row.id,
        status: row.status,
        execution_version: row.execution_version,
      },
      data: {
        status: 'running',
        attempts_made: { increment: 1 },
        execution_version: version,
        worker_id: workerId,
        locked_at: new Date(),
        heartbeat_at: new Date(),
        started_at: new Date(),
        last_error_code: null,
        last_error_message: null,
      },
    });
    if (updated.count !== 1) return null;
    return {
      task: row,
      run: row.processing_run,
      document,
      executionVersion: version,
    };
  }

  /**
   * 在 knowledge_base → document → run → task 统一锁顺序下确认执行权仍有效。
   * 调用方只能在同一事务中继续写入终态或派生后继任务。
   */
  private async lockRunnableExecution(
    tx: Prisma.TransactionClient,
    claimed: ClaimedTask,
  ) {
    if (!(await lockKnowledgeBaseById(tx, claimed.document.kb_id)))
      return false;
    if (!(await lockDocumentById(tx, claimed.document.id))) return false;
    if (!(await lockProcessingRunById(tx, claimed.run.id))) return false;
    if (!(await lockProcessingTaskById(tx, claimed.task.id))) return false;
    const [run, task] = await Promise.all([
      tx.b_document_processing_runs.findUnique({
        where: { id: claimed.run.id },
        select: { status: true },
      }),
      tx.b_document_processing_tasks.findUnique({
        where: { id: claimed.task.id },
        select: {
          processing_run_id: true,
          status: true,
          execution_version: true,
        },
      }),
    ]);
    return (
      !!run &&
      ['queued', 'running'].includes(run.status) &&
      task?.processing_run_id === claimed.run.id &&
      task.status === 'running' &&
      task.execution_version === claimed.executionVersion
    );
  }

  private async executeParse(claimed: ClaimedTask, signal: AbortSignal) {
    const stream = await this.storage.readObject({
      bucket: claimed.document.storage_bucket,
      key: claimed.document.storage_key,
    });
    const buffer = await readBounded(stream, this.runtime.parser.maxBytes);
    const ast = await this.parser.parse(buffer, {
      extension: claimed.document.file_extension ?? '',
      documentId: claimed.document.id.toString(),
      processingRunId: claimed.run.id.toString(),
    });
    signal.throwIfAborted();
    const prefix = executionPrefix(
      claimed.document.id,
      claimed.run.id,
      claimed.task.id,
      claimed.executionVersion,
    );
    const markdownKey = `${prefix}markdown/document.md`;
    const astKey = `${prefix}ast/document.json`;
    await this.storage.putObject({
      bucket: claimed.document.storage_bucket,
      key: markdownKey,
      body: Buffer.from(ast.markdown),
      contentType: 'text/markdown; charset=utf-8',
    });
    signal.throwIfAborted();
    await this.storage.putObject({
      bucket: claimed.document.storage_bucket,
      key: astKey,
      body: Buffer.from(JSON.stringify(ast)),
      contentType: 'application/json',
    });
    signal.throwIfAborted();
    const manifest = ParserManifestSchema.parse({
      schemaVersion: 1,
      documentId: claimed.document.id.toString(),
      processingRunId: claimed.run.id.toString(),
      taskId: claimed.task.id.toString(),
      executionVersion: claimed.executionVersion,
      parserUsed: ast.parser,
      parserVersion: ast.parserVersion,
      markdownSha256: ast.markdownSha256,
      artifacts: [
        {
          bucket: claimed.document.storage_bucket,
          key: markdownKey,
          size: Buffer.byteLength(ast.markdown),
          sha256: ast.markdownSha256,
          format: 'markdown',
        },
        {
          bucket: claimed.document.storage_bucket,
          key: astKey,
          size: Buffer.byteLength(JSON.stringify(ast)),
          sha256: sha256(JSON.stringify(ast)),
          format: 'ast-json',
        },
      ],
      degraded: ast.degraded,
      warnings: ast.warnings,
    });
    const manifestKey = `${prefix}manifests/parse.json`;
    await this.storage.putObject({
      bucket: claimed.document.storage_bucket,
      key: manifestKey,
      body: Buffer.from(JSON.stringify(manifest)),
      contentType: 'application/json',
    });
    signal.throwIfAborted();
    const nextTask = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return null;
      signal.throwIfAborted();
      const current = await tx.b_document_processing_tasks.updateMany({
        where: {
          id: claimed.task.id,
          status: 'running',
          execution_version: claimed.executionVersion,
        },
        data: {
          status: 'succeeded',
          result_json: { schemaVersion: 1, markdownKey, astKey, manifestKey },
          artifact_manifest_json: manifest,
          finished_at: new Date(),
          duration_ms: 0,
        },
      });
      if (current.count !== 1) return null;
      const advanced = await tx.b_document_processing_runs.updateMany({
        where: { id: claimed.run.id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'running',
          current_stage: 'chunk',
          started_at: new Date(),
        },
      });
      if (advanced.count !== 1) throw new Error('PROCESSING_RUN_NOT_RUNNABLE');
      const task = await tx.b_document_processing_tasks.create({
        data: {
          processing_run_id: claimed.run.id,
          parent_task_id: claimed.task.id,
          stage: 'chunk',
          task_key: `run:${claimed.run.id}:chunk:document`,
          queue_name: 'document-processing',
          attempts_allowed: 3,
          payload_json: {
            schemaVersion: 1,
            taskId: '0',
            processingRunId: claimed.run.id.toString(),
            attemptNo: 1,
          },
        },
      });
      const payload = {
        schemaVersion: 1,
        taskId: task.id.toString(),
        processingRunId: claimed.run.id.toString(),
        attemptNo: 1,
      };
      await tx.b_document_processing_tasks.update({
        where: { id: task.id },
        data: { payload_json: payload },
      });
      await tx.b_outbox_events.create({
        data: {
          event_key: `dispatch-task-${task.id}-attempt-1`,
          event_type: 'dispatch_processing_task',
          aggregate_type: 'processing_task',
          aggregate_id: task.id.toString(),
          payload_json: payload,
        },
      });
      signal.throwIfAborted();
      return task;
    });
    if (nextTask)
      await this.notify(claimed.document.kb_id, claimed.document.id);
  }

  private async executeChunk(claimed: ClaimedTask, signal: AbortSignal) {
    const result = claimed.task.result_json as { astKey?: string } | null;
    const parseResult = await this.prisma.b_document_processing_tasks.findFirst(
      {
        where: {
          processing_run_id: claimed.run.id,
          stage: 'parse',
          status: 'succeeded',
        },
        orderBy: { id: 'desc' },
      },
    );
    const astKey =
      result?.astKey ??
      (parseResult?.result_json as { astKey?: string } | null)?.astKey;
    if (!astKey) throw new Error('PARSE_ARTIFACT_MISSING');
    const ast = parseVersioned(
      AstDocumentSchema,
      JSON.parse(
        await readAll(
          await this.storage.readObject({
            bucket: claimed.document.storage_bucket,
            key: astKey,
          }),
        ),
      ),
    );
    const drafts = this.chunker.createChunks(ast, DEFAULT_CHUNKING_CONFIG);
    signal.throwIfAborted();
    const completed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return false;
      signal.throwIfAborted();
      const owned = await tx.b_document_processing_tasks.updateMany({
        where: {
          id: claimed.task.id,
          status: 'running',
          execution_version: claimed.executionVersion,
        },
        data: {
          status: 'succeeded',
          result_json: { schemaVersion: 1, chunkCount: drafts.length },
          finished_at: new Date(),
        },
      });
      if (owned.count !== 1) return false;
      const existing = await tx.b_document_chunks.count({
        where: { processing_run_id: claimed.run.id },
      });
      if (existing === 0) {
        const ids: bigint[] = [];
        for (const draft of drafts) {
          const parent =
            draft.parentIndex === null ? null : ids[draft.parentIndex];
          const root = ids[draft.rootIndex];
          const participates = draft.chunkLevel === 3;
          const created = await tx.b_document_chunks.create({
            data: {
              processing_run_id: claimed.run.id,
              chunk_no: draft.chunkNo,
              content: draft.content,
              content_hash: draft.contentHash,
              token_count: draft.tokenCount,
              page_start: draft.pageStart,
              page_end: draft.pageEnd,
              char_start: draft.charStart,
              char_end: draft.charEnd,
              chunk_level: draft.chunkLevel,
              parent_chunk_id: parent,
              root_chunk_id: root,
              embedding_status: participates ? 'pending' : 'skipped',
              vector_index_status: participates ? 'pending' : 'skipped',
              search_index_status: participates ? 'pending' : 'skipped',
              metadata_json: draft.metadata,
            },
          });
          ids.push(created.id);
        }
      }
      const count = await tx.b_document_chunks.count({
        where: { processing_run_id: claimed.run.id },
      });
      await tx.b_document_processing_runs.update({
        where: { id: claimed.run.id },
        data: { total_chunks: count, current_stage: 'embed' },
      });
      const chunks = await tx.b_document_chunks.findMany({
        where: { processing_run_id: claimed.run.id, chunk_level: 3 },
        select: { id: true, token_count: true },
        orderBy: { chunk_no: 'asc' },
      });
      const batches = {
        embed: batchEmbeddingChunks(
          chunks,
          this.runtime.worker.batchSize,
          this.runtime.worker.embeddingBatchTokens,
        ),
        search_index: batchChunksByCount(chunks, this.runtime.worker.batchSize),
      };
      for (const stage of ['embed', 'search_index'] as const) {
        for (const [batchIndex, batch] of batches[stage].entries()) {
          const task = await tx.b_document_processing_tasks.create({
            data: {
              processing_run_id: claimed.run.id,
              parent_task_id: claimed.task.id,
              stage,
              task_key: `run:${claimed.run.id}:${stage}:batch:${batchIndex + 1}`,
              queue_name: 'document-processing',
              batch_no: batchIndex + 1,
              scope_json: { chunkIds: batch.map((item) => item.id.toString()) },
              attempts_allowed: 3,
              payload_json: {
                schemaVersion: 1,
                taskId: '0',
                processingRunId: claimed.run.id.toString(),
                attemptNo: 1,
              },
            },
          });
          const payload = {
            schemaVersion: 1,
            taskId: task.id.toString(),
            processingRunId: claimed.run.id.toString(),
            attemptNo: 1,
          };
          await tx.b_document_processing_tasks.update({
            where: { id: task.id },
            data: { payload_json: payload },
          });
          await tx.b_outbox_events.create({
            data: {
              event_key: `dispatch-task-${task.id}-attempt-1`,
              event_type: 'dispatch_processing_task',
              aggregate_type: 'processing_task',
              aggregate_id: task.id.toString(),
              payload_json: payload,
            },
          });
        }
      }
      signal.throwIfAborted();
      return true;
    });
    if (completed)
      await this.notify(claimed.document.kb_id, claimed.document.id);
  }

  private async executeEmbed(claimed: ClaimedTask, signal: AbortSignal) {
    const chunkIds = scopeChunkIds(claimed.task.scope_json);
    const chunks = await this.loadChunks(claimed.run.id, chunkIds);
    const vectors = await this.embedding.embed(
      claimed.run.embedding_config_json,
      chunks.map((chunk) => chunk.content),
      signal,
    );
    signal.throwIfAborted();
    if (!claimed.run.embedding_dimension)
      throw new Error('EMBEDDING_DIMENSION_MISSING');
    const artifact = VectorArtifactSchema.parse({
      schemaVersion: 1,
      processingRunId: claimed.run.id.toString(),
      taskId: claimed.task.id.toString(),
      batchNo: claimed.task.batch_no ?? 1,
      executionVersion: claimed.executionVersion,
      embeddingConfigHash: claimed.run.embedding_config_hash,
      dimension: claimed.run.embedding_dimension,
      rows: chunks.map((chunk, index) => ({
        chunkId: chunk.id.toString(),
        contentHash: chunk.content_hash ?? '',
        vector: vectors[index],
      })),
      createdAt: new Date().toISOString(),
    });
    const body = JSON.stringify(artifact);
    const vectorKey = `${executionPrefix(claimed.document.id, claimed.run.id, claimed.task.id, claimed.executionVersion)}vectors/batch-${claimed.task.batch_no ?? 1}.json`;
    await this.storage.putObject({
      bucket: claimed.document.storage_bucket,
      key: vectorKey,
      body: Buffer.from(body),
      contentType: 'application/json',
    });
    signal.throwIfAborted();
    const vectorTask = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return null;
      signal.throwIfAborted();
      const completed = await tx.b_document_processing_tasks.updateMany({
        where: {
          id: claimed.task.id,
          status: 'running',
          execution_version: claimed.executionVersion,
        },
        data: {
          status: 'succeeded',
          result_json: {
            schemaVersion: 1,
            vectorKey,
            vectorSha256: sha256(body),
            count: artifact.rows.length,
          },
          artifact_manifest_json: {
            schemaVersion: 1,
            artifacts: [
              {
                bucket: claimed.document.storage_bucket,
                key: vectorKey,
                size: Buffer.byteLength(body),
                sha256: sha256(body),
                format: 'vectors-json',
                count: artifact.rows.length,
                embeddingConfigHash: claimed.run.embedding_config_hash,
              },
            ],
          },
          finished_at: new Date(),
        },
      });
      if (completed.count !== 1) return null;
      for (const chunk of chunks) {
        await tx.b_document_chunks.updateMany({
          where: { id: chunk.id, processing_run_id: claimed.run.id },
          data: {
            embedding_status: 'completed',
            embedding_error: null,
            embedded_at: new Date(),
            vector_id: uuidV5(claimed.run.id, chunk.id),
          },
        });
      }
      const task = await tx.b_document_processing_tasks.create({
        data: {
          processing_run_id: claimed.run.id,
          parent_task_id: claimed.task.id,
          stage: 'vector_index',
          task_key: `run:${claimed.run.id}:vector_index:batch:${claimed.task.batch_no ?? 1}`,
          queue_name: DOCUMENT_PROCESSING_QUEUE,
          batch_no: claimed.task.batch_no,
          scope_json: { chunkIds },
          attempts_allowed: 3,
          payload_json: {
            schemaVersion: 1,
            taskId: '0',
            processingRunId: claimed.run.id.toString(),
            attemptNo: 1,
          },
        },
      });
      const payload = {
        schemaVersion: 1,
        taskId: task.id.toString(),
        processingRunId: claimed.run.id.toString(),
        attemptNo: 1,
      };
      await tx.b_document_processing_tasks.update({
        where: { id: task.id },
        data: { payload_json: payload },
      });
      await tx.b_outbox_events.create({
        data: {
          event_key: `dispatch-task-${task.id}-attempt-1`,
          event_type: 'dispatch_processing_task',
          aggregate_type: 'processing_task',
          aggregate_id: task.id.toString(),
          payload_json: payload,
        },
      });
      const pendingEmbeds = await tx.b_document_processing_tasks.count({
        where: {
          processing_run_id: claimed.run.id,
          stage: 'embed',
          status: { not: 'succeeded' },
        },
      });
      if (pendingEmbeds === 0)
        await tx.b_document_processing_runs.updateMany({
          where: { id: claimed.run.id, current_stage: 'embed' },
          data: { current_stage: 'index' },
        });
      signal.throwIfAborted();
      return task;
    });
    if (vectorTask)
      await this.notify(claimed.document.kb_id, claimed.document.id);
  }

  private async executeVectorIndex(claimed: ClaimedTask, signal: AbortSignal) {
    const parent = claimed.task.parent_task_id
      ? await this.prisma.b_document_processing_tasks.findUnique({
          where: { id: claimed.task.parent_task_id },
        })
      : null;
    const vectorKey = (parent?.result_json as { vectorKey?: string } | null)
      ?.vectorKey;
    if (!vectorKey) throw new Error('VECTOR_ARTIFACT_MISSING');
    const body = await readAll(
      await this.storage.readObject({
        bucket: claimed.document.storage_bucket,
        key: vectorKey,
      }),
    );
    const artifact = parseVersioned(VectorArtifactSchema, JSON.parse(body));
    if (
      artifact.processingRunId !== claimed.run.id.toString() ||
      artifact.embeddingConfigHash !== claimed.run.embedding_config_hash
    )
      throw new Error('VECTOR_ARTIFACT_MISMATCH');
    const targets = parseVersioned(
      IndexTargetsSchema,
      claimed.run.index_targets_json,
    );
    signal.throwIfAborted();
    await this.qdrant.ensure(targets.qdrant);
    signal.throwIfAborted();
    await this.qdrant.upsert(
      targets.qdrant,
      artifact.rows.map((row) => ({
        id: uuidV5(claimed.run.id, row.chunkId),
        vector: row.vector,
        payload: {
          kbId: claimed.document.kb_id.toString(),
          documentId: claimed.document.id.toString(),
          processingRunId: claimed.run.id.toString(),
          chunkId: row.chunkId,
          chunkLevel: 3,
          embeddingConfigHash: claimed.run.embedding_config_hash,
        },
      })),
    );
    signal.throwIfAborted();
    const completed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return false;
      signal.throwIfAborted();
      const completed = await tx.b_document_processing_tasks.updateMany({
        where: {
          id: claimed.task.id,
          status: 'running',
          execution_version: claimed.executionVersion,
        },
        data: {
          status: 'succeeded',
          result_json: { schemaVersion: 1, count: artifact.rows.length },
          finished_at: new Date(),
        },
      });
      if (completed.count !== 1) return false;
      for (const row of artifact.rows)
        await tx.b_document_chunks.updateMany({
          where: { id: BigInt(row.chunkId), processing_run_id: claimed.run.id },
          data: {
            vector_index_status: 'completed',
            vector_index_error: null,
            vector_indexed_at: new Date(),
          },
        });
      signal.throwIfAborted();
      return true;
    });
    if (completed) await this.afterIndex(claimed);
  }

  private async executeSearchIndex(claimed: ClaimedTask, signal: AbortSignal) {
    const chunkIds = scopeChunkIds(claimed.task.scope_json);
    const chunks = await this.loadChunks(claimed.run.id, chunkIds);
    const targets = parseVersioned(
      IndexTargetsSchema,
      claimed.run.index_targets_json,
    );
    signal.throwIfAborted();
    await this.elasticsearch.ensure(targets.elasticsearch);
    signal.throwIfAborted();
    await this.elasticsearch.bulk(
      targets.elasticsearch,
      chunks.map((chunk) => ({
        id: stableExternalId(claimed.run.id, chunk.id),
        kbId: claimed.document.kb_id.toString(),
        documentId: claimed.document.id.toString(),
        processingRunId: claimed.run.id.toString(),
        chunkId: chunk.id.toString(),
        chunkLevel: chunk.chunk_level,
        embeddingConfigHash: claimed.run.embedding_config_hash,
        content: chunk.content,
      })),
    );
    signal.throwIfAborted();
    await this.elasticsearch.refresh(targets.elasticsearch);
    signal.throwIfAborted();
    const completed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return false;
      signal.throwIfAborted();
      const completed = await tx.b_document_processing_tasks.updateMany({
        where: {
          id: claimed.task.id,
          status: 'running',
          execution_version: claimed.executionVersion,
        },
        data: {
          status: 'succeeded',
          result_json: { schemaVersion: 1, count: chunks.length },
          finished_at: new Date(),
        },
      });
      if (completed.count !== 1) return false;
      for (const chunk of chunks)
        await tx.b_document_chunks.updateMany({
          where: { id: chunk.id, processing_run_id: claimed.run.id },
          data: {
            search_index_status: 'completed',
            search_index_error: null,
            search_indexed_at: new Date(),
          },
        });
      signal.throwIfAborted();
      return true;
    });
    if (completed) await this.afterIndex(claimed);
  }

  private async loadChunks(runId: bigint, ids: string[]) {
    const chunks = await this.prisma.b_document_chunks.findMany({
      where: { processing_run_id: runId, id: { in: ids.map(BigInt) } },
      orderBy: { chunk_no: 'asc' },
    });
    if (
      chunks.length !== ids.length ||
      chunks.some((chunk) => !chunk.content_hash)
    )
      throw new Error('CHUNK_SCOPE_MISMATCH');
    return chunks;
  }

  private async afterIndex(claimed: ClaimedTask) {
    const published = await this.publishing.tryPublish(claimed.run.id);
    if (published)
      await this.notify(claimed.document.kb_id, claimed.document.id);
  }

  private async failOrRetry(claimed: ClaimedTask, error: unknown) {
    const exhausted =
      !isRetryable(error) ||
      claimed.task.attempts_made + 1 >= claimed.task.attempts_allowed;
    const changed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockRunnableExecution(tx, claimed))) return false;
      const where = {
        id: claimed.task.id,
        status: 'running' as const,
        execution_version: claimed.executionVersion,
      };
      if (!exhausted) {
        const nextAttempt = claimed.task.attempts_made + 2;
        const availableAt = new Date(
          Date.now() + 1000 * Math.pow(2, claimed.task.attempts_made),
        );
        const retry = await tx.b_document_processing_tasks.updateMany({
          where,
          data: {
            status: 'retrying',
            available_at: availableAt,
            payload_json: {
              schemaVersion: 1,
              taskId: claimed.task.id.toString(),
              processingRunId: claimed.run.id.toString(),
              attemptNo: nextAttempt,
            },
            last_error_code: 'RETRYABLE',
            last_error_message: safeMessage(error),
            worker_id: null,
            locked_at: null,
            heartbeat_at: null,
          },
        });
        if (retry.count === 1)
          await tx.b_outbox_events.create({
            data: {
              event_key: `dispatch-task-${claimed.task.id}-attempt-${nextAttempt}`,
              event_type: 'dispatch_processing_task',
              aggregate_type: 'processing_task',
              aggregate_id: claimed.task.id.toString(),
              payload_json: {
                schemaVersion: 1,
                taskId: claimed.task.id.toString(),
                processingRunId: claimed.run.id.toString(),
                attemptNo: nextAttempt,
              },
              available_at: availableAt,
            },
          });
        return retry.count === 1;
      }
      const failedTask = await tx.b_document_processing_tasks.updateMany({
        where,
        data: {
          status: 'failed',
          last_error_code: 'PROCESSING_FAILED',
          last_error_message: safeMessage(error),
          finished_at: new Date(),
          worker_id: null,
          locked_at: null,
          heartbeat_at: null,
        },
      });
      if (failedTask.count !== 1) return false;
      const failedRun = await tx.b_document_processing_runs.updateMany({
        where: {
          id: claimed.run.id,
          status: { notIn: ['succeeded', 'failed', 'cancelled'] },
        },
        data: {
          status: 'failed',
          error_code: 'PROCESSING_FAILED',
          error_message: safeMessage(error),
          finished_at: new Date(),
        },
      });
      if (failedRun.count !== 1) throw new Error('PROCESSING_RUN_NOT_RUNNABLE');
      await tx.b_document_processing_tasks.updateMany({
        where: {
          processing_run_id: claimed.run.id,
          id: { not: claimed.task.id },
          status: { in: ['queued', 'running', 'retrying'] },
        },
        data: {
          status: 'cancelled',
          execution_version: { increment: 1 },
          worker_id: null,
          locked_at: null,
          heartbeat_at: null,
          finished_at: new Date(),
        },
      });
      const document = await tx.b_documents.findUnique({
        where: { id: claimed.run.document_id },
        select: { active_run_id: true },
      });
      if (!document?.active_run_id)
        await tx.b_documents.updateMany({
          where: {
            id: claimed.run.document_id,
            desired_run_id: claimed.run.id,
            status: { notIn: ['deleting', 'deleted'] },
          },
          data: { status: 'failed' },
        });
      return true;
    });
    if (changed) await this.notify(claimed.document.kb_id, claimed.document.id);
  }

  private async notify(kbId: bigint, documentId: bigint) {
    await this.pubsub.publish(
      processingChannel(this.runtime.queue.processingChannelPrefix, kbId),
      JSON.stringify({
        schemaVersion: 1,
        eventType: 'document_processing_changed',
        documentId: documentId.toString(),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async onModuleDestroy() {
    this.stopping = true;
    // 先断开底层连接并让微任务 flush，使 BullMQ 内部 RedisConnection 的初始化在仍有
    // error 监听者时 settle，避免 close 触发未处理的 "Connection is closed."。
    if (this.connection.status === 'ready') await this.connection.quit();
    else this.connection.disconnect();
    // blockingConnection 是 BullMQ 通过 duplicate() 创建的独立连接，disconnect 传入的
    // connection 不会影响它；这里直接断开它的底层连接，让其在移除监听前完成初始化。
    const blockingClient = (
      this.worker as unknown as {
        blockingConnection?: { _client?: { disconnect(): void } };
      } | null
    )?.blockingConnection?._client;
    blockingClient?.disconnect();
    await new Promise((resolve) => setImmediate(resolve));
    if (this.worker) await this.worker.close();
  }
}

async function readAll(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

async function readBounded(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk as Uint8Array);
    size += value.length;
    if (size > maxBytes) throw new Error('PARSER_RESOURCE_LIMIT');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 200)
    : 'PROCESSING_FAILED';
}

function isRetryable(error: unknown) {
  if (error instanceof StorageError)
    return ['rate-limit', 'timeout', 'unavailable', 'unknown'].includes(
      error.storageKind,
    );
  if (error instanceof BusinessError)
    return error.kind === 'unavailable' || error.kind === 'internal';
  return true;
}

function scopeChunkIds(value: Prisma.JsonValue | null) {
  const ids = (value as { chunkIds?: unknown } | null)?.chunkIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((item) => typeof item !== 'string' || !/^[1-9]\d*$/.test(item))
  )
    throw new Error('CHUNK_SCOPE_INVALID');
  return ids as string[];
}

async function withTaskTimeout<T>(
  execution: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('TASK_TIMEOUT');
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type BatchChunk = { id: bigint; token_count: number | null };

export function batchEmbeddingChunks(
  chunks: BatchChunk[],
  maxCount: number,
  maxTokens: number,
): BatchChunk[][] {
  const batches: BatchChunk[][] = [];
  let batch: BatchChunk[] = [];
  let tokens = 0;
  for (const chunk of chunks) {
    const count = chunk.token_count;
    if (count === null || count < 1 || count > maxTokens)
      throw new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_RESOURCE_LIMIT,
        'Chunk 超过 Embedding 单批 Token 上限',
        'validation',
      );
    if (
      batch.length &&
      (batch.length >= maxCount || tokens + count > maxTokens)
    ) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(chunk);
    tokens += count;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function batchChunksByCount(chunks: BatchChunk[], maxCount: number) {
  const batches: BatchChunk[][] = [];
  for (let i = 0; i < chunks.length; i += maxCount)
    batches.push(chunks.slice(i, i + maxCount));
  return batches;
}
