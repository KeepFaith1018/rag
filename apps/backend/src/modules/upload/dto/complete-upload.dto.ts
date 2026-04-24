import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * 完成分片上传并触发服务端合并时的请求参数。
 */
export class CompleteUploadDto {
  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-fA-F0-9]{64}$/)
  fileHash?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  totalChunks?: number;
}
