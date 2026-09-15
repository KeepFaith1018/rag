import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { parseId } from '../../../shared/parse-id';
import {
  ProcessingSnapshotSchema,
  type ProcessingSnapshot,
} from '../contracts/schemas';

@Injectable()
export class ProcessingStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(
    kbId: bigint,
    documentId: string,
  ): Promise<ProcessingSnapshot> {
    const document = await this.prisma.b_documents.findFirst({
      where: { id: parseId(documentId), kb_id: kbId },
      include: { desired_run: true, active_run: true },
    });
    if (!document)
      throw new BusinessError(
        ErrorCode.DOCUMENT_NOT_FOUND,
        '文档不存在',
        'not-found',
      );
    const desired = document.desired_run;
    const searchable = document.status === 'ready' && !!document.active_run_id;
    const servingPreviousVersion =
      searchable &&
      !!desired &&
      desired.id !== document.active_run_id &&
      desired.status === 'failed';
    return ProcessingSnapshotSchema.parse({
      schemaVersion: 1,
      documentId: document.id.toString(),
      status: document.status,
      processingStage: stageOf(document.status, desired?.current_stage),
      searchable,
      servingPreviousVersion,
      errorCode: desired?.error_code ?? null,
      errorMessage: desired?.error_message ?? null,
      updatedAt: document.updated_at.toISOString(),
    });
  }
}

function stageOf(status: string, stage?: string) {
  if (status === 'ready') return 'ready';
  if (status === 'failed' || status === 'deleting' || status === 'deleted')
    return 'failed';
  if (stage === 'chunk') return 'chunking';
  if (stage === 'embed') return 'embedding';
  if (stage === 'index' || stage === 'completed') return 'indexing';
  return 'parsing';
}
