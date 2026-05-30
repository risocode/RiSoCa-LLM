import { AIProvider, ChatRequest, ChatResponse, ProviderError, ProviderOptions } from './aiProvider.js';

export class AnthropicProvider implements AIProvider {
  id = 'anthropic';
  name = 'Anthropic (optional)';

  constructor(_options: ProviderOptions) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        'Anthropic is not configured. Set ANTHROPIC_API_KEY or switch ai.provider to "ollama" in config/default.json.',
        'anthropic_not_configured',
      );
    }

    throw new ProviderError(
      'Anthropic adapter is a stub in Phase 4. Use ai.provider "ollama" for local execution.',
      'anthropic_stub',
    );
  }
}
