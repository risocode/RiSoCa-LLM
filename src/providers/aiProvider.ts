export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  tokensUsed?: number;
}

export interface AIProvider {
  id: string;
  name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  countTokens?(text: string): number;
}

export class StubAIProvider implements AIProvider {
  id = 'stub';
  name = 'Stub Provider (Phase 1)';

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return {
      content: `[Stub] Received ${request.messages.length} message(s). AI integration planned for Phase 4.`,
      model: 'stub',
      tokensUsed: 0,
    };
  }
}

export function createDefaultProvider(): AIProvider {
  return new StubAIProvider();
}
