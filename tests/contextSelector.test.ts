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
import { formatAskMetrics } from '../src/agent/askService.js';

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
  it('collects performance metrics', () => {
    const metrics = formatAskMetrics({
      contextChars: 1800,
      systemPromptChars: 400,
      userPromptChars: 2000,
      estimatedPromptChars: 2400,
      answerChars: 320,
      totalMs: 3500,
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      intents: ['overview'],
      sectionsIncluded: ['summary', 'stack'],
      truncated: false,
    });
    expect(metrics).toContain('1800 chars');
    expect(metrics).toContain('3.5s');
    expect(metrics).toContain('qwen2.5-coder:7b');
  });

  it('validates structured answer format', () => {
    const good = `## Direct Answer\nIt is an Express app.\n## Evidence Files\n- src/index.ts\n## Risks\nNone\n## Next Action\nRun tests`;
    expect(validateStructuredAnswer(good)).toBe(true);
    expect(validateStructuredAnswer('plain text')).toBe(false);
  });
});

describe('askService', () => {
  it('answers using mocked Ollama provider with metrics', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          model: 'qwen2.5-coder:7b',
          message: {
            content:
              '## Direct Answer\nMinimal Express fixture.\n## Evidence Files\n- src/index.ts\n## Risks\nNone\n## Next Action\nRun npm test',
          },
        }),
        { status: 200 },
      );
    });

    const { askProject } = await import('../src/agent/askService.js');
    const result = await askProject({
      projectPath: FIXTURE,
      question: 'What does this project do?',
      fetchImpl,
    });

    expect(result.success).toBe(true);
    expect(result.metrics?.contextChars).toBeLessThanOrEqual(testAiConfig.maxContextChars + 500);
    expect(result.metrics?.estimatedPromptChars).toBeGreaterThan(0);
    expect(result.metrics?.totalMs).toBeGreaterThanOrEqual(0);
  });
});
