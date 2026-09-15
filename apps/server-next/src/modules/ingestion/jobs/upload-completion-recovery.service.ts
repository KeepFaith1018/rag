import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { ProcessingCoordinatorService } from '../application/processing-coordinator.service';
import { lockUploadSessionById } from '../../../platform/database/transaction-locks';

/** 恢复 MinIO Complete 已成功、但 document/run 登记尚未提交的 completing session。 */
@Injectable()
export class UploadCompletionRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
    private readonly coordinator: ProcessingCoordinatorService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.recoverOnce().catch(() => undefined),
      this.runtime.worker.reconcileIntervalMs,
    );
    void this.recoverOnce().catch(() => undefined);
  }

  async recoverOnce(limit = 20) {
    const sessions = await this.prisma.b_upload_sessions.findMany({
      where: { status: 'completing', document_id: null },
      orderBy: { updated_at: 'asc' },
      take: limit,
    });
    for (const session of sessions) {
      try {
        const head = await this.storage.headObject({
          bucket: session.storage_bucket,
          key: session.storage_key,
        });
        if (head.size !== Number(session.file_size)) continue;
        const digest = createHash('sha256');
        let size = 0;
        let prefix = Buffer.alloc(0);
        const stream = await this.storage.readObject({
          bucket: session.storage_bucket,
          key: session.storage_key,
        });
        for await (const chunk of stream) {
          const value = Buffer.from(chunk as Uint8Array);
          if (prefix.length < 16)
            prefix = Buffer.concat([prefix, value]).subarray(0, 16);
          size += value.length;
          digest.update(value);
        }
        const sha256 = digest.digest('hex');
        if (
          size !== Number(session.file_size) ||
          (session.client_sha256 && session.client_sha256 !== sha256) ||
          !contentMatches(session.file_extension ?? '', prefix)
        ) {
          await this.prisma.b_upload_sessions.updateMany({
            where: { id: session.id, status: 'completing' },
            data: { status: 'failed', last_activity_at: new Date() },
          });
          continue;
        }
        await this.prisma.$transaction(async (tx) => {
          await lockUploadSessionById(tx, session.id);
          const current = await tx.b_upload_sessions.findUnique({
            where: { id: session.id },
          });
          if (
            !current ||
            current.status !== 'completing' ||
            current.document_id
          )
            return;
          const document = await tx.b_documents.create({
            data: {
              kb_id: current.kb_id,
              uploader_id: current.user_id,
              title: current.title ?? current.file_name,
              original_filename: current.file_name,
              file_extension: current.file_extension,
              mime_type: current.mime_type,
              storage_provider: current.storage_provider,
              storage_bucket: current.storage_bucket,
              storage_key: current.storage_key,
              storage_etag: head.etag,
              file_size: current.file_size,
              file_sha256: sha256,
              status: 'processing',
            },
          });
          await this.coordinator.createInitialRun(tx, {
            documentId: document.id,
            sourceSha256: sha256,
          });
          await tx.b_upload_sessions.update({
            where: { id: current.id },
            data: {
              status: 'completed',
              document_id: document.id,
              completed_at: new Date(),
              uploaded_parts: current.total_parts,
              uploaded_bytes: current.file_size,
            },
          });
        });
      } catch {
        // 对象存储或模型配置暂不可用时保留 completing，下一轮继续恢复。
      }
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

function contentMatches(extension: string, prefix: Buffer) {
  if (extension === '.pdf') return prefix.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.docx') return prefix.subarray(0, 2).toString() === 'PK';
  return !prefix.includes(0);
}
