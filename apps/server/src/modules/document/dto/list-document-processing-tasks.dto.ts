import {
  IsIn,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

const DOCUMENT_PROCESSING_TASK_STATUSES = [
  'running',
  'completed',
  'failed',
  'timed_out',
] as const;

const DOCUMENT_PROCESSING_TASK_STAGES = [
  'queued',
  'parsing',
  'chunking',
  'embedding',
  'ready',
  'failed',
] as const;

/**
 * 文档处理任务列表查询参数。
 */
export class ListDocumentProcessingTasksDto {
  @IsOptional()
  @IsIn(DOCUMENT_PROCESSING_TASK_STATUSES)
  status?: (typeof DOCUMENT_PROCESSING_TASK_STATUSES)[number];

  @IsOptional()
  @IsIn(DOCUMENT_PROCESSING_TASK_STAGES)
  stage?: (typeof DOCUMENT_PROCESSING_TASK_STAGES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  processingVersion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 10;
}
