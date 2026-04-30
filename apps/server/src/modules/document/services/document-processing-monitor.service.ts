import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE,
  DOCUMENT_PROCESSING_TIMEOUT_MS,
  DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS,
} from '../document-processing.constants';
import { DocumentProcessingStateService } from './document-processing-state.service';
import { DocumentProcessingTaskService } from './document-processing-task.service';

/**
 * 负责扫描长时间未推进的文档处理阶段任务。
 */
@Injectable()
export class DocumentProcessingMonitorService {
  private scanning = false;
  private lastScannedAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly documentProcessingTaskService: DocumentProcessingTaskService,
    private readonly documentProcessingStateService: DocumentProcessingStateService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 定时扫描运行中但已超时的阶段任务。
   */
  @Interval(DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS)
  async scanTimedOutTasks() {
    if (this.scanning) {
      return;
    }

    const scanIntervalMs =
      this.getNumberConfig('DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS') ??
      DOCUMENT_PROCESSING_TIMEOUT_SCAN_INTERVAL_MS;
    if (Date.now() - this.lastScannedAt < scanIntervalMs) {
      return;
    }

    this.scanning = true;
    try {
      this.lastScannedAt = Date.now();
      const timeoutMs =
        this.getNumberConfig('DOCUMENT_PROCESSING_TIMEOUT_MS') ??
        DOCUMENT_PROCESSING_TIMEOUT_MS;
      const timedOutTasks =
        await this.documentProcessingTaskService.findTimedOutRunningTasks(
          timeoutMs,
        );

      for (const task of timedOutTasks) {
        const timeoutMessage = `文档处理阶段执行超时，超过 ${timeoutMs}ms 未完成`;
        const updatedTask =
          await this.documentProcessingTaskService.markTaskTimedOut({
            taskId: task.id,
            errorMessage: timeoutMessage,
          });

        if (!updatedTask) {
          continue;
        }

        await this.documentProcessingStateService.markFailed({
          documentId: updatedTask.document_id,
          processingVersion: updatedTask.processing_version,
          stage: updatedTask.stage,
          errorCode: DOCUMENT_PROCESSING_TIMEOUT_ERROR_CODE,
          message: timeoutMessage,
          retryCount: updatedTask.attempt,
        });

        this.logger.warn('[DocumentProcessingTimeoutDetected]', {
          taskId: updatedTask.id.toString(),
          documentId: updatedTask.document_id.toString(),
          processingVersion: updatedTask.processing_version,
          stage: updatedTask.stage,
          timeoutMs,
        });
      }
    } finally {
      this.scanning = false;
    }
  }

  /**
   * 将环境变量中的数值配置安全转换为 number。
   */
  private getNumberConfig(key: string) {
    const rawValue = this.configService.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return undefined;
    }

    const parsedValue =
      typeof rawValue === 'number' ? rawValue : Number(rawValue);
    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }
}
