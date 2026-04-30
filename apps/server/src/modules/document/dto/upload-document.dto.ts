import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 上传知识库文档时附带的表单字段。
 */
export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
