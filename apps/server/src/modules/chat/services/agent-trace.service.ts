import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Prisma } from '@prisma-client';
import { randomUUID } from 'crypto';

export interface AgentRunContext {
  sessionId: string;
  userId: number;
  userMessageId: string;
  assistantMessageId?: string;
  chatMode: string;
  selectedKbIds: string[];
  resolvedKbIds: string[];
  originalQuery: string;
}

export interface AgentStepRecord {
  agentName: string;
  stepType: string;
  status: 'running' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}

export interface AgentRunSummary {
  runId: string;
  status: string;
  totalTokens: number;
  totalDurationMs: number;
  stepCount: number;
}

/**
 * Agent 运行轨迹持久化服务。
 *
 * 负责将一次完整的 Agent 执行过程（run + steps + tool calls）
 * 记录到 b_agent_runs / b_agent_steps / b_agent_tool_calls 表。
 */
@Injectable()
export class AgentTraceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建一次 Agent Run 记录。
   */
  async createRun(ctx: AgentRunContext): Promise<string> {
    const runId = randomUUID();

    await this.prisma.b_agent_runs.create({
      data: {
        id: runId,
        session_id: ctx.sessionId,
        user_id: BigInt(ctx.userId),
        user_message_id: BigInt(ctx.userMessageId),
        status: 'running',
        chat_mode: ctx.chatMode,
        selected_kb_ids_json: ctx.selectedKbIds,
        resolved_kb_ids_json: ctx.resolvedKbIds,
        created_at: new Date(),
      },
    });

    return runId;
  }

  /**
   * 记录一个 Agent Step 到数据库。
   */
  async recordStep(
    runId: string,
    step: AgentStepRecord,
  ): Promise<bigint> {
    const startedAt = new Date();
    const finishedAt =
      step.status !== 'running' ? new Date() : undefined;

    const record = await this.prisma.b_agent_steps.create({
      data: {
        run_id: runId,
        agent_name: step.agentName,
        step_type: step.stepType,
        status: step.status,
        input_json: (step.input ?? {}) as Prisma.InputJsonValue,
        output_json: (step.output ?? {}) as Prisma.InputJsonValue,
        duration_ms: step.durationMs,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    });

    return record.id;
  }

  /**
   * 完成一次 Agent Run，写入汇总数据。
   */
  async completeRun(
    runId: string,
    summary: { totalTokens: number; totalDurationMs: number },
  ): Promise<void> {
    await this.prisma.b_agent_runs.update({
      where: { id: runId },
      data: {
        status: 'completed',
        total_tokens: summary.totalTokens,
        duration_ms: summary.totalDurationMs,
        finished_at: new Date(),
      },
    });
  }

  /**
   * 标记 Agent Run 为失败。
   */
  async failRun(runId: string): Promise<void> {
    await this.prisma.b_agent_runs.update({
      where: { id: runId },
      data: {
        status: 'failed',
        finished_at: new Date(),
      },
    });
  }

  /**
   * 查询会话的所有 Agent Run 记录。
   */
  async getSessionRuns(sessionId: string, userId: number, limit?: number): Promise<Array<{
    runId: string;
    status: string;
    totalTokens: number;
    durationMs: number;
    chatMode: string;
    selectedKbIds: string[];
    resolvedKbIds: string[];
    createdAt: Date;
    finishedAt: Date | null;
  }>> {
    const runs = await this.prisma.b_agent_runs.findMany({
      where: {
        session_id: sessionId,
        user_id: BigInt(userId),
      },
      orderBy: { created_at: 'desc' },
      take: limit ?? 20,
    });

    return runs.map((run) => ({
      runId: run.id,
      status: run.status ?? '',
      totalTokens: Number(run.total_tokens) || 0,
      durationMs: Number(run.duration_ms) || 0,
      chatMode: run.chat_mode ?? '',
      selectedKbIds: (run.selected_kb_ids_json as string[]) ?? [],
      resolvedKbIds: (run.resolved_kb_ids_json as string[]) ?? [],
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    }));
  }

  /**
   * 查询单个 Run 的完整轨迹（包含 steps）。
   */
  async getRunDetail(runId: string, userId: number): Promise<{
    runId: string;
    status: string;
    totalTokens: number;
    durationMs: number;
    chatMode: string;
    selectedKbIds: string[];
    resolvedKbIds: string[];
    createdAt: Date;
    finishedAt: Date | null;
    steps: Array<{
      stepId: string;
      agentName: string;
      stepType: string;
      status: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      durationMs: number | null;
      startedAt: Date;
      finishedAt: Date | null;
    }>;
  } | null> {
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
      status: run.status ?? '',
      totalTokens: Number(run.total_tokens) || 0,
      durationMs: Number(run.duration_ms) || 0,
      chatMode: run.chat_mode ?? '',
      selectedKbIds: (run.selected_kb_ids_json as string[]) ?? [],
      resolvedKbIds: (run.resolved_kb_ids_json as string[]) ?? [],
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      steps: steps.map((step) => ({
        stepId: step.id.toString(),
        agentName: step.agent_name ?? '',
        stepType: step.step_type ?? '',
        status: step.status ?? '',
        input: (step.input_json as Record<string, unknown>) ?? {},
        output: (step.output_json as Record<string, unknown>) ?? {},
        durationMs: step.duration_ms,
        startedAt: step.started_at,
        finishedAt: step.finished_at,
      })),
    };
  }

  /**
   * 保存运行评估数据到 metadata_json，供离线评估队列使用。
   */
  async saveEvaluationData(
    runId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.b_agent_runs.update({
      where: { id: runId },
      data: {
        metadata_json: data as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 合并写入评估数据（追加字段，不覆盖已有数据）。
   * 用于异步校验完成后追加 factCheckResult / completenessResult。
   */
  async mergeEvaluationData(
    runId: string,
    partial: Record<string, unknown>,
  ): Promise<void> {
    const run = await this.prisma.b_agent_runs.findUnique({
      where: { id: runId },
      select: { metadata_json: true },
    });
    const existing = (run?.metadata_json as Record<string, unknown>) ?? {};
    await this.prisma.b_agent_runs.update({
      where: { id: runId },
      data: {
        metadata_json: { ...existing, ...partial } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 获取用户的使用统计摘要。
   */
  async getMetricsSummary(userId: number): Promise<{
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    successRate: number;
    avgDurationMs: number;
    dailyActiveSessions: number;
  }> {
    const userIdBigInt = BigInt(userId);

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
