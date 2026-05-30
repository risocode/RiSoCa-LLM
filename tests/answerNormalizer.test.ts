import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeStructure } from '../src/analyzer/structuralAnalyzer.js';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import {
  countAnswerSections,
  normalizeAgentAnswer,
  parseAnswerSections,
  validateStructuredAnswer,
} from '../src/agent/answerNormalizer.js';
import { rankFilesByRisk } from '../src/agent/riskRanker.js';
import { scanProject } from '../src/scanner/projectScanner.js';

function createArchitectureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-normalizer-arch-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'arch-test' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), "export function login() {}\n", 'utf-8');
  fs.writeFileSync(
    path.join(dir, 'src', 'api.ts'),
    "import { login } from './auth.js';\nexport function register() { return login(); }\n",
    'utf-8',
  );
  return dir;
}

async function buildContext(projectRoot: string, question: string) {
  const { scan, projectMap } = await scanProject(projectRoot);
  const structure = analyzeStructure(projectMap);
  const context = buildProjectContext(scan, projectMap);
  return {
    question,
    scan,
    map: projectMap,
    structure,
    context,
    rankedRiskFiles: rankFilesByRisk(projectMap, structure, context),
  };
}

describe('answer normalizer', () => {
  it('removes frontend hallucinations when no frontend evidence exists', async () => {
    const projectRoot = createArchitectureProject();
    const ctx = await buildContext(projectRoot, 'Explain the architecture');

    const normalized = normalizeAgentAnswer(
      [
        '## Direct Answer',
        'This is a single-page application with a Frontend layer that is currently empty.',
        '',
        '## Evidence Files',
        '- package.json',
        '',
        '## Risks',
        '- none',
        '',
        '## Next Action',
        '- scan again',
        '',
        '## Risks',
        '- duplicate risk',
        '',
        '## Next Action',
        '- duplicate action',
      ].join('\n'),
      ctx,
    );

    expect(normalized.toLowerCase()).not.toContain('single-page application');
    expect(normalized.toLowerCase()).not.toContain('frontend');
    expect(validateStructuredAnswer(normalized)).toBe(true);
    expect(countAnswerSections(normalized)).toBe(4);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('deduplicates Risks and Next Action sections', async () => {
    const projectRoot = createArchitectureProject();
    const ctx = await buildContext(projectRoot, 'What technical debt exists?');

    const normalized = normalizeAgentAnswer(
      [
        '## Direct Answer',
        'Some debt exists.',
        '## Risks',
        '- circular imports',
        '## Next Action',
        '- fix imports',
        '## Risks',
        '- circular imports',
        '## Next Action',
        '- fix imports',
        '## Evidence',
        '- src/api.ts',
      ].join('\n'),
      ctx,
    );

    expect(countAnswerSections(normalized)).toBe(4);
    expect(normalized.match(/^## Risks$/gm)?.length).toBe(1);
    expect(normalized.match(/^## Next Action$/gm)?.length).toBe(1);
    expect(validateStructuredAnswer(normalized)).toBe(true);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reframes fan-in/fan-out as coupling risk only', async () => {
    const projectRoot = createArchitectureProject();
    const ctx = await buildContext(projectRoot, 'What technical debt exists?');

    const normalized = normalizeAgentAnswer(
      [
        '## Direct Answer',
        'High fan-in in src/auth.ts indicates code duplication and over-engineering.',
        '## Evidence',
        '- src/auth.ts',
        '## Risks',
        '- coupling',
        '## Next Action',
        '- review imports',
      ].join('\n'),
      ctx,
    );

    expect(normalized.toLowerCase()).not.toContain('duplication');
    expect(normalized.toLowerCase()).not.toContain('over-engineering');
    expect(normalized.toLowerCase()).toMatch(/coupling|coordination complexity/);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('adds architecture facts from scanned files and imports', async () => {
    const projectRoot = createArchitectureProject();
    const ctx = await buildContext(projectRoot, 'Explain the architecture');

    const normalized = normalizeAgentAnswer(
      [
        '## Direct Answer',
        'Small TypeScript project.',
        '## Evidence',
        '- src/api.ts imports auth',
        '## Risks',
        '- none',
        '## Next Action',
        '- read src/api.ts',
      ].join('\n'),
      ctx,
    );

    expect(normalized).toContain('src/api.ts');
    expect(normalized).toMatch(/No framework detected|Framework:/i);
    expect(parseAnswerSections(normalized)[0]?.content).toMatch(/src\/(auth|api)\.ts/i);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('always outputs exactly four ordered sections', async () => {
    const projectRoot = createArchitectureProject();
    const ctx = await buildContext(projectRoot, 'Explain the architecture');

    const normalized = normalizeAgentAnswer('Plain answer without headings.', ctx);

    expect(validateStructuredAnswer(normalized)).toBe(true);
    expect(parseAnswerSections(normalized).map((s) => s.heading)).toEqual([
      'Direct Answer',
      'Evidence',
      'Risks',
      'Next Action',
    ]);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
