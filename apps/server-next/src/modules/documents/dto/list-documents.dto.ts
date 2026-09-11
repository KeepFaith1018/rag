import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListDocumentsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsIn(['processing', 'ready', 'failed', 'deleting', 'deleted'])
  status?: 'processing' | 'ready' | 'failed' | 'deleting' | 'deleted';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
}
