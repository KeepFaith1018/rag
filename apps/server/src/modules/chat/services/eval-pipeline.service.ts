import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Prisma } from '@prisma-client';
import { ChatModelService } from '../../rag/ai/chat-model.service';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

interface EvalScores {
  faithfulness?: { score: number; reasoning: string };
  answerRelevancy?: { score: number; reasoning: string };
  contextRecall?: { score: number; reasoning: string };
  error?: string;
}

type EvalData = Record<string, unknown>;

/**
 * 离线评估核心逻辑。
 *
 * 使用轻量模型以 LLM-as-judge 模式对单次对话打分。
 * 评估结果追加到 b_agent_runs.metadata_json。
 */
@Injectable()
export class EvalPipelineService {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger!: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatModelService: ChatModelService,
  ) {}

  async evaluate(runId: string): Promise<EvalScores> {
    const run = await this.prisma.b_agent_runs.findUnique({
      where: { id: runId },
    });

    if (!run?.metadata_json) {
      return { error: '评估数据不存在' };
    }

    const data = run.metadata_json as EvalData;
    const originalQuery = typeof data.originalQuery === 'string' ? data.originalQuery : '';
    const draftAnswer = typeof data.draftAnswer === 'string' ? data.draftAnswer : '';
    const rerankedHits = (data.rerankedHits ?? []) as Array<{ content?: string }>;

    if (!originalQuery || !draftAnswer) {
      return { error: '缺少 originalQuery 或 draftAnswer' };
    }

    const contextText = rerankedHits
      .slice(0, 5)
      .map((h) => h.content?.slice(0, 500) ?? '')
      .join('\n---\n');

    const lightModel = this.chatModelService.createModel({
      model: this.chatModelService.getLightModelName(),
      temperature: 0,
      streaming: false,
      timeout: 15000,
    });

    const scores: EvalScores = {};

    // Faithfulness
    const faithScore = await this.scoreWithLLM(
      lightModel,
      'faithfulness',
      `检索上下文:\n${contextText || '（无检索结果）'}\n\n回答:\n${draftAnswer}`,
    );
    if (faithScore) scores.faithfulness = faithScore;

    // Answer Relevancy
    const relScore = await this.scoreWithLLM(
      lightModel,
      'relevancy',
      `用户问题:\n${originalQuery}\n\n回答:\n${draftAnswer}`,
    );
    if (relScore) scores.answerRelevancy = relScore;

    // Context Recall
    const recallScore = await this.scoreWithLLM(
      lightModel,
      'recall',
      `用户问题:\n${originalQuery}\n\n检索上下文:\n${contextText || '（无检索结果）'}\n\n回答:\n${draftAnswer}`,
    );
    if (recallScore) scores.contextRecall = recallScore;

    // 回写评估结果
    try {
      const updateData: Record<string, unknown> = { ...data };
      updateData['evalMetrics'] = scores;
      updateData['evaluatedAt'] = new Date().toISOString();

      await this.prisma.b_agent_runs.update({
        where: { id: runId },
        data: {
          metadata_json: updateData as Prisma.InputJsonValue,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`[EvalPipeline] 评估结果回写失败: ${String(err)}`);
    }

    return scores;
  }

  private async scoreWithLLM(
    model: ReturnType<ChatModelService['createModel']>,
    type: string,
    context: string,
  ): Promise<{ score: number; reasoning: string } | null> {
    const prompts: Record<string, string> = {
      faithfulness:
        '评估以下回答是否严格基于提供的检索上下文。如果回答中的陈述有上下文支撑则为满分，出现编造或与上下文矛盾则扣分。',
      relevancy:
        '评估以下回答是否切题、完整地回答了用户问题。',
      recall:
        '评估检索上下文是否足以支撑完整回答。如果上下文覆盖了回答中的所有关键信息则为满分，存在明显信息缺失则扣分。',
    };

    const systemPrompt = prompts[type] ?? prompts.faithfulness;

    try {
      const result = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `${context}\n\n请按 JSON 格式输出: { "score": 0-1之间的数字, "reasoning": "1-2句评估理由" }`,
        ),
      ]);

      const text = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as { score?: number; reasoning?: string };
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 0.5,
        reasoning: String(parsed.reasoning ?? ''),
      };
    } catch (err: unknown) {
      this.logger.warn(`[EvalPipeline] ${type} 评估失败: ${String(err)}`);
      return null;
    }
  }
}
