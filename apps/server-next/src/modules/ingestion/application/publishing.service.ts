import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  lockDocumentById,
  lockKnowledgeBaseById,
  lockProcessingRunById,
} from '../../../platform/database/transaction-locks';
import { ElasticsearchService } from '../../../platform/search/search.service';
import { QdrantService } from '../../../platform/vector/vector.service';
import {
  IndexTargetsSchema,
  RetrievalPolicySchema,
  parseVersioned,
} from '../contracts/schemas';

/** 发布资格协调器。外部核验在事务外完成，短事务只做 desired run 条件切换。 */
@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrant: QdrantService,
    private readonly elasticsearch: ElasticsearchService,
  ) {}

  async tryPublish(runId: bigint) {
    const run = await this.prisma.b_document_processing_runs.findUnique({
      where: { id: runId },
      include: {
        document: {
          select: {
            id: true,
            kb_id: true,
            desired_run_id: true,
            deleted_at: true,
            status: true,
          },
        },
        processing_tasks: { select: { status: true } },
      },
    });
    if (!run || run.status === 'failed' || run.status === 'cancelled')
      return false;
    if (
      run.document.deleted_at ||
      run.document.status === 'deleting' ||
      run.document.status === 'deleted'
    )
      return false;
    if (run.document.desired_run_id !== run.id) return false;
    if (
      !run.processing_tasks.length ||
      run.processing_tasks.some((task) => task.status !== 'succeeded')
    )
      return false;
    const policy = parseVersioned(
      RetrievalPolicySchema,
      run.retrieval_policy_json,
    );
    const requiredLevels = Object.entries(policy.levels)
      .filter(
        ([, value]) =>
          value.embedding || value.vectorIndex || value.searchIndex,
      )
      .map(([level]) => Number(level));
    const chunks = await this.prisma.b_document_chunks.findMany({
      where: { processing_run_id: run.id, chunk_level: { in: requiredLevels } },
      select: {
        embedding_status: true,
        vector_index_status: true,
        search_index_status: true,
      },
    });
    if (!chunks.length) return false;
    if (
      chunks.some(
        (chunk) =>
          chunk.embedding_status !== 'completed' ||
          chunk.vector_index_status !== 'completed' ||
          chunk.search_index_status !== 'completed',
      )
    )
      return false;
    const targets = parseVersioned(IndexTargetsSchema, run.index_targets_json);
    await Promise.all([
      this.qdrant.ensure(targets.qdrant),
      this.elasticsearch.ensure(targets.elasticsearch),
    ]);
    const [vectorCount, searchCount] = await Promise.all([
      this.qdrant.countRun(targets.qdrant, run.id.toString()),
      this.elasticsearch.countRun(targets.elasticsearch, run.id.toString()),
    ]);
    if (vectorCount !== chunks.length || searchCount !== chunks.length)
      return false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 与删除/重建竞争共享统一加锁顺序：knowledge_base → document → processing_run。
        await lockKnowledgeBaseById(tx, run.document.kb_id);
        await lockDocumentById(tx, run.document_id);
        await lockProcessingRunById(tx, run.id);
        const completed = await tx.b_document_processing_runs.updateMany({
          where: { id: run.id, status: { in: ['queued', 'running'] } },
          data: {
            status: 'succeeded',
            current_stage: 'completed',
            completed_chunks: chunks.length,
            finished_at: new Date(),
          },
        });
        if (completed.count !== 1) return false;
        const document = await tx.b_documents.updateMany({
          where: {
            id: run.document_id,
            desired_run_id: run.id,
            deleted_at: null,
            status: { notIn: ['deleting', 'deleted'] },
          },
          data: { active_run_id: run.id, status: 'ready' },
        });
        // document 竞争失败必须回滚已经写入的 run 终态，不能提交半次发布。
        if (document.count !== 1) throw new PublishingConflict();
        return true;
      });
    } catch (error) {
      if (error instanceof PublishingConflict) return false;
      throw error;
    }
  }
}

class PublishingConflict extends Error {}
