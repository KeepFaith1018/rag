import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class InitUploadDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mimeType!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-f0-9]{64}$/)
  clientSha256!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;
}
