import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const KNOWLEDGE_BASE_MEMBER_ROLES = [
  'manager',
  'collaborator',
  'member',
] as const;

/**
 * 创建知识库邀请请求参数。
 */
export class CreateKbInvitationDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_BASE_MEMBER_ROLES)
  role?: (typeof KNOWLEDGE_BASE_MEMBER_ROLES)[number] = 'member';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  expiredInHours?: number = 72;
}
