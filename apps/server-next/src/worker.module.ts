import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './platform/config/runtime-config.module';
import { DatabaseModule } from './platform/database/database.module';
import { ObservabilityModule } from './platform/observability/observability.module';
import { RedisModule } from './platform/redis/redis.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { StorageModule } from './platform/object-storage/storage.module';
import { OutboxDispatcherService } from './modules/ingestion/jobs/outbox-dispatcher.service';
import { ProcessingTaskWorkerService } from './modules/ingestion/jobs/processing-task-worker.service';
import { CleanupWorkerService } from './modules/ingestion/cleanup/cleanup-worker.service';
import { ProcessingReconcilerService } from './modules/ingestion/jobs/processing-reconciler.service';
import { UploadCompletionRecoveryService } from './modules/ingestion/jobs/upload-completion-recovery.service';
import { RetentionReconcilerService } from './modules/ingestion/cleanup/retention-reconciler.service';

/**
 * Worker 进程的根组合模块。
 *
 * 装配队列消费者、Outbox 投递、任务恢复与清理服务，并保持与 HTTP API 隔离的进程边界。
 */
@Module({
  imports: [
    RuntimeConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    IngestionModule,
    StorageModule,
  ],
  providers: [
    OutboxDispatcherService,
    ProcessingTaskWorkerService,
    CleanupWorkerService,
    ProcessingReconcilerService,
    UploadCompletionRecoveryService,
    RetentionReconcilerService,
  ],
})
export class WorkerModule {}
