import { AIProvider, ChatRequest, ChatResponse, ProviderError, ProviderOptions } from './aiProvider.js';

export class OpenAIProvider implements AIProvider {
  id = 'openai';
  name = 'OpenAI (optional)';

  constructor(_options: ProviderOptions) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        'OpenAI is not configured. Set OPENAI_API_KEY or switch ai.provider to "ollama" in config/default.json.',
        'openai_not_configured',
      );
    }

    throw new ProviderError(
      'OpenAI adapter is a stub in Phase 4. Use ai.provider "ollama" for local execution.',
      'openai_stub',
    );
  }
}
