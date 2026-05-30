import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_PLANNER_SYSTEM_PROMPT } from '../src/prompts/workflowPrompt.js';
import {
  applyMergedEditPreview,
  normalizeWorkflowPlanEdits,
} from '../src/workflows/planEditMerger.js';
import { validateWorkflowPlan } from '../src/workflows/workflowEngine.js';
import type { WorkflowPlan } from '../src/workflows/workflowTypes.js';
import { DEFAULT_WORKFLOW_LIMITS } from '../src/workflows/workflowTypes.js';

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-merge-'));
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '# RiSoCa\n\n## Setup\n\nnpm run setup\n\n## Usage\n\nnpm run scan\n',
    'utf-8',
  );
  return dir;
}

describe('planEditMerger', () => {
  it('merges multiple README.md edits into one operation', () => {
    const projectRoot = createTempProject();
    const original = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');
    const plan: WorkflowPlan = {
      diagnosis: 'Improve README',
      targetFiles: ['README.md'],
      edits: [
        {
          file: 'README.md',
          search: '## Setup',
          replace: '## Setup\n\nRequires Node 22.',
          summary: 'Clarify setup',
        },
        {
          file: 'README.md',
          search: '## Usage',
          replace: '## Usage\n\nRun scan and analyze.',
          summary: 'Clarify usage',
        },
      ],
      validationCommands: ['npm test'],
    };

    const result = normalizeWorkflowPlanEdits(plan, projectRoot);
    expect(result.mergeError).toBeUndefined();
    expect(result.plan.edits).toHaveLength(1);
    expect(result.mergedFiles).toEqual([{ file: 'README.md', count: 2 }]);
    expect(result.plan.notes).toContain('Merged 2 planned edits into one operation');

    const merged = applyMergedEditPreview(original, result.plan.edits[0]!);
    expect(merged).toContain('Requires Node 22.');
    expect(merged).toContain('Run scan and analyze.');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('preserves all intended changes in merged operation', () => {
    const projectRoot = createTempProject();
    const original = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');
    const plan: WorkflowPlan = {
      diagnosis: 'docs',
      targetFiles: ['README.md'],
      edits: [
        { file: 'README.md', search: '# RiSoCa', replace: '# RiSoCa Agent', summary: 'title' },
        { file: 'README.md', search: 'npm run setup', replace: 'npm run setup && npm run doctor', summary: 'doctor' },
      ],
      validationCommands: [],
    };
    const result = normalizeWorkflowPlanEdits(plan, projectRoot);
    const preview = applyMergedEditPreview(original, result.plan.edits[0]!);
    expect(preview).toContain('# RiSoCa Agent');
    expect(preview).toContain('npm run doctor');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fails unsafe repeated edits with duplicated file paths', () => {
    const projectRoot = createTempProject();
    const plan: WorkflowPlan = {
      diagnosis: 'bad',
      targetFiles: ['README.md'],
      edits: [
        { file: 'README.md', search: 'missing-text', replace: 'x', summary: '1' },
        { file: 'README.md', search: '## Usage', replace: 'y', summary: '2' },
      ],
      validationCommands: [],
    };
    const result = normalizeWorkflowPlanEdits(plan, projectRoot);
    expect(result.mergeError).toMatch(/Cannot merge/i);
    expect(result.mergeError).toMatch(/README.md/);
    expect(result.mergeError).toMatch(/narrower request/i);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('passes validation after merge', () => {
    const projectRoot = createTempProject();
    const plan: WorkflowPlan = {
      diagnosis: 'docs',
      targetFiles: ['README.md'],
      edits: [
        { file: 'README.md', search: '## Setup', replace: '## Setup\n\nMore detail.', summary: 'a' },
        { file: 'README.md', search: '## Usage', replace: '## Usage\n\nMore usage.', summary: 'b' },
      ],
      validationCommands: ['npm test'],
    };
    const merged = normalizeWorkflowPlanEdits(plan, projectRoot);
    expect(validateWorkflowPlan(merged.plan, projectRoot, DEFAULT_WORKFLOW_LIMITS)).toBeNull();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('includes one-edit-per-file rule in planner prompt', () => {
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('only ONE edit operation');
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('README');
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toContain('same file');
  });
});
