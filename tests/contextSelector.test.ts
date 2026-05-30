import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildOptimizedPromptContext,
  detectAskIntents,
  rankFilesByImportance,
} from '../src/context/contextSelector.js';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import { analyzeStructure } from '../src/analyzer/structuralAnalyzer.js';
import { scanProject } from '../src/scanner/projectScanner.js';
import type { AiConfig } from '../src/security/pathGuard.js';
import { validateStructuredAnswer } from '../src/prompts/askPrompt.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

const testAiConfig: AiConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  fallbackModel: 'qwen2.5-coder:3b',
  availableModels: ['qwen2.5-coder:7b', 'qwen2.5-coder:3b', 'qwen3.6'],
  baseUrl: 'http://localhost:11434',
  timeoutMs: 120000,
  maxContextChars: 3000,
  maxOutputChars: 2000,
  contextLimits: {
    maxRankedFiles: 8,
    maxSymbols: 10,
    maxRoutes: 5,
    maxImportEdges: 8,
    maxRisks: 4,
    maxDependencies: 5,
    maxCircularImports: 2,
  },
};

describe('contextSelector', () => {
  it('detects question intents', () => {
    expect(detectAskIntents('What does this project do?')).toContain('overview');
    expect(detectAskIntents('What are the highest risk files?')).toContain('security');
    expect(detectAskIntents('What are the highest risk files?')).toContain('files');
    expect(detectAskIntents('Show API routes')).toContain('routes');
  });

  it('packs context within maxContextChars', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const packed = buildOptimizedPromptContext(
      'What does this project do?',
      scan,
      projectMap,
      context,
      structure,
      testAiConfig,
    );

    expect(packed.contextChars).toBeLessThanOrEqual(testAiConfig.maxContextChars);
    expect(packed.context).not.toContain('secret=');
    expect(packed.rankedFiles.length).toBeLessThanOrEqual(8);
  });

  it('excludes irrelevant sections for route questions', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const packed = buildOptimizedPromptContext(
      'List API routes only',
      scan,
      projectMap,
      context,
      structure,
      testAiConfig,
    );

    expect(packed.sectionsIncluded).toContain('routes');
    expect(packed.sectionsIncluded).not.toContain('schemas');
    expect(packed.context).not.toMatch(/## Dependencies/);
  });

  it('prioritizes risk files for security questions', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ranked = rankFilesByImportance(
      'What are the highest risk files?',
      context,
      projectMap,
      structure,
      5,
    );
    expect(ranked.length).toBeGreaterThan(0);
  });
});

describe('askService metrics', () => {
  it('collects performance metrics', async () => {
    const { formatAgentMetrics } = await import('../src/agent/queryEngine.js');
    const metrics = formatAgentMetrics({
      turnsUsed: 1,
      maxTurns: 3,
      toolsExecuted: 2,
      readToolsAutoRun: 2,
      pendingOperationsCreated: 0,
      evidenceSections: ['summary', 'stack'],
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      totalMs: 3500,
    });
    expect(metrics).toContain('Turns: 1/3');
    expect(metrics).toContain('Tools: 2');
    expect(metrics).toContain('3.5s');
    expect(metrics).toContain('qwen2.5-coder:7b');
  });

  it('validates structured answer format', () => {
    const good = `## Direct Answer\nIt is an Express app.\n## Evidence\n- src/index.ts\n## Risks\nNone\n## Next Action\nRun tests`;
    expect(validateStructuredAnswer(good)).toBe(true);
    expect(validateStructuredAnswer('plain text')).toBe(false);
  });
});

describe('askService', () => {
  it('answers using the unified agent query pipeline', async () => {
    const chatFn = vi.fn(async () => ({
      content: JSON.stringify({
        action: 'final',
        answer:
          '## Direct Answer\nMinimal Express fixture.\n## Evidence\n- src/index.ts\n## Risks\nNone\n## Next Action\nRun npm test',
      }),
      model: 'mock',
      provider: 'mock',
    }));

    const { askProject } = await import('../src/agent/askService.js');
    const result = await askProject({
      projectPath: FIXTURE,
      question: 'What does this project do?',
      chatFn,
    });

    expect(result.success).toBe(true);
    expect(validateStructuredAnswer(result.answer!)).toBe(true);
    expect(result.metrics?.toolsExecuted).toBeGreaterThan(0);
    expect(result.metrics?.turnsUsed).toBeGreaterThan(0);
  });
});
