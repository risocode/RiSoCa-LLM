import { loadConfig } from '../security/pathGuard.js';

export function formatOllamaNotRunningHelp(model?: string): string {
  const configuredModel = model ?? loadConfig().ai.model;
  return [
    'Ollama is not running.',
    '',
    'Start a second PowerShell and run:',
    '  ollama serve',
    '',
    `Then install the configured model:`,
    `  ollama pull ${configuredModel}`,
  ].join('\n');
}

export function formatMissingModelHelp(model: string): string {
  return [`Ollama model "${model}" is not installed.`, '', 'Run:', `  ollama pull ${model}`].join('\n');
}

export function formatAskProviderError(error: string, model: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('not running') || lower.includes('ollama_unavailable') || lower.includes('econnrefused')) {
    return formatOllamaNotRunningHelp(model);
  }
  if (lower.includes('not installed') || lower.includes('model_not_found') || lower.includes('ollama pull')) {
    const match = error.match(/ollama pull ([^\s"]+)/i) ?? error.match(/model "([^"]+)"/i);
    return formatMissingModelHelp(match?.[1] ?? model);
  }
  return error;
}
