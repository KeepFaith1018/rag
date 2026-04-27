import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
