import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../src/providers/ollamaProvider.js';
import { OLLAMA_NOT_RUNNING_MESSAGE } from '../src/providers/aiProvider.js';
import type { AiConfig } from '../src/security/pathGuard.js';

const aiConfig: AiConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  fallbackModel: 'qwen2.5-coder:3b',
  baseUrl: 'http://localhost:11434',
  timeoutMs: 5000,
  maxContextChars: 60000,
  maxOutputChars: 6000,
};

describe('OllamaProvider', () => {
  it('returns chat response when Ollama is available', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ model: 'qwen2.5-coder:7b', message: { content: 'This is a test project.' } }),
        { status: 200 },
      );
    });

    const provider = new OllamaProvider({ config: aiConfig, fetchImpl });
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.content).toBe('This is a test project.');
    expect(response.provider).toBe('ollama');
  });

  it('shows clear error when Ollama is not running', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const provider = new OllamaProvider({ config: aiConfig, fetchImpl });
    await expect(provider.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      OLLAMA_NOT_RUNNING_MESSAGE,
    );
  });

  it('falls back to secondary model when primary fails', async () => {
    let chatCalls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      chatCalls++;
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === 'qwen2.5-coder:7b') {
        return new Response('model not found', { status: 404 });
      }
      return new Response(
        JSON.stringify({ model: 'qwen2.5-coder:3b', message: { content: 'fallback ok' } }),
        { status: 200 },
      );
    });

    const provider = new OllamaProvider({ config: aiConfig, fetchImpl });
    const response = await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(response.content).toBe('fallback ok');
    expect(chatCalls).toBe(2);
  });
});

describe('providerFactory', () => {
  it('uses openai only when explicitly configured', async () => {
    const { createAIProvider } = await import('../src/providers/providerFactory.js');
    const provider = createAIProvider({
      ...aiConfig,
      provider: 'openai',
    });
    await expect(provider.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      /OpenAI is not configured/,
    );
  });
});
