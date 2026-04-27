import { IsString, IsOptional } from 'class-validator';

export class GetAgentTraceDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  runId?: string;
}

export class GetAgentRunsDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  limit?: number;
}
