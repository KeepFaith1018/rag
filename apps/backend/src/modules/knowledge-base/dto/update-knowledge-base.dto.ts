import { PartialType } from '@nestjs/mapped-types';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto';

/**
 * 更新知识库请求参数。
 */
export class UpdateKnowledgeBaseDto extends PartialType(CreateKnowledgeBaseDto) {}
