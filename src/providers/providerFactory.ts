import { loadConfig, type AiConfig } from '../security/pathGuard.js';
import { AIProvider, ProviderOptions } from './aiProvider.js';
import { OllamaProvider } from './ollamaProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

export function createAIProvider(config?: AiConfig, fetchImpl?: typeof fetch): AIProvider {
  const aiConfig = config ?? loadConfig().ai;
  const options: ProviderOptions = { config: aiConfig, fetchImpl };

  switch (aiConfig.provider) {
    case 'openai':
      return new OpenAIProvider(options);
    case 'anthropic':
      return new AnthropicProvider(options);
    case 'ollama':
    default:
      return new OllamaProvider(options);
  }
}

export function createDefaultProvider(fetchImpl?: typeof fetch): AIProvider {
  return createAIProvider(undefined, fetchImpl);
}
