import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class ConfirmPartDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replaceAll('"', '') : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  etag!: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  checksumSha256?: string;
}
