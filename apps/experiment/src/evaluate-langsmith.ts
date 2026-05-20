/**
 * RAG 对比实验 — LangSmith LLM-as-Judge 评估
 *
 * 对 Naïve / Advanced / Agentic 三组 RAG 答案进行多维度评估，
 * 结果写入 LangSmith Dataset + Experiment。
 *
 * 用法: pnpm --filter rag-experiment evaluate
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'langsmith';
import { invoke } from './shared/llm.js';
import { sleep } from './shared/utils.js';
import { env } from './shared/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, '../experiment-results/langsmith-dataset.jsonl');
const OUTPUT_PATH = resolve(__dirname, '../experiment-results/eval-scores.json');

// Judge 模型配置 — 优先使用 LANGSMITH_JUDGE_* 环境变量，回退到百炼轻量模型
const JUDGE_MODEL = env('LANGSMITH_JUDGE_MODEL', env('BAILIAN_LLM_LIGHT_MODEL', 'qwen3.6-flash'));
const JUDGE_API_KEY = env('LANGSMITH_JUDGE_API_KEY', env('BAILIAN_API_KEY'));
const JUDGE_BASE_URL = env('LANGSMITH_JUDGE_BASE_URL', env('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'));

// ── 类型定义 ──────────────────────────────────

interface ExampleRow {
  id: string;
  input: string;
  question_type: string;
  expected_key_points: string[];
  naive_answer: string;
  advanced_answer: string;
  agentic_answer: string;
  metadata: Record<string, unknown>;
}

interface DimensionScores {
  coverage: number;    // 关键点覆盖率
  accuracy: number;    // 事实准确性
  completeness: number; // 信息完整性
  relevance: number;   // 问题相关性
  overall: number;     // 综合评分
  comment: string;
}

interface JudgeResult {
  naive: DimensionScores;
  advanced: DimensionScores;
  agentic: DimensionScores;
}

interface EvalEntry {
  questionId: string;
  question: string;
  questionType: string;
  expectedKeyPoints: string[];
  scores: JudgeResult;
  error?: string;
}

// ── Judge Prompt ─────────────────────────────

const JUDGE_SYSTEM_PROMPT = `你是一个专业的 RAG（检索增强生成）系统评估专家。你需要对三份由不同 RAG 方案生成的答案进行多维度评分。

## 评分维度（每个维度 1-10 分）

1. **关键点覆盖率 (coverage)**：答案覆盖了多少期望关键点
   - 9-10: 覆盖全部关键点，且有合理扩展
   - 5-6: 覆盖了大部分关键点
   - 1-2: 几乎未覆盖任何关键点

2. **事实准确性 (accuracy)**：答案中的事实表述是否准确，有无编造或幻觉
   - 9-10: 所有陈述准确，引用恰当
   - 5-6: 大部分准确，个别模糊表述
   - 1-2: 存在明显事实错误或大量编造

3. **信息完整性 (completeness)**：答案是否提供了充分的解释和细节
   - 9-10: 信息充分，结构清晰，解释到位
   - 5-6: 信息基本完整，但缺少一些重要细节
   - 1-2: 信息严重不足，过于简略

4. **问题相关性 (relevance)**：答案是否直接回应了用户问题
   - 9-10: 精准命中问题核心，无冗余
   - 5-6: 基本相关，但有部分偏离
   - 1-2: 与问题无关或答非所问

5. **综合评分 (overall)**：综合以上维度的整体评价（1-10）
   - 这是你的整体判断，不是前四项的算数平均

## 评分注意事项
- 严格依据提供的期望关键点进行评分
- 对于 fact_lookup 类型，关键点覆盖率权重最高
- 对于 compare_analysis 类型，信息完整性和覆盖率同等重要
- 对于 research_or_open_world 类型，信息完整性和相关性权重最高
- 对于 greeting 类型，只评估相关性，其他维度给 5 分（中立）
- 审视答案中是否有 "根据上下文"、"基于提供的知识库" 等元评论——这些本身不扣分
- 如果答案明确声明知识库信息不足并诚实说明，accuracy 应该给高分而非扣分

## 输出格式
必须严格输出以下 JSON 格式（不要包含任何其他文字）：

{
  "naive": { "coverage": N, "accuracy": N, "completeness": N, "relevance": N, "overall": N, "comment": "简短评语" },
  "advanced": { "coverage": N, "accuracy": N, "completeness": N, "relevance": N, "overall": N, "comment": "简短评语" },
  "agentic": { "coverage": N, "accuracy": N, "completeness": N, "relevance": N, "overall": N, "comment": "简短评语" }
}`;

function buildJudgePrompt(row: ExampleRow): string {
  return `请评估以下三份 RAG 答案。

【问题类型】${row.question_type}
【用户问题】${row.input}
【期望关键点】${row.expected_key_points.join(' | ')}

━━━ 答案A: Naïve RAG ━━━
${row.naive_answer || '(空)'}

━━━ 答案B: Advanced RAG ━━━
${row.advanced_answer || '(空)'}

━━━ 答案C: Agentic RAG ━━━
${row.agentic_answer || '(空)'}

请按 JSON 格式输出三份答案的评分。`;
}

// ── Judge 调用 ────────────────────────────────

async function callJudge(row: ExampleRow): Promise<JudgeResult> {
  const userMessage = buildJudgePrompt(row);
  const raw = await invoke(JUDGE_SYSTEM_PROMPT, userMessage, {
    model: JUDGE_MODEL,
    apiKey: JUDGE_API_KEY,
    baseURL: JUDGE_BASE_URL,
    temperature: 0.1,
    timeout: 120000,
  });
  // 尝试从可能的 markdown 代码块中提取 JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Judge 返回非 JSON 格式: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return parsed as JudgeResult;
}

// ── LangSmith 实时写入 ──────────────────────────

async function writeOneToLangSmith(
  client: Client,
  datasetId: string,
  entry: EvalEntry,
) {
  const examples: Array<{
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    dataset_id: string;
  }> = [];

  for (const approach of ['naive', 'advanced', 'agentic'] as const) {
    const scores = entry.scores[approach];
    examples.push({
      inputs: {
        question_id: entry.questionId,
        question: entry.question,
        question_type: entry.questionType,
        approach,
        expected_key_points: entry.expectedKeyPoints,
      },
      outputs: {
        coverage: scores.coverage,
        accuracy: scores.accuracy,
        completeness: scores.completeness,
        relevance: scores.relevance,
        overall: scores.overall,
        comment: scores.comment,
      },
      dataset_id: datasetId,
    });
  }

  await client.createExamples(examples);
}

// ── 汇总 ──────────────────────────────────────

function printSummary(entries: EvalEntry[]) {
  const valid = entries.filter((e) => !e.error);
  console.log('\n═══════════════════════════════════════════');
  console.log('  LLM-as-Judge 评估汇总');
  console.log('═══════════════════════════════════════════\n');

  const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;

  const computeAvg = (list: EvalEntry[], approach: string, dim: string): number =>
    avg(list.map((e) => {
      const scores = e.scores as unknown as Record<string, Record<string, number>>;
      return scores[approach]?.[dim] ?? 0;
    }));

  const approaches = ['naive', 'advanced', 'agentic'] as const;
  const dims = ['coverage', 'accuracy', 'completeness', 'relevance', 'overall'] as const;

  console.log('| 维度 | Naïve RAG | Advanced RAG | Agentic RAG |');
  console.log('|:---|---:|---:|---:|');
  for (const dim of dims) {
    const vals = approaches.map((a) => computeAvg(entries, a, dim).toFixed(2));
    console.log(`| ${dim} | ${vals.join(' | ')} |`);
  }

  console.log(`\n  有效评估: ${valid.length}/${entries.length}`);
  if (entries.some((e) => e.error)) {
    console.log('  错误:');
    for (const e of entries.filter((e) => e.error)) {
      console.log(`    ${e.questionId}: ${e.error}`);
    }
  }

  // 按问题类型分组
  console.log('\n── 按问题类型分维度 ──');
  const types = Array.from(new Set(entries.map((e) => e.questionType)));
  for (const t of types) {
    const group = entries.filter((e) => e.questionType === t && !e.error);
    if (group.length === 0) continue;
    console.log(`\n  【${t}】(共 ${group.length} 题)`);
    console.log('  | 维度 | Naïve | Advanced | Agentic |');
    console.log('  |:---|---:|---:|---:|');
    for (const dim of ['coverage', 'accuracy', 'overall'] as const) {
      const vals = approaches.map((a) => computeAvg(group, a, dim).toFixed(2));
      console.log(`  | ${dim} | ${vals.join(' | ')} |`);
    }
  }
}

// ── 主流程 ────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  RAG 对比实验 — LLM-as-Judge 评估');
  console.log('═══════════════════════════════════════════\n');

  // 1. 读取数据
  const raw = readFileSync(DATASET_PATH, 'utf-8').trim();
  const lines = raw.split('\n').filter(Boolean);
  const rows: ExampleRow[] = lines.map((l) => JSON.parse(l));
  console.log(`  加载数据: ${rows.length} 个问题\n`);

  // 2. 初始化 LangSmith — 先建 dataset，后逐题追加
  const client = new Client();
  const datasetName = `rag-eval-${Date.now()}`;
  console.log('📊 创建 LangSmith Dataset...');
  const dataset = await client.createDataset(datasetName, {
    description: `RAG 三方案 LLM-as-Judge 评估 — ${new Date().toISOString()}`,
  });
  console.log(`  已创建: ${datasetName} (${dataset.id})\n`);

  // 3. 逐题评估 → 即时写入
  const entries: EvalEntry[] = [];
  const RATE_LIMIT_MS = 3000;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write(`  [${i + 1}/${rows.length}] ${row.id} (${row.question_type})... `);

    try {
      const scores = await callJudge(row);
      const entry: EvalEntry = {
        questionId: row.id,
        question: row.input,
        questionType: row.question_type,
        expectedKeyPoints: row.expected_key_points,
        scores,
      };
      entries.push(entry);

      const o = (a: DimensionScores) => `O:${a.overall}`;
      console.log(`✓ Naïve ${o(scores.naive)} Advanced ${o(scores.advanced)} Agentic ${o(scores.agentic)}`);

      // 即时写入 LangSmith
      await writeOneToLangSmith(client, dataset.id, entry);
      // 即时写入本地文件
      writeFileSync(OUTPUT_PATH, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      const entry: EvalEntry = {
        questionId: row.id,
        question: row.input,
        questionType: row.question_type,
        expectedKeyPoints: row.expected_key_points,
        scores: {} as JudgeResult,
        error: (err as Error).message,
      };
      entries.push(entry);
      console.log(`✗ ${(err as Error).message.slice(0, 80)}`);
      // 即时写入本地文件（含错误状态）
      writeFileSync(OUTPUT_PATH, JSON.stringify(entries, null, 2), 'utf-8');
    }

    // 频控
    if (i < rows.length - 1) await sleep(RATE_LIMIT_MS);
  }

  // 4. 输出汇总
  printSummary(entries);

  console.log(`  LangSmith 数据集: ${datasetName} (${dataset.id})`);
  console.log(`  本地结果: ${OUTPUT_PATH}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
