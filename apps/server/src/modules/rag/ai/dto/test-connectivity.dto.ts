import { IsString, IsOptional } from 'class-validator';

/**
 * 模型连通性测试请求 DTO。
 */
export class TestConnectivityDto {
  @IsString()
  provider: string;

  @IsString()
  modelName: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  apiKey: string;
}
