import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
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
        input_json: (step.input ?? {}) as any,
        output_json: (step.output ?? {}) as any,
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
}
