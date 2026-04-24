import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

/**
 * 上传单个文件分片请求参数。
 */
export class UploadChunkDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkIndex: number;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-fA-F0-9]{64}$/)
  chunkHash?: string;
}
