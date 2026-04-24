import { IsString, Length } from 'class-validator';

/**
 * 通过邀请码加入知识库请求参数。
 */
export class JoinKbDto {
  @IsString()
  @Length(8, 64)
  inviteCode: string;
}
