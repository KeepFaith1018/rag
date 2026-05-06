import { IsOptional, IsInt, Min, Max, IsString, IsBoolean, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListModelConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  @IsIn(['chat', 'embedding'])
  type?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : undefined))
  @IsBoolean()
  isActive?: boolean;
}
