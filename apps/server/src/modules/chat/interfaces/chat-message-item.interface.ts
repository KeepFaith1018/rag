export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references: unknown;
  toolCalls: unknown;
  tokensUsed: number | null;
  messageStatus: string;
  modelName: string | null;
  finishReason: string | null;
  chatMode: string | null;
  selectedKbIds: unknown;
  resolvedKbIds: unknown;
  feedbackType: string | null;
  createdAt: string;
}
