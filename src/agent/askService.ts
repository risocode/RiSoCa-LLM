import { buildProjectContext } from '../context/contextBuilder.js';
import { buildQuestionAwareContext } from '../context/promptContext.js';
import { analyzeStructure } from '../analyzer/structuralAnalyzer.js';
import { loadLatestScan, loadProjectMap } from '../memory/projectMemory.js';
import { scanProject } from '../scanner/projectScanner.js';
import { saveScanResult } from '../memory/projectMemory.js';
import { validateScanPath } from '../security/pathGuard.js';
import { loadConfig } from '../security/pathGuard.js';
import { createAIProvider } from '../providers/providerFactory.js';
import { ASK_SYSTEM_PROMPT, buildAskUserMessage } from '../prompts/askPrompt.js';
import { ProviderError } from '../providers/aiProvider.js';
import type { ChatResponse } from '../providers/aiProvider.js';
import type { AskIntent } from '../context/contextSelector.js';
import { logger } from '../utils/logger.js';
import { formatAskProviderError } from '../utils/ollamaHelp.js';

export interface AskMetrics {
  contextChars: number;
  systemPromptChars: number;
  userPromptChars: number;
  estimatedPromptChars: number;
  answerChars: number;
  totalMs: number;
  provider: string;
  model: string;
  intents: AskIntent[];
  sectionsIncluded: string[];
  truncated: boolean;
}

export interface AskResult {
  success: boolean;
  response?: ChatResponse;
  metrics?: AskMetrics;
  error?: string;
}

export interface AskOptions {
  projectPath: string;
  question: string;
  fetchImpl?: typeof fetch;
}

async function loadOrScan(projectPath: string) {
  let scan = loadLatestScan(projectPath);
  let map = loadProjectMap(projectPath);
  if (!scan || !map) {
    const result = await scanProject(projectPath);
    scan = result.scan;
    map = result.projectMap;
    saveScanResult(scan, map);
  }
  return { scan, map };
}

export async function askProject(options: AskOptions): Promise<AskResult> {
  const started = Date.now();
  const validation = validateScanPath(options.projectPath);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid project path' };
  }

  const { scan, map } = await loadOrScan(validation.absolutePath);
  const structure = analyzeStructure(map);
  const context = buildProjectContext(scan, map, structure.circularImports.flat());
  const aiConfig = loadConfig().ai;

  const packed = buildQuestionAwareContext(
    options.question,
    scan,
    map,
    context,
    structure,
    aiConfig,
  );

  logger.info(
    `Context packed: ${packed.contextChars} chars | intents: ${packed.intents.join(', ')} | sections: ${packed.sectionsIncluded.join(', ')}`,
  );

  const systemPrompt = ASK_SYSTEM_PROMPT;
  const userMessage = buildAskUserMessage(options.question, packed.context);
  const provider = createAIProvider(aiConfig, options.fetchImpl);

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      model: aiConfig.model,
      maxOutputChars: aiConfig.maxOutputChars,
    });

    const metrics: AskMetrics = {
      contextChars: packed.contextChars,
      systemPromptChars: systemPrompt.length,
      userPromptChars: userMessage.length,
      estimatedPromptChars: systemPrompt.length + userMessage.length,
      answerChars: response.content.length,
      totalMs: Date.now() - started,
      provider: response.provider,
      model: response.model,
      intents: packed.intents,
      sectionsIncluded: packed.sectionsIncluded,
      truncated: packed.truncated,
    };

    return { success: true, response, metrics };
  } catch (err) {
    const raw = err instanceof ProviderError || err instanceof Error ? err.message : 'Ask failed';
    return { success: false, error: formatAskProviderError(raw, aiConfig.model) };
  }
}

export function formatAskMetrics(metrics: AskMetrics): string {
  return [
    `Context: ${metrics.contextChars} chars${metrics.truncated ? ' (truncated)' : ''}`,
    `Prompt estimate: ${metrics.estimatedPromptChars} chars`,
    `Answer: ${metrics.answerChars} chars`,
    `Time: ${(metrics.totalMs / 1000).toFixed(1)}s`,
    `Provider: ${metrics.provider} | Model: ${metrics.model}`,
    `Intents: ${metrics.intents.join(', ')}`,
    `Sections: ${metrics.sectionsIncluded.join(', ')}`,
  ].join(' | ');
}
