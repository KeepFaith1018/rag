import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { DOCUMENT_PROCESSING_STAGE } from '../document-processing.constants';

/**
 * 负责统一回写文档异步处理相关状态。
 */
@Injectable()
export class DocumentProcessingStateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在任务成功入队后，将文档状态推进到 queued。
   */
  async markQueued(documentId: bigint, processingVersion: number) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.QUEUED,
        current_stage: DOCUMENT_PROCESSING_STAGE.QUEUED,
        error_msg: null,
        last_error_stage: null,
        last_error_code: null,
        retry_count: 0,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在真实消费开始时将文档推进到 parsing。
   */
  async markParsing(documentId: bigint, processingVersion: number) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.PARSING,
        current_stage: DOCUMENT_PROCESSING_STAGE.PARSING,
        parse_started_at: new Date(),
        error_msg: null,
        last_error_stage: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在进入切块阶段时推进文档状态。
   */
  async markChunking(documentId: bigint, processingVersion: number) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        current_stage: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 第二阶段切块完成后回写统计数据，并保持在 chunking 阶段等待后续向量化接力。
   */
  async markChunkingCompleted(
    documentId: bigint,
    processingVersion: number,
    totalTokens: number,
  ) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        current_stage: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        token_count: totalTokens,
        parse_finished_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在进入向量化阶段时推进文档状态。
   */
  async markEmbedding(documentId: bigint, processingVersion: number) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.EMBEDDING,
        current_stage: DOCUMENT_PROCESSING_STAGE.EMBEDDING,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在向量入库完成后将文档标记为 ready。
   */
  async markReady(documentId: bigint, processingVersion: number) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.READY,
        current_stage: DOCUMENT_PROCESSING_STAGE.READY,
        error_msg: null,
        last_error_stage: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在重解析触发前重置文档处理状态，并递增版本号。
   */
  async resetForReparse(documentId: bigint, nextProcessingVersion: number) {
    await this.prisma.b_documents.update({
      where: {
        id: documentId,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.UPLOADED,
        processing_version: nextProcessingVersion,
        current_stage: DOCUMENT_PROCESSING_STAGE.UPLOADED,
        error_msg: null,
        token_count: 0,
        parse_started_at: null,
        parse_finished_at: null,
        last_error_stage: null,
        retry_count: 0,
        last_error_code: null,
        last_reparse_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在入队失败时回写错误上下文，便于后续人工重试和排障。
   */
  async markQueueEnqueueFailed(
    documentId: bigint,
    processingVersion: number,
    errorCode: string,
    message: string,
  ) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: documentId,
        processing_version: processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.UPLOADED,
        current_stage: DOCUMENT_PROCESSING_STAGE.UPLOADED,
        last_error_stage: DOCUMENT_PROCESSING_STAGE.QUEUED,
        last_error_code: errorCode,
        error_msg: message,
        updated_at: new Date(),
      },
    });
  }

  /**
   * 在解析或切块失败时统一回写失败上下文。
   */
  async markFailed(options: {
    documentId: bigint;
    processingVersion: number;
    stage: string;
    errorCode: string;
    message: string;
    retryCount: number;
  }) {
    await this.prisma.b_documents.updateMany({
      where: {
        id: options.documentId,
        processing_version: options.processingVersion,
      },
      data: {
        status: DOCUMENT_PROCESSING_STAGE.FAILED,
        current_stage: DOCUMENT_PROCESSING_STAGE.FAILED,
        last_error_stage: options.stage,
        last_error_code: options.errorCode,
        error_msg: options.message,
        retry_count: options.retryCount,
        parse_finished_at: new Date(),
        updated_at: new Date(),
      },
    });
  }
}
