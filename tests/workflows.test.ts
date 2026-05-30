import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../src/database/schema.js';
import { closeDatabase, resetDatabase, setDatabaseInstance } from '../src/database/db.js';
import { getWorkflowById } from '../src/database/workflowOperations.js';
import { clearAuditLogForTests, readAuditEvents } from '../src/security/auditLog.js';
import { parseWorkflowPlanJson } from '../src/prompts/workflowPrompt.js';
import {
  cancelWorkflow,
  getWorkflowDetails,
  runFixWorkflow,
  runRefactorWorkflow,
  startWorkflow,
  validateWorkflowPlan,
} from '../src/workflows/workflowEngine.js';
import { normalizeWorkflowPlanValidation, formatCommandProjectPath } from '../src/workflows/validationCommands.js';
import { normalizeWorkflowPlanEdits } from '../src/workflows/planEditMerger.js';
import type { PlanGenerator, WorkflowPlan } from '../src/workflows/workflowTypes.js';
import { DEFAULT_WORKFLOW_LIMITS } from '../src/workflows/workflowTypes.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-workflow-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'wf-test', scripts: { test: 'node -e "process.exit(0)"' } }),
    'utf-8',
  );
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const value = "original";\n');
  return dir;
}

const validationOnlyPlan: WorkflowPlan = {
  diagnosis: 'Run validation to inspect project health',
  targetFiles: ['src/app.ts'],
  edits: [],
  validationCommands: ['npm test', 'npm run build'],
};

const editPlan: WorkflowPlan = {
  diagnosis: 'Rename exported value',
  targetFiles: ['src/app.ts'],
  edits: [
    {
      file: 'src/app.ts',
      search: 'export const value = "original";',
      replace: 'export const value = "fixed";',
      summary: 'Update constant value',
    },
  ],
  validationCommands: ['npm test'],
};

const tooManyStepsPlan: WorkflowPlan = {
  diagnosis: 'too many',
  targetFiles: [],
  edits: [],
  validationCommands: ['npm test', 'npm run build', 'npm run analyze -- .', 'npm test', 'npm run build'],
};

function mockPlanner(plan: WorkflowPlan): PlanGenerator {
  return vi.fn(async () => plan);
}

describe('workflow planning', () => {
  it('parses planner JSON', () => {
    const plan = parseWorkflowPlanJson(`\`\`\`json
${JSON.stringify(validationOnlyPlan)}
\`\`\``);
    expect(plan?.diagnosis).toBe(validationOnlyPlan.diagnosis);
  });

  it('rejects plans exceeding max steps', () => {
    const error = validateWorkflowPlan(tooManyStepsPlan, '.', { ...DEFAULT_WORKFLOW_LIMITS, maxSteps: 3 });
    expect(error).toMatch(/max steps/i);
  });

  it('fails unsafe repeated edits when merge is not possible', () => {
    const root = createTempProject();
    const unsafePlan: WorkflowPlan = {
      diagnosis: 'bad plan',
      targetFiles: ['src/app.ts'],
      edits: [
        { file: 'src/app.ts', search: 'missing-marker', replace: 'x', summary: '1' },
        { file: 'src/app.ts', search: 'original', replace: 'fixed', summary: '2' },
      ],
      validationCommands: [],
    };
    const error = normalizeWorkflowPlanEdits(unsafePlan, root).mergeError;
    expect(error).toMatch(/Cannot merge/i);
    expect(error).toMatch(/src\/app.ts/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('normalizes incomplete validation commands before planning', () => {
    const normalized = normalizeWorkflowPlanValidation(
      {
        diagnosis: 'validate',
        targetFiles: [],
        edits: [],
        validationCommands: ['npm run analyze --'],
      },
      '.',
    );
    expect(normalized.validationCommands).toEqual(['npm run analyze -- .']);
    expect(validateWorkflowPlan(normalized, '.')).toBeNull();
  });
});

describe('workflow engine', () => {
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    projectRoot = createTempProject();
    db = new Database(':memory:');
    initializeSchema(db);
    setDatabaseInstance(db);
    clearAuditLogForTests();
    const { scanProject } = await import('../src/scanner/projectScanner.js');
    const { saveScanResult } = await import('../src/memory/projectMemory.js');
    const { scan, projectMap } = await scanProject(projectRoot);
    saveScanResult(scan, projectMap);
  });

  afterEach(() => {
    resetDatabase();
    clearAuditLogForTests();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates fix workflow with mocked AI plan', async () => {
    const result = await runFixWorkflow(projectRoot, 'example issue', {
      planGenerator: mockPlanner(validationOnlyPlan),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.status).toBe('awaiting_approval');
    expect(result.workflow?.plan?.diagnosis).toBe(validationOnlyPlan.diagnosis);
  });

  it('creates refactor workflow with mocked AI plan', async () => {
    const result = await runRefactorWorkflow(projectRoot, 'rename constant', {
      planGenerator: mockPlanner(editPlan),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.type).toBe('refactor');
    expect(result.workflow?.steps.some((s) => s.kind === 'edit_file')).toBe(true);
  });

  it('links file and command operations without executing them', async () => {
    const result = await startWorkflow({
      projectPath: projectRoot,
      type: 'fix',
      userRequest: 'fix value',
      planGenerator: mockPlanner(editPlan),
    });
    expect(result.success).toBe(true);
    const wf = result.workflow!;
    expect(wf.linkedOperationIds.length).toBe(2);
    expect(wf.steps.every((s) => s.status === 'pending_approval')).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.ts'), 'utf-8')).toContain('original');
  });

  it('requires approval before edits are applied', async () => {
    const result = await startWorkflow({
      projectPath: projectRoot,
      type: 'fix',
      userRequest: 'fix',
      planGenerator: mockPlanner(editPlan),
    });
    const step = result.workflow!.steps.find((s) => s.kind === 'edit_file');
    expect(step?.linkedOperationId).toBeDefined();
    const op = db.prepare('SELECT status FROM file_operations WHERE id = ?').get(step!.linkedOperationId!) as
      | { status: string }
      | undefined;
    expect(op?.status).toBe('pending');
  });

  it('proposes validation commands through command approval system', async () => {
    const result = await startWorkflow({
      projectPath: projectRoot,
      type: 'test',
      userRequest: 'validate',
      planGenerator: mockPlanner(validationOnlyPlan),
    });
    const cmdStep = result.workflow!.steps.find((s) => s.kind === 'validation');
    expect(cmdStep?.linkedOperationId).toBeDefined();
    const op = db
      .prepare('SELECT status FROM command_operations WHERE id = ?')
      .get(cmdStep!.linkedOperationId!) as { status: string } | undefined;
    expect(op?.status).toBe('pending');
  });

  it('cancels workflow', async () => {
    const created = await runFixWorkflow(projectRoot, 'cancel me', {
      planGenerator: mockPlanner(validationOnlyPlan),
    });
    const cancelled = cancelWorkflow(created.workflow!.id);
    expect(cancelled.success).toBe(true);
    expect(cancelled.workflow?.status).toBe('cancelled');
  });

  it('persists and reloads workflow from sqlite', async () => {
    const created = await runFixWorkflow(projectRoot, 'persist', {
      planGenerator: mockPlanner(validationOnlyPlan),
    });
    const reloaded = getWorkflowDetails(created.workflow!.id);
    expect(reloaded?.steps.length).toBeGreaterThan(0);
    expect(getWorkflowById(db, created.workflow!.id)?.status).toBe('awaiting_approval');
  });

  it('audits workflow actions', async () => {
    const created = await runFixWorkflow(projectRoot, 'audit', {
      planGenerator: mockPlanner(validationOnlyPlan),
    });
    const events = readAuditEvents(50)
      .filter((e) => e.operationId === created.workflow!.id)
      .map((e) => e.event);
    expect(events).toContain('workflow_created');
    expect(events).toContain('workflow_planned');
    expect(events).toContain('workflow_awaiting_approval');
  });

  it('works against minimal fixture with validation-only plan', async () => {
    const result = await runFixWorkflow(FIXTURE, 'inspect health', {
      planGenerator: mockPlanner({
        ...validationOnlyPlan,
        validationCommands: ['npm run analyze -- .'],
      }),
    });
    expect(result.success).toBe(true);
  });

  it('fix workflow creates valid validation command operations from incomplete AI output', async () => {
    const result = await runFixWorkflow(projectRoot, 'fix readme', {
      planGenerator: mockPlanner({
        diagnosis: 'Improve docs',
        targetFiles: ['README.md'],
        edits: [],
        validationCommands: ['npm run analyze --', 'npm test'],
      }),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.status).toBe('awaiting_approval');
    const cmdStep = result.workflow!.steps.find((s) => s.kind === 'validation');
    expect(cmdStep?.target).toBe(`npm run analyze -- ${formatCommandProjectPath(projectRoot)}`);
  });

  it('merges multiple README edits into one pending operation', async () => {
    const readme = path.join(projectRoot, 'README.md');
    fs.writeFileSync(readme, '# Title\n\n## Setup\n\nOld setup text\n');
    const result = await runFixWorkflow(projectRoot, 'improve readme', {
      planGenerator: mockPlanner({
        diagnosis: 'Improve README clarity',
        targetFiles: ['README.md'],
        edits: [
          { file: 'README.md', search: '## Setup', replace: '## Setup\n\nRequires Node 22.', summary: 'setup' },
          { file: 'README.md', search: 'Old setup text', replace: 'Run npm run setup first.', summary: 'steps' },
        ],
        validationCommands: ['npm test'],
      }),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.status).toBe('awaiting_approval');
    const editSteps = result.workflow!.steps.filter((s) => s.kind === 'edit_file');
    expect(editSteps).toHaveLength(1);
    expect(editSteps[0]?.target).toBe('README.md');
    expect(fs.readFileSync(readme, 'utf-8')).toContain('Old setup text');
  });

  it('converts invalid README search to pending append-section edit', async () => {
    const readme = path.join(projectRoot, 'README.md');
    fs.writeFileSync(readme, '# Title\n\n## Setup\n\nOld setup text\n');
    const result = await runFixWorkflow(projectRoot, 'improve readme', {
      planGenerator: mockPlanner({
        diagnosis: 'Improve README clarity',
        targetFiles: ['README.md'],
        edits: [
          {
            file: 'README.md',
            search: 'invented text not in file',
            replace: '## Troubleshooting\n\nRun npm run doctor.',
            summary: 'add troubleshooting',
          },
        ],
        validationCommands: ['npm test'],
      }),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.status).toBe('awaiting_approval');
    const editStep = result.workflow!.steps.find((s) => s.kind === 'edit_file');
    expect(editStep?.payload.strategy).toBe('append_section');
    expect(String(editStep?.result?.warning)).toMatch(/append-section/i);
    expect(fs.readFileSync(readme, 'utf-8')).toContain('Old setup text');
  });

  it('normalizes bad README append to exact user-requested clean line', async () => {
    const readme = path.join(projectRoot, 'README.md');
    fs.writeFileSync(readme, '# Title\n\n## Setup\n\nExisting content.\n');
    const result = await runFixWorkflow(projectRoot, 'Add RiSoCa POGI as a clean final markdown line in README.md', {
      planGenerator: mockPlanner({
        diagnosis: 'Append clean line',
        targetFiles: ['README.md'],
        edits: [
          {
            file: 'README.md',
            search: 'missing text',
            replace: 'RiSoCa-AI-Agent POGI\\n',
            summary: 'append pogi',
          },
        ],
        validationCommands: ['npm test'],
      }),
    });
    expect(result.success).toBe(true);
    expect(result.workflow?.status).toBe('awaiting_approval');
    const editStep = result.workflow!.steps.find((s) => s.kind === 'edit_file');
    expect(editStep?.payload.replace).toBe('RiSoCa POGI');
    expect(editStep?.payload.userRequestedText).toBe('RiSoCa POGI');
    expect(String(editStep?.payload.replace)).not.toContain('\\n');
    expect(fs.readFileSync(readme, 'utf-8')).not.toContain('RiSoCa POGI');
  });

  it('fails safely when source file search is invalid', async () => {
    const result = await runFixWorkflow(projectRoot, 'fix app constant', {
      planGenerator: mockPlanner({
        diagnosis: 'Fix export',
        targetFiles: ['src/app.ts'],
        edits: [
          {
            file: 'src/app.ts',
            search: 'text that is not in the file',
            replace: 'export const value = "fixed";',
            summary: 'fix',
          },
        ],
        validationCommands: ['npm test'],
      }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No safe fallback available/i);
    expect(result.workflow?.status).toBe('failed');
  });

  it('refactor workflow creates valid validation command operations', async () => {
    const result = await runRefactorWorkflow(projectRoot, 'refactor', {
      planGenerator: mockPlanner({
        ...editPlan,
        validationCommands: ['npm run scan --', 'npm run build'],
      }),
    });
    expect(result.success).toBe(true);
    const commands = result.workflow!.steps.filter((s) => s.kind === 'validation' || s.kind === 'command').map((s) => s.target);
    expect(commands).toContain(`npm run scan -- ${formatCommandProjectPath(projectRoot)}`);
    expect(commands).toContain('npm run build');
  });
});
