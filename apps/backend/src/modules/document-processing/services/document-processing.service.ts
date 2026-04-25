import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { FileStorageService } from '@common/storage/file-storage.service';
import { QdrantService } from '@common/vector/qdrant.service';
import { DocumentProcessingJobPayload } from '../interfaces/document-processing-job.interface';
import {
  DOCUMENT_CHUNK_ERROR_CODE,
  DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
  DOCUMENT_EMBEDDING_ERROR_CODE,
  DOCUMENT_PARSE_ERROR_CODE,
  DOCUMENT_PROCESSING_STAGE,
  DOCUMENT_SOURCE_FILE_MISSING_ERROR_CODE,
  DOCUMENT_VECTOR_INDEX_ERROR_CODE,
} from '../constants/document-processing.constants';
import { EmbeddingService } from '../../ai/embedding.service';
import {
  buildDocumentChunkVectorId,
  DocumentChunkService,
} from './document-chunk.service';
import { DocumentProcessingTaskService } from './document-processing-task.service';
import { DocumentParserService } from './document-parser.service';
import { DocumentProcessingStateService } from './document-processing-state.service';

/**
 * 负责文档异步处理主流程编排。
 */
@Injectable()
export class DocumentProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorageService: FileStorageService,
    private readonly documentParserService: DocumentParserService,
    private readonly documentChunkService: DocumentChunkService,
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantService: QdrantService,
    private readonly documentProcessingStateService: DocumentProcessingStateService,
    private readonly documentProcessingTaskService: DocumentProcessingTaskService,
  ) {}

  /**
   * 第二阶段开始执行真实解析和切块流程。
   */
  async processDocument(
    payload: DocumentProcessingJobPayload,
    attempt = 1,
    jobId?: string,
  ) {
    const document = await this.getDocument(payload.documentId);
    if (!document) {
      return;
    }

    if (document.processing_version !== payload.processingVersion) {
      return;
    }

    try {
      await this.documentProcessingStateService.markParsing(
        document.id,
        payload.processingVersion,
      );
      await this.documentProcessingTaskService.startStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.PARSING,
        attempt,
        jobId,
      });

      if (!this.fileStorageService.exists(document.file_path)) {
        throw new BusinessException(ErrorCode.FILE_NOT_FOUND, {
          message: '文档源文件不存在，无法执行解析',
          context: {
            internalErrorCode: DOCUMENT_SOURCE_FILE_MISSING_ERROR_CODE,
            documentId: document.id.toString(),
            filePath: document.file_path,
          },
        });
      }

      const parsed = await this.documentParserService.parseDocument(
        document.file_path,
        document.file_type,
      );
      await this.documentProcessingTaskService.touchStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.PARSING,
        attempt,
      });
      await this.documentProcessingTaskService.completeStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.PARSING,
        attempt,
      });

      if (
        !(await this.isCurrentVersionAndActive(
          document.id,
          payload.processingVersion,
        ))
      ) {
        return;
      }

      await this.documentProcessingStateService.markChunking(
        document.id,
        payload.processingVersion,
      );
      await this.documentProcessingTaskService.startStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        attempt,
        jobId,
      });

      const chunkResult = await this.documentChunkService.createChunks(
        document,
        parsed,
        payload.processingVersion,
      );
      await this.documentProcessingTaskService.touchStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        attempt,
      });

      if (chunkResult.totalChunks === 0) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_FAILED, {
          message: '文档切块结果为空，无法继续向量化',
          context: {
            internalErrorCode: DOCUMENT_CHUNK_ERROR_CODE,
            documentId: document.id.toString(),
          },
        });
      }

      await this.documentProcessingStateService.markChunkingCompleted(
        document.id,
        payload.processingVersion,
        chunkResult.totalTokens,
      );
      await this.documentProcessingTaskService.completeStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.CHUNKING,
        attempt,
      });

      if (
        !(await this.isCurrentVersionAndActive(
          document.id,
          payload.processingVersion,
        ))
      ) {
        return;
      }

      const chunks = await this.documentChunkService.getChunksByDocument(
        document.id,
      );
      await this.documentProcessingStateService.markEmbedding(
        document.id,
        payload.processingVersion,
      );
      await this.documentChunkService.markEmbeddingProcessing(document.id);
      await this.documentProcessingTaskService.startStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.EMBEDDING,
        attempt,
        jobId,
      });

      const embeddingResult = await this.embeddingService.embedDocuments(
        chunks.map((chunk) => chunk.content),
      );
      await this.documentProcessingTaskService.touchStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.EMBEDDING,
        attempt,
      });

      if (embeddingResult.vectors.length !== chunks.length) {
        throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
          message: 'Embedding 返回向量数量与文档分片数量不一致',
          context: {
            internalErrorCode: DOCUMENT_EMBEDDING_ERROR_CODE,
            expectedSize: chunks.length,
            actualSize: embeddingResult.vectors.length,
          },
        });
      }

      if (
        !(await this.isCurrentVersionAndActive(
          document.id,
          payload.processingVersion,
        ))
      ) {
        return;
      }

      await this.qdrantService.upsertChunkVectors(
        chunks.map((chunk, index) => ({
          id:
            chunk.vector_id ||
            buildDocumentChunkVectorId(
              document.id,
              chunk.chunk_index,
              payload.processingVersion,
            ),
          vector: embeddingResult.vectors[index],
          payload: {
            kbId: document.kb_id.toString(),
            docId: document.id.toString(),
            chunkId: chunk.id.toString(),
            chunkIndex: chunk.chunk_index,
            uploaderId: document.uploader_id?.toString(),
            processingVersion: payload.processingVersion,
            pageNo: chunk.page_no,
            title: document.title,
            charStart: chunk.char_start,
            charEnd: chunk.char_end,
          },
        })),
      );

      await this.documentChunkService.markEmbeddingCompleted(document.id);
      await this.documentProcessingTaskService.completeStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: DOCUMENT_PROCESSING_STAGE.EMBEDDING,
        attempt,
      });
      await this.documentProcessingStateService.markReady(
        document.id,
        payload.processingVersion,
      );
    } catch (error) {
      const errorInfo = this.resolveProcessingError(error);
      await this.documentProcessingTaskService.failStageTask({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: errorInfo.stage,
        attempt,
        errorCode: errorInfo.errorCode,
        errorMessage: errorInfo.message,
      });
      if (errorInfo.stage === DOCUMENT_PROCESSING_STAGE.EMBEDDING) {
        await this.documentChunkService.markEmbeddingFailed(document.id);
      }
      await this.documentProcessingStateService.markFailed({
        documentId: document.id,
        processingVersion: payload.processingVersion,
        stage: errorInfo.stage,
        errorCode: errorInfo.errorCode,
        message: errorInfo.message,
        retryCount: attempt,
      });
      throw error;
    }
  }

  /**
   * 根据主键查询待处理文档。
   */
  private async getDocument(documentId: string) {
    return this.prisma.b_documents.findUnique({
      where: {
        id: BigInt(documentId),
      },
    });
  }

  /**
   * 检查当前任务版本是否仍然是文档最新版本。
   */
  private async isCurrentVersionAndActive(
    documentId: bigint,
    processingVersion: number,
  ) {
    const currentDocument = await this.prisma.b_documents.findUnique({
      where: {
        id: documentId,
      },
      select: {
        processing_version: true,
        current_stage: true,
      },
    });

    return (
      currentDocument?.processing_version === processingVersion &&
      currentDocument.current_stage !== DOCUMENT_PROCESSING_STAGE.FAILED
    );
  }

  /**
   * 将异常统一映射为可回写的失败上下文。
   */
  private resolveProcessingError(error: unknown) {
    if (error instanceof BusinessException) {
      const context = error.context as Record<string, unknown> | undefined;
      const internalErrorCode = context?.internalErrorCode;
      const message =
        typeof error.message === 'string' && error.message
          ? error.message
          : '文档处理失败';

      return {
        stage:
          internalErrorCode === DOCUMENT_CHUNK_ERROR_CODE
            ? DOCUMENT_PROCESSING_STAGE.CHUNKING
            : internalErrorCode === DOCUMENT_EMBEDDING_ERROR_CODE ||
                internalErrorCode === DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE ||
                internalErrorCode === DOCUMENT_VECTOR_INDEX_ERROR_CODE
              ? DOCUMENT_PROCESSING_STAGE.EMBEDDING
              : DOCUMENT_PROCESSING_STAGE.PARSING,
        errorCode:
          typeof internalErrorCode === 'string'
            ? internalErrorCode
            : DOCUMENT_PARSE_ERROR_CODE,
        message,
      };
    }

    return {
      stage: DOCUMENT_PROCESSING_STAGE.PARSING,
      errorCode: DOCUMENT_PARSE_ERROR_CODE,
      message: '文档处理失败，请检查服务日志',
    };
  }
}
