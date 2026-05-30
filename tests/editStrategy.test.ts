import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_PLANNER_SYSTEM_PROMPT } from '../src/prompts/workflowPrompt.js';
import { buildEditPreview } from '../src/security/approval.js';
import {
  applyEditStrategy,
  isDocumentationFile,
  normalizeWorkflowPlanEditStrategies,
  resolvePlanEdit,
} from '../src/workflows/editStrategy.js';
import type { WorkflowPlan } from '../src/workflows/workflowTypes.js';

function createDocProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-strategy-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '# RiSoCa\n\n## Setup\n\nnpm run setup\n\n## Usage\n\nnpm run scan\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(dir, 'docs', 'guide.md'),
    '# Guide\n\n## Intro\n\nWelcome.\n',
    'utf-8',
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const value = "original";\n', 'utf-8');
  return dir;
}

describe('editStrategy', () => {
  it('identifies documentation files', () => {
    expect(isDocumentationFile('README.md')).toBe(true);
    expect(isDocumentationFile('docs/guide.md')).toBe(true);
    expect(isDocumentationFile('notes.MD')).toBe(true);
    expect(isDocumentationFile('src/app.ts')).toBe(false);
  });

  it('keeps valid exact edits unchanged', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'README.md',
      search: 'npm run setup',
      replace: 'npm run setup && npm run doctor',
      summary: 'doctor step',
    });
    expect(resolved.success).toBe(true);
    if (resolved.success) {
      expect(resolved.edit.strategy).toBe('exact');
      expect(resolved.edit.warning).toBeUndefined();
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('falls back README invalid search to append section', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'README.md',
      search: 'text that does not exist in file',
      replace: '## Troubleshooting\n\nRun npm run doctor.',
      summary: 'add troubleshooting',
    });
    expect(resolved.success).toBe(true);
    if (resolved.success) {
      expect(resolved.edit.strategy).toBe('append_section');
      expect(resolved.edit.warning).toMatch(/invalid exact edit for README.md/i);
      expect(resolved.edit.warning).toMatch(/append-section/i);
      const original = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
      const preview = applyEditStrategy(original, {
        search: resolved.edit.search,
        replace: resolved.edit.replace,
        editStrategy: resolved.edit.strategy,
      });
      expect(preview).toContain('## Troubleshooting');
      expect(preview).toContain('npm run setup');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('falls back docs invalid search to append section', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'docs/guide.md',
      search: 'missing intro text',
      replace: '## FAQ\n\nSee README.',
      summary: 'add faq',
    });
    expect(resolved.success).toBe(true);
    if (resolved.success) {
      expect(resolved.edit.strategy).toBe('append_section');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('falls back to replace section when heading exists', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'README.md',
      search: 'wrong setup block',
      replace: '## Setup\n\nRequires Node 22.\n\nRun npm run setup.',
      summary: 'clarify setup',
    });
    expect(resolved.success).toBe(true);
    if (resolved.success) {
      expect(resolved.edit.strategy).toBe('replace_section');
      expect(resolved.edit.warning).toMatch(/replace-section/i);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails source files with invalid search safely', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'src/app.ts',
      search: 'missing text',
      replace: 'export const value = "fixed";',
      summary: 'fix value',
    });
    expect(resolved.success).toBe(false);
    if (!resolved.success) {
      expect(resolved.error).toMatch(/invalid exact edit for src\/app.ts/i);
      expect(resolved.error).toMatch(/No safe fallback available/i);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('invalid search does not crash workflow normalization', () => {
    const root = createDocProject();
    const plan: WorkflowPlan = {
      diagnosis: 'docs',
      targetFiles: ['README.md'],
      edits: [
        {
          file: 'README.md',
          search: 'nonexistent',
          replace: '## Notes\n\nExtra info.',
          summary: 'notes',
        },
      ],
      validationCommands: ['npm test'],
    };
    const result = normalizeWorkflowPlanEditStrategies(plan, root);
    expect(result.strategyError).toBeUndefined();
    expect(result.plan.edits[0]?.strategy).toBe('append_section');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('includes one-edit-per-file and no invented search rules in planner prompt', () => {
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('only ONE edit operation');
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('Do not invent exact search strings');
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('append-section or replace-section');
  });
});

describe('edit preview strategy', () => {
  it('shows fallback strategy in pending preview', () => {
    const root = createDocProject();
    const resolved = resolvePlanEdit(root, {
      file: 'README.md',
      search: 'missing',
      replace: '## Extra\n\nMore setup help.',
      summary: 'help',
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) return;

    const preview = buildEditPreview(root, 'README.md', resolved.edit.search, resolved.edit.replace, {
      editStrategy: resolved.edit.strategy,
      sectionHeading: resolved.edit.sectionHeading,
      fallbackNote: resolved.edit.warning,
    });
    expect(preview.summary).toMatch(/append-section/i);
    expect(preview.summary).toMatch(/invalid exact edit/i);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf-8')).toContain('npm run setup');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
