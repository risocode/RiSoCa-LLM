import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateStructuredAnswer } from '../src/agent/answerNormalizer.js';
import { askProject } from '../src/agent/askService.js';
import { runAgentQuery } from '../src/agent/queryEngine.js';
import { rankFilesByRisk } from '../src/agent/riskRanker.js';
import { analyzeStructure } from '../src/analyzer/structuralAnalyzer.js';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import { scanProject } from '../src/scanner/projectScanner.js';

function createRiskProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-unified-risk-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'risk-test' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{}}', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), 'export function login() {}\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'api.ts'), "import { login } from './auth.js';\nexport const route = '/api';\n", 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'user.ts'), 'export function createUser() {}\n', 'utf-8');
  return dir;
}

const mockRiskAnswer = JSON.stringify({
  action: 'final',
  answer: [
    '## Direct Answer',
    'Highest risk files from the project scan.',
    '## Evidence',
    '',
    '## Risks',
    '- none',
    '## Next Action',
    '- review ranked files',
  ].join('\n'),
});

const mockArchitectureAnswer = JSON.stringify({
  action: 'final',
  answer: [
    '## Direct Answer',
    'This is a single-page application with an empty Frontend layer.',
    '## Evidence',
    '- package.json',
    '## Risks',
    '- none',
    '## Next Action',
    '- review',
    '## Risks',
    '- duplicate',
    '## Next Action',
    '- duplicate',
  ].join('\n'),
});

function mockChatFn(content: string) {
  return vi.fn(async () => ({
    content,
    model: 'mock',
    provider: 'mock',
  }));
}

describe('unified ask/agent pipeline', () => {
  it('askProject delegates to runAgentQuery', async () => {
    const spy = vi.spyOn(await import('../src/agent/queryEngine.js'), 'runAgentQuery');
    spy.mockResolvedValueOnce({
      success: true,
      answer: '## Direct Answer\nok\n\n## Evidence\n- a\n\n## Risks\n- none\n\n## Next Action\n- scan',
      metrics: {
        turnsUsed: 1,
        maxTurns: 3,
        toolsExecuted: 1,
        readToolsAutoRun: 1,
        pendingOperationsCreated: 0,
        evidenceSections: ['header'],
        provider: 'mock',
        model: 'mock',
        totalMs: 10,
      },
    });

    const result = await askProject({
      projectPath: 'tests/fixtures/minimal-project',
      question: 'What does this project do?',
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.answer).toContain('## Direct Answer');
    spy.mockRestore();
  });

  it('ask output is normalized with exactly four sections', async () => {
    const projectRoot = createRiskProject();
    const chatFn = mockChatFn(mockArchitectureAnswer);

    const result = await askProject({
      projectPath: projectRoot,
      question: 'Explain the architecture',
      chatFn,
    });

    expect(result.success).toBe(true);
    expect(validateStructuredAnswer(result.answer!)).toBe(true);
    expect(result.answer!.toLowerCase()).not.toContain('frontend');
    expect(result.answer!.toLowerCase()).not.toContain('single-page application');
    expect(result.answer!.match(/^## Risks$/gm)?.length).toBe(1);
    expect(result.answer!.match(/^## Next Action$/gm)?.length).toBe(1);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('ask and agent produce the same normalized answer for identical input', async () => {
    const projectRoot = createRiskProject();
    const chatFn = mockChatFn(mockRiskAnswer);

    const askResult = await askProject({
      projectPath: projectRoot,
      question: 'What are the highest risk files?',
      chatFn,
    });
    const agentResult = await runAgentQuery({
      projectPath: projectRoot,
      question: 'What are the highest risk files?',
      chatFn,
    });

    expect(askResult.answer).toBe(agentResult.answer);
    expect(askResult.metrics?.turnsUsed).toBe(agentResult.metrics?.turnsUsed);
    expect(askResult.metrics?.toolsExecuted).toBe(agentResult.metrics?.toolsExecuted);
    expect(askResult.metrics?.provider).toBe(agentResult.metrics?.provider);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('risk query ranks source files above config files in evidence', async () => {
    const projectRoot = createRiskProject();
    const { scan, projectMap } = await scanProject(projectRoot);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ranked = rankFilesByRisk(projectMap, structure, context);

    const authIdx = ranked.findIndex((r) => r.file === 'src/auth.ts');
    const pkgIdx = ranked.findIndex((r) => r.file === 'package.json');
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(pkgIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeLessThan(pkgIdx);

    const chatFn = mockChatFn(mockRiskAnswer);
    const result = await askProject({
      projectPath: projectRoot,
      question: 'What are the highest risk files?',
      chatFn,
    });

    const evidenceSection = result.answer!.split('## Evidence')[1]?.split('## Risks')[0] ?? '';
    const authPos = evidenceSection.indexOf('src/auth.ts');
    const apiPos = evidenceSection.indexOf('src/api.ts');
    const userPos = evidenceSection.indexOf('src/user.ts');
    const pkgPos = evidenceSection.indexOf('package.json');
    const tsPos = evidenceSection.indexOf('tsconfig.json');

    expect(authPos).toBeGreaterThanOrEqual(0);
    expect(apiPos).toBeGreaterThanOrEqual(0);
    expect(userPos).toBeGreaterThanOrEqual(0);
    expect(pkgPos).toBeGreaterThanOrEqual(0);
    expect(authPos).toBeLessThan(pkgPos);
    expect(apiPos).toBeLessThan(pkgPos);
    expect(userPos).toBeLessThan(tsPos);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
