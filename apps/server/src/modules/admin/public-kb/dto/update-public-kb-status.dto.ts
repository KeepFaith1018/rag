import { IsString, IsIn } from 'class-validator';

export class UpdatePublicKbStatusDto {
  @IsString()
  @IsIn(['normal', 'blocked'])
  status: 'normal' | 'blocked';
}
