import { PartialType } from '@nestjs/mapped-types';
import { CreateKbDto } from './create-kb.dto';

export class UpdateKbDto extends PartialType(CreateKbDto) {}
