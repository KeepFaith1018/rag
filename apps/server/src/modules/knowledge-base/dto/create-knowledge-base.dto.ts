import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const KNOWLEDGE_BASE_VISIBILITIES = ['private', 'shared'] as const;

/**
 * 创建知识库请求参数。
 */
export class CreateKnowledgeBaseDto {
  @IsString()
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsIn(KNOWLEDGE_BASE_VISIBILITIES)
  visibility: (typeof KNOWLEDGE_BASE_VISIBILITIES)[number];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPublicDownload?: boolean;
}
