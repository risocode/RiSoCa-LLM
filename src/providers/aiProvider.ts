import type { AiConfig } from '../security/pathGuard.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxOutputChars?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed?: number;
}

export interface AIProvider {
  id: string;
  name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface ProviderOptions {
  config: AiConfig;
  fetchImpl?: typeof fetch;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const OLLAMA_NOT_RUNNING_MESSAGE =
  'Ollama is not running. Start it with `ollama serve` and install a model with `ollama pull qwen2.5-coder:7b`.';
