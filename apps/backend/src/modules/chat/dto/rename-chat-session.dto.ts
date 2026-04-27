import { IsString, MaxLength } from 'class-validator';

export class RenameChatSessionDto {
  @IsString()
  @MaxLength(100)
  title: string;
}
