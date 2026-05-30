import type { AiConfig } from '../security/pathGuard.js';
import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  OLLAMA_NOT_RUNNING_MESSAGE,
  ProviderError,
  ProviderOptions,
} from './aiProvider.js';

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
}

export class OllamaProvider implements AIProvider {
  id = 'ollama';
  name = 'Ollama (local)';
  private readonly config: AiConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProviderOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.ensureAvailable();

    const modelsToTry = [
      request.model ?? this.config.model,
      this.config.fallbackModel,
      ...(this.config.availableModels ?? []).filter(
        (m) => m !== this.config.model && m !== this.config.fallbackModel,
      ),
    ];
    const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];

    let lastError: Error | null = null;
    for (const model of uniqueModels) {
      try {
        return await this.chatWithModel(request, model);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Ollama chat failed');
      }
    }
    throw lastError ?? new ProviderError('Ollama chat failed', 'ollama_error');
  }

  private async ensureAvailable(): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await this.fetchImpl(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new ProviderError(OLLAMA_NOT_RUNNING_MESSAGE, 'ollama_unavailable');
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(OLLAMA_NOT_RUNNING_MESSAGE, 'ollama_unavailable');
    }
  }

  private async chatWithModel(request: ChatRequest, model: string): Promise<ChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: request.messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 404 || body.includes('not found')) {
          throw new ProviderError(
            `Ollama model "${model}" is not installed. Run: ollama pull ${model}`,
            'model_not_found',
          );
        }
        throw new ProviderError(`Ollama request failed (${response.status})`, 'ollama_error');
      }

      const data = (await response.json()) as OllamaChatResponse;
      let content = data.message?.content?.trim() ?? '';
      const maxChars = request.maxOutputChars ?? this.config.maxOutputChars;
      if (content.length > maxChars) {
        content = `${content.slice(0, maxChars)}\n...[truncated]`;
      }

      return {
        content,
        model: data.model ?? model,
        provider: this.id,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError('Ollama request timed out', 'ollama_timeout');
      }
      throw new ProviderError(OLLAMA_NOT_RUNNING_MESSAGE, 'ollama_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}
