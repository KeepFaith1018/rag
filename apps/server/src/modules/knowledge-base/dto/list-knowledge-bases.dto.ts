import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const KNOWLEDGE_BASE_OWNERSHIPS = ['owned', 'joined', 'all'] as const;
const KNOWLEDGE_BASE_VISIBILITIES = ['private', 'shared'] as const;
const PUBLIC_KNOWLEDGE_BASE_SORTS = ['latest', 'hot'] as const;

/**
 * 我的知识库列表查询参数。
 */
export class ListKnowledgeBasesDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_BASE_OWNERSHIPS)
  ownership?: (typeof KNOWLEDGE_BASE_OWNERSHIPS)[number] = 'all';

  @IsOptional()
  @IsIn(KNOWLEDGE_BASE_VISIBILITIES)
  visibility?: (typeof KNOWLEDGE_BASE_VISIBILITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

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

/**
 * 公开知识库列表查询参数。
 */
export class ListPublicKnowledgeBasesDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

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

  @IsOptional()
  @IsIn(PUBLIC_KNOWLEDGE_BASE_SORTS)
  sortBy?: (typeof PUBLIC_KNOWLEDGE_BASE_SORTS)[number] = 'latest';
}
