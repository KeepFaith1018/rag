import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_DOCUMENT_FILE_SIZE } from '../../document/document.constants';

/**
 * 初始化分片上传会话请求参数。
 */
export class InitUploadDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_FILE_SIZE)
  fileSize: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-fA-F0-9]{64}$/)
  fileHash: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_FILE_SIZE)
  chunkSize: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  totalChunks: number;
}
