import { normalizeAgentAnswer, validateStructuredAnswer } from './answerNormalizer.js';
import {
  AGENT_SYSTEM_PROMPT,
  buildAgentTurnMessage,
  parseAgentModelResponse,
} from '../prompts/agentPrompt.js';
import { loadConfig, validateScanPath } from '../security/pathGuard.js';
import { createAIProvider } from '../providers/providerFactory.js';
import { ProviderError } from '../providers/aiProvider.js';
import { formatAskProviderError } from '../utils/ollamaHelp.js';
import {
  collectBaseEvidence,
  formatEvidenceForPrompt,
  loadProjectEvidence,
  mergeEvidence,
} from './evidenceCollector.js';
import { buildAgentToolContext, listAgentToolSummaries } from './toolRegistry.js';
import { executeToolCall } from './toolRunner.js';
import type {
  AgentOptions,
  AgentResult,
  EvidenceBundle,
  ToolExecutionResult,
} from './types.js';

export const DEFAULT_MAX_AGENT_TURNS = 3;

function extractFileSnippets(results: ToolExecutionResult[]): EvidenceBundle['fileSnippets'] {
  const snippets: EvidenceBundle['fileSnippets'] = [];
  for (const result of results) {
    if (result.tool !== 'read_file' || !result.success) continue;
    const data = result.data as { path?: string; content?: string };
    if (!data.path || !data.content) continue;
    snippets.push({
      file: data.path,
      excerpt: data.content.slice(0, 1200),
    });
  }
  return snippets;
}

function isSecurityQuestion(question: string): boolean {
  return /risk|security|danger|vulner|highest risk|auth|api/i.test(question);
}

async function autoGatherReadTools(
  question: string,
  ctx: ReturnType<typeof buildAgentToolContext>,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  results.push(await executeToolCall({ tool: 'rank_risk_files', input: { limit: 8 } }, ctx));

  if (isSecurityQuestion(question)) {
    const ranked = results[0]?.data as Array<{ file: string }> | undefined;
    const topFile = ranked?.[0]?.file;
    if (topFile) {
      results.push(await executeToolCall({ tool: 'read_file', input: { path: topFile } }, ctx));
    }
  }

  return results;
}

export async function runAgentQuery(options: AgentOptions): Promise<AgentResult> {
  const started = Date.now();
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_AGENT_TURNS;
  const validation = validateScanPath(options.projectPath);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid project path' };
  }

  const loaded = await loadProjectEvidence(validation.absolutePath);
  const toolCtx = buildAgentToolContext(validation.absolutePath, loaded);
  const base = collectBaseEvidence(options.question, loaded.scan, loaded.map, loaded.structure, loaded.context);

  const autoResults = await autoGatherReadTools(options.question, toolCtx);
  let toolResults = [...autoResults];
  let evidence = mergeEvidence(base, toolResults, extractFileSnippets(toolResults));

  const aiConfig = loadConfig().ai;
  const chat =
    options.chatFn ??
    (async (messages) => {
      const provider = createAIProvider(aiConfig, options.fetchImpl);
      const response = await provider.chat({
        messages,
        model: aiConfig.model,
        maxOutputChars: aiConfig.maxOutputChars,
      });
      return { content: response.content, model: response.model, provider: response.provider };
    });

  const tools = listAgentToolSummaries();
  let turnsUsed = 0;
  let pendingOperationsCreated = 0;
  let readToolsAutoRun = autoResults.filter((r) => r.autoExecuted).length;
  let finalAnswer: string | undefined;
  let providerName: string = aiConfig.provider;
  let modelName = aiConfig.model;

  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  try {
    while (turnsUsed < maxTurns) {
      turnsUsed++;
      const evidenceText = formatEvidenceForPrompt(evidence);
      const userMessage = buildAgentTurnMessage({
        question: options.question,
        evidence: evidenceText,
        turn: turnsUsed,
        maxTurns,
        priorMessages: conversation,
      });

      const response = await chat([
        { role: 'system', content: AGENT_SYSTEM_PROMPT(tools) },
        { role: 'user', content: userMessage },
      ]);

      providerName = response.provider;
      modelName = response.model;
      conversation.push({ role: 'assistant', content: response.content });

      const parsed = parseAgentModelResponse(response.content);
      if (!parsed) {
        if (turnsUsed >= maxTurns) {
          finalAnswer = response.content;
          break;
        }
        conversation.push({
          role: 'user',
          content: 'Respond with valid JSON: {"action":"final","answer":"..."} or {"action":"tools","calls":[...]}',
        });
        continue;
      }

      if (parsed.action === 'final') {
        finalAnswer = parsed.answer;
        break;
      }

      const turnResults: ToolExecutionResult[] = [];
      for (const call of parsed.calls.slice(0, 4)) {
        const result = await executeToolCall(call, toolCtx);
        turnResults.push(result);
        if (result.autoExecuted) readToolsAutoRun++;
        if (result.pendingOperationId) pendingOperationsCreated++;
      }

      toolResults = [...toolResults, ...turnResults];
      evidence = mergeEvidence(base, toolResults, extractFileSnippets(toolResults));

      conversation.push({
        role: 'user',
        content: `Tool results:\n${JSON.stringify(turnResults, null, 2)}`,
      });

      if (turnsUsed >= maxTurns) {
        finalAnswer = `Reached max ${maxTurns} turns. Review tool results and evidence above.`;
        break;
      }
    }
  } catch (err) {
    const raw = err instanceof ProviderError || err instanceof Error ? err.message : 'Agent query failed';
    return { success: false, error: formatAskProviderError(raw, aiConfig.model) };
  }

  if (!finalAnswer) {
    return { success: false, error: 'Agent did not produce a final answer' };
  }

  finalAnswer = normalizeAgentAnswer(finalAnswer, {
    question: options.question,
    scan: loaded.scan,
    map: loaded.map,
    structure: loaded.structure,
    context: loaded.context,
    rankedRiskFiles: evidence.rankedRiskFiles,
  });

  if (!validateStructuredAnswer(finalAnswer)) {
    finalAnswer = normalizeAgentAnswer(
      ['## Direct Answer', finalAnswer].join('\n'),
      {
        question: options.question,
        scan: loaded.scan,
        map: loaded.map,
        structure: loaded.structure,
        context: loaded.context,
        rankedRiskFiles: evidence.rankedRiskFiles,
      },
    );
  }

  return {
    success: true,
    answer: finalAnswer,
    evidence,
    metrics: {
      turnsUsed,
      maxTurns,
      toolsExecuted: toolResults.length,
      readToolsAutoRun,
      pendingOperationsCreated,
      evidenceSections: evidence.sectionsIncluded,
      provider: providerName,
      model: modelName,
      totalMs: Date.now() - started,
    },
  };
}

export function formatAgentMetrics(metrics: NonNullable<AgentResult['metrics']>): string {
  return [
    `Turns: ${metrics.turnsUsed}/${metrics.maxTurns}`,
    `Tools: ${metrics.toolsExecuted} (${metrics.readToolsAutoRun} auto-read)`,
    `Pending ops: ${metrics.pendingOperationsCreated}`,
    `Time: ${(metrics.totalMs / 1000).toFixed(1)}s`,
    `Provider: ${metrics.provider} | Model: ${metrics.model}`,
  ].join(' | ');
}
