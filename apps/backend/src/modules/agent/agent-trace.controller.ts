import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@common/guards/auth.guard';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AgentTraceService, AgentRunSummary } from './services/agent-trace.service';
import { PrismaService } from '@common/prisma/prisma.service';

@Controller('agent')
@UseGuards(AuthGuard)
export class AgentTraceController {
  constructor(
    private readonly traceService: AgentTraceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 查询会话的所有 Agent Run 记录。
   */
  @Get('sessions/:sessionId/runs')
  async getSessionRuns(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const runs = await this.prisma.b_agent_runs.findMany({
      where: {
        session_id: sessionId,
        user_id: BigInt(userId),
      },
      orderBy: { created_at: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
    });

    return runs.map((run) => ({
      runId: run.id,
      status: run.status,
      totalTokens: run.total_tokens ?? 0,
      durationMs: run.duration_ms ?? 0,
      chatMode: run.chat_mode,
      selectedKbIds: run.selected_kb_ids_json,
      resolvedKbIds: run.resolved_kb_ids_json,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    }));
  }

  /**
   * 查询单个 Run 的完整轨迹（包含 steps）。
   */
  @Get('runs/:runId')
  async getRunDetail(
    @CurrentUser('sub') userId: string,
    @Param('runId') runId: string,
  ) {
    const run = await this.prisma.b_agent_runs.findFirst({
      where: {
        id: runId,
        user_id: BigInt(userId),
      },
    });

    if (!run) {
      return null;
    }

    const steps = await this.prisma.b_agent_steps.findMany({
      where: { run_id: runId },
      orderBy: { started_at: 'asc' },
    });

    return {
      runId: run.id,
      status: run.status,
      totalTokens: run.total_tokens ?? 0,
      durationMs: run.duration_ms ?? 0,
      chatMode: run.chat_mode,
      selectedKbIds: run.selected_kb_ids_json,
      resolvedKbIds: run.resolved_kb_ids_json,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      steps: steps.map((step) => ({
        stepId: step.id.toString(),
        agentName: step.agent_name,
        stepType: step.step_type,
        status: step.status,
        input: step.input_json,
        output: step.output_json,
        durationMs: step.duration_ms,
        startedAt: step.started_at,
        finishedAt: step.finished_at,
      })),
    };
  }

  /**
   * 获取用户的使用统计摘要。
   */
  @Get('metrics/summary')
  async getMetricsSummary(
    @CurrentUser('sub') userId: string,
  ) {
    const userIdBigInt = BigInt(userId);

    // 统计总 run 数、成功率、平均耗时
    const [totalRuns, completedRuns, failedRuns, avgDuration] = await Promise.all([
      this.prisma.b_agent_runs.count({
        where: { user_id: userIdBigInt },
      }),
      this.prisma.b_agent_runs.count({
        where: { user_id: userIdBigInt, status: 'completed' },
      }),
      this.prisma.b_agent_runs.count({
        where: { user_id: userIdBigInt, status: 'failed' },
      }),
      this.prisma.b_agent_runs.aggregate({
        where: { user_id: userIdBigInt, status: 'completed' },
        _avg: { duration_ms: true },
      }),
    ]);

    // 统计近 7 天的日活跃数
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyActiveCount = await this.prisma.b_agent_runs.groupBy({
      by: ['session_id'],
      where: {
        user_id: userIdBigInt,
        created_at: { gte: sevenDaysAgo },
      },
    });

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      successRate: totalRuns > 0 ? completedRuns / totalRuns : 0,
      avgDurationMs: avgDuration._avg.duration_ms ?? 0,
      dailyActiveSessions: dailyActiveCount.length,
    };
  }
}
