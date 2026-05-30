import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuestionAwareContext } from '../src/context/promptContext.js';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import { analyzeStructure } from '../src/analyzer/structuralAnalyzer.js';
import { scanProject } from '../src/scanner/projectScanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

describe('promptContext', () => {
  it('builds compact context without env content', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap, structure.circularImports.flat());
    const packed = buildQuestionAwareContext(
      'What does this project do?',
      scan,
      projectMap,
      context,
      structure,
      {
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        fallbackModel: 'qwen2.5-coder:3b',
        availableModels: ['qwen2.5-coder:7b'],
        baseUrl: 'http://localhost:11434',
        timeoutMs: 120000,
        maxContextChars: 12000,
        maxOutputChars: 2000,
        contextLimits: {},
      },
    );

    expect(packed.context).toContain('minimal-project');
    expect(packed.context.toLowerCase()).not.toContain('secret=');
    expect(packed.context).not.toContain('.env');
  });

  it('truncates context to max chars', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const packed = buildQuestionAwareContext(
      'What does this project do?',
      scan,
      projectMap,
      context,
      structure,
      {
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        fallbackModel: 'qwen2.5-coder:3b',
        availableModels: [],
        baseUrl: 'http://localhost:11434',
        timeoutMs: 120000,
        maxContextChars: 200,
        maxOutputChars: 2000,
        contextLimits: {},
      },
    );
    expect(packed.contextChars).toBeLessThanOrEqual(200);
    expect(packed.truncated).toBe(true);
  });
});
