import { Injectable } from '@nestjs/common';

export interface TraceStep {
  stepName: string;
  status: 'started' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  errorMessage?: string;
}

export interface RetrievalTrace {
  traceId: string;
  sessionId: string;
  steps: TraceStep[];
  startedAt: Date;
  finishedAt?: Date;
  totalDurationMs?: number;
}

/**
 * 检索轨迹记录服务。
 *
 * 提供内存级轻量记录能力，用于后续排障回放与性能观测。
 * 后续阶段可扩展为持久化到 b_agent_steps 表。
 */
@Injectable()
export class RetrievalTraceService {
  private traces = new Map<string, RetrievalTrace>();

  /**
   * 创建一条检索轨迹。
   */
  createTrace(traceId: string, sessionId: string): RetrievalTrace {
    const trace: RetrievalTrace = {
      traceId,
      sessionId,
      steps: [],
      startedAt: new Date(),
    };
    this.traces.set(traceId, trace);
    return trace;
  }

  /**
   * 向轨迹添加步骤记录。
   */
  addStep(
    traceId: string,
    step: TraceStep,
  ): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;
    trace.steps.push(step);
  }

  /**
   * 完成轨迹记录。
   */
  finishTrace(traceId: string): RetrievalTrace | undefined {
    const trace = this.traces.get(traceId);
    if (!trace) return undefined;
    trace.finishedAt = new Date();
    trace.totalDurationMs =
      trace.finishedAt.getTime() - trace.startedAt.getTime();
    return trace;
  }

  /**
   * 获取轨迹记录。
   */
  getTrace(traceId: string): RetrievalTrace | undefined {
    return this.traces.get(traceId);
  }
}
