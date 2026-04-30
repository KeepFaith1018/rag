export interface StreamRunContext {
  sessionId: string;
  userId: number;
  userMessageId: string;
  assistantMessageId: string;
  originalQuery: string;
  chatMode: 'chat' | 'rag';
  selectedKbIds: string[];
  resolvedKbIds: string[];
  modelName: string | null;
}
