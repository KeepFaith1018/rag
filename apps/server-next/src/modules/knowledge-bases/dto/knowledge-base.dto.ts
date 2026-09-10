import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  KnowledgeBaseMemberRole,
  KnowledgeBaseVisibility,
} from '../contracts/knowledge-base-access';

const VISIBILITIES = ['private', 'collaborative', 'public'] as const;
const ROLES = ['manager', 'collaborator', 'member'] as const;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** 创建知识库的输入契约。 */
export class CreateKnowledgeBaseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(VISIBILITIES)
  visibility!: KnowledgeBaseVisibility;

  @IsOptional()
  @IsBoolean()
  allowPublicDownload?: boolean;
}

/** 更新知识库的部分字段输入契约。 */
export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: KnowledgeBaseVisibility;

  @IsOptional()
  @IsBoolean()
  allowPublicDownload?: boolean;
}

/** 当前用户知识库列表的筛选、分页与排序参数。 */
export class ListKnowledgeBasesDto {
  @IsOptional()
  @IsIn(['owned', 'joined', 'all'])
  ownership: 'owned' | 'joined' | 'all' = 'all';

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: KnowledgeBaseVisibility;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

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

  @IsOptional()
  @IsIn(['updated_desc', 'updated_asc', 'documents_desc', 'name_asc'])
  sortBy: 'updated_desc' | 'updated_asc' | 'documents_desc' | 'name_asc' =
    'updated_desc';
}

/** 公开知识库发现页的筛选、分页与排序参数。 */
export class ListPublicKnowledgeBasesDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

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

  @IsOptional()
  @IsIn(['latest', 'hot'])
  sortBy: 'latest' | 'hot' = 'latest';
}

/** 创建单次邀请链接的角色与有效期。 */
export class CreateInvitationDto {
  @IsOptional()
  @IsIn(ROLES)
  role: KnowledgeBaseMemberRole = 'member';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  expiredInHours = 72;
}

/** 通过邀请代码加入协作知识库的输入契约。 */
export class JoinKnowledgeBaseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  inviteCode!: string;
}

/** 调整已有知识库成员角色的输入契约。 */
export class UpdateMemberRoleDto {
  @IsIn(ROLES)
  role!: KnowledgeBaseMemberRole;
}
