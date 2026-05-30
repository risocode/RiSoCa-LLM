import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../src/database/schema.js';
import { resetDatabase, setDatabaseInstance } from '../src/database/db.js';
import { WORKFLOW_PLANNER_SYSTEM_PROMPT } from '../src/prompts/workflowPrompt.js';
import { approveOperation } from '../src/security/approval.js';
import {
  formatOperationPreviewDetail,
  previewOperationById,
} from '../src/security/operationPreview.js';
import { editFileTool } from '../src/tools/editFileTool.js';
import { buildUnifiedDiff } from '../src/utils/unifiedDiff.js';
import { normalizeWorkflowPlanEditStrategies } from '../src/workflows/editStrategy.js';
import {
  extractUserSpecifiedText,
  normalizeMarkdownEditContent,
  validateMarkdownEditContent,
} from '../src/workflows/markdownEditQuality.js';
import type { WorkflowPlan } from '../src/workflows/workflowTypes.js';

function createProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-md-quality-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'risoca-ai-agent' }),
    'utf-8',
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# Title\n\n## Setup\n\nExisting content.\n', 'utf-8');
  return dir;
}

describe('markdownEditQuality', () => {
  it('rejects literal \\n in markdown content', () => {
    const result = validateMarkdownEditContent('RiSoCa-AI-Agent POGI\\n');
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/literal escape/i);
  });

  it('rejects added by ai placeholder text', () => {
    const result = validateMarkdownEditContent('RiSoCa POGI\n- line added by the ai');
    expect(result.valid).toBe(false);
  });

  it('preserves exact requested text for clean line append', () => {
    const request = 'Add RiSoCa POGI as a clean final markdown line in README.md';
    const normalized = normalizeMarkdownEditContent('RiSoCa-AI-Agent POGI\\n', {
      userRequest: request,
      userText: extractUserSpecifiedText(request),
      projectNames: ['risoca-ai-agent', 'RiSoCa-AI-Agent'],
      strategy: 'append_section',
    });
    expect(normalized.error).toBeUndefined();
    expect(normalized.content).toBe('RiSoCa POGI');
  });

  it('rejects unwanted project name prefix', () => {
    const request = 'Add RiSoCa POGI as a clean final markdown line in README.md';
    const result = validateMarkdownEditContent('RiSoCa-AI-Agent POGI', {
      userRequest: request,
      userText: 'RiSoCa POGI',
      projectNames: ['risoca-ai-agent', 'RiSoCa-AI-Agent'],
      strategy: 'append_section',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/project name/i);
  });

  it('normalizes README append to clean markdown line', () => {
    const root = createProject();
    const request = 'Add RiSoCa POGI as a clean final markdown line in README.md';
    const plan: WorkflowPlan = {
      diagnosis: 'append line',
      targetFiles: ['README.md'],
      edits: [
        {
          file: 'README.md',
          search: 'missing',
          replace: 'RiSoCa-AI-Agent POGI\\n',
          summary: 'append pogi',
        },
      ],
      validationCommands: ['npm test'],
    };

    const result = normalizeWorkflowPlanEditStrategies(plan, root, { userRequest: request });
    expect(result.strategyError).toBeUndefined();
    expect(result.plan.edits[0]?.replace).toBe('RiSoCa POGI');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('includes markdown quality rules in planner prompt', () => {
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toMatch(/literal escape sequences/i);
    expect(WORKFLOW_PLANNER_SYSTEM_PROMPT).toMatch(/Preserve user-requested text exactly/i);
  });
});

describe('preview-operation', () => {
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(() => {
    projectRoot = createProject();
    db = new Database(':memory:');
    initializeSchema(db);
    setDatabaseInstance(db);
  });

  afterEach(() => {
    resetDatabase();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('shows clean unified diff for markdown append', () => {
    const request = 'Add RiSoCa POGI as a clean final markdown line in README.md';
    const userText = extractUserSpecifiedText(request)!;
    const pending = editFileTool(projectRoot, 'README.md', fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8'), userText, {
      editStrategy: 'append_section',
      userRequestedText: userText,
    });
    expect(pending.success).toBe(true);

    const preview = previewOperationById(pending.operationId!);
    expect(preview.success).toBe(true);
    if (!preview.success) return;

    expect(preview.preview.after.trimEnd().endsWith('RiSoCa POGI')).toBe(true);
    expect(preview.preview.unifiedDiff).toContain('+RiSoCa POGI');
    expect(preview.preview.unifiedDiff).not.toContain('\\n');
    expect(formatOperationPreviewDetail(preview.preview)).toContain('Unified diff:');
  });

  it('rejects approving markdown with literal \\n', () => {
    const bad = editFileTool(projectRoot, 'README.md', 'Existing content.', 'Bad line\\n', {
      editStrategy: 'exact',
    });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/literal escape|Markdown edit quality/i);
  });

  it('does not write README before approval', () => {
    const request = 'Add RiSoCa POGI as a clean final markdown line in README.md';
    const userText = extractUserSpecifiedText(request)!;
    const before = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');
    const pending = editFileTool(projectRoot, 'README.md', before, userText, {
      editStrategy: 'append_section',
      userRequestedText: userText,
    });
    expect(pending.success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8')).toBe(before);

    const approved = approveOperation(pending.operationId!);
    expect(approved.success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8')).toContain('RiSoCa POGI');
  });
});

describe('unifiedDiff', () => {
  it('builds append diff lines', () => {
    const diff = buildUnifiedDiff('line1\n', 'line1\nRiSoCa POGI\n', 'README.md');
    expect(diff).toContain('--- a/README.md');
    expect(diff).toContain('+RiSoCa POGI');
  });
});
