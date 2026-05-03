import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AgentTraceService } from './agent-trace.service';

/**
 * Agent 轨迹查询接口控制器。
 */
@Controller('agent')
@UseGuards(AuthGuard)
@Auth()
export class AgentTraceController {
  constructor(private readonly traceService: AgentTraceService) {}

  /**
   * 查询会话的所有 Agent Run 记录。
   */
  @Get('sessions/:sessionId/runs')
  getSessionRuns(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    return this.traceService.getSessionRuns(
      sessionId,
      Number(userId),
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /**
   * 查询单个 Run 的完整轨迹（包含 steps）。
   */
  @Get('runs/:runId')
  getRunDetail(
    @CurrentUser('sub') userId: string,
    @Param('runId') runId: string,
  ) {
    return this.traceService.getRunDetail(runId, Number(userId));
  }

  /**
   * 获取用户的使用统计摘要。
   */
  @Get('metrics/summary')
  getMetricsSummary(@CurrentUser('sub') userId: string) {
    return this.traceService.getMetricsSummary(Number(userId));
  }
}