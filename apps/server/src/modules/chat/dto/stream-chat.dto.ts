import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  MaxLength,
  IsObject,
} from 'class-validator';

export class StreamChatDto {
  @IsString()
  sessionId: string;

  @IsString()
  @IsIn(['chat', 'rag'])
  chatMode: 'chat' | 'rag';

  @IsString()
  @MaxLength(10000)
  message: string;

  @IsOptional()
  @IsString()
  @IsIn(['system', 'user'])
  modelSource?: string;

  @IsOptional()
  @IsString()
  modelConfigId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedKbIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
