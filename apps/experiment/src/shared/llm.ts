/**
 * LLM 调用封装。
 * 从 ChatModelService 简化，去 NestJS 依赖。
 */
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { env } from './env.js';

export interface ModelOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  timeout?: number;
}

/** 创建 ChatOpenAI 实例 */
export function createModel(options: ModelOptions = {}): ChatOpenAI {
  return new ChatOpenAI({
    model: options.model || env('BAILIAN_LLM_MODEL', 'qwen3.6-plus'),
    apiKey: options.apiKey || env('BAILIAN_API_KEY'),
    configuration: {
      baseURL: options.baseURL || env('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    },
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens,
    streaming: options.streaming ?? true,
    timeout: options.timeout ?? 60000,
  });
}

export function getDefaultModel(): string {
  return env('BAILIAN_LLM_MODEL', 'qwen3.6-plus');
}

export function getLightModel(): string {
  return env('BAILIAN_LLM_LIGHT_MODEL', 'qwen3.6-flash');
}

/** 流式生成，返回完整文本 */
export async function streamGenerate(
  systemPrompt: string,
  userQuestion: string,
  options: ModelOptions = {},
): Promise<string> {
  const model = createModel({ ...options, streaming: true });
  const stream = await model.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(userQuestion),
  ]);
  let answer = '';
  for await (const chunk of stream) {
    const content = chunk.content;
    if (typeof content === 'string') {
      answer += content;
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === 'object' && c !== null && 'text' in c) {
          answer += (c as { text: string }).text;
        }
      }
    }
  }
  return answer;
}

/** 非流式调用，返回文本 */
export async function invoke(
  systemPrompt: string,
  userMessage: string,
  options: ModelOptions = {},
): Promise<string> {
  const model = createModel({ ...options, streaming: false });
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ]);
  const content = response.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : ''))
      .join('');
  }
  return '';
}
