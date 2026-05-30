import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../src/database/schema.js';
import { resetDatabase, setDatabaseInstance } from '../src/database/db.js';
import { getOperationById } from '../src/database/fileOperations.js';
import { analyzeStructure } from '../src/analyzer/structuralAnalyzer.js';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import { validateStructuredAnswer } from '../src/prompts/askPrompt.js';
import { parseAgentModelResponse } from '../src/prompts/agentPrompt.js';
import { scanProject } from '../src/scanner/projectScanner.js';
import { clearAuditLogForTests, readAuditEvents } from '../src/security/auditLog.js';
import { rankFilesByRisk } from '../src/agent/riskRanker.js';
import {
  buildAgentToolContext,
  ensureAgentToolsRegistered,
  getAgentTool,
  listAgentTools,
  resetAgentToolsForTests,
} from '../src/agent/toolRegistry.js';
import { executeToolCall, validateToolInput } from '../src/agent/toolRunner.js';
import { DEFAULT_MAX_AGENT_TURNS, runAgentQuery } from '../src/agent/queryEngine.js';
import { getSnapshotsDir } from '../src/utils/paths.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

function createRiskProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-agent-risk-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'risk-test' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{}}', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), 'export function login() {}\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'api.ts'), "export const route = '/api';\n", 'utf-8');
  return dir;
}

describe('agent tool registry', () => {
  it('registers core tools and blocks unknown tools', async () => {
    ensureAgentToolsRegistered();
    expect(getAgentTool('read_file')).toBeDefined();
    expect(getAgentTool('propose_edit')).toBeDefined();
    expect(listAgentTools().length).toBeGreaterThanOrEqual(9);

    const { scan, projectMap } = await scanProject(FIXTURE);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ctx = buildAgentToolContext(FIXTURE, { scan, map: projectMap, structure, context });

    const blocked = await executeToolCall({ tool: 'unknown_tool', input: {} }, ctx);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/Unknown tool/i);
  });

  it('validates required parameters', () => {
    const tool = getAgentTool('read_file')!;
    expect(validateToolInput(tool, {})).toMatch(/Missing required parameter/);
    expect(validateToolInput(tool, { path: 'src/index.ts' })).toBeNull();
  });
});

describe('agent tool runner permissions', () => {
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    resetAgentToolsForTests();
    clearAuditLogForTests();
    projectRoot = createRiskProject();
    db = new Database(':memory:');
    initializeSchema(db);
    setDatabaseInstance(db);
    fs.mkdirSync(getSnapshotsDir(), { recursive: true });
    await scanProject(projectRoot);
  });

  afterEach(() => {
    resetDatabase();
    clearAuditLogForTests();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('auto-runs read-only tools', async () => {
    const { scan, projectMap } = await scanProject(projectRoot);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ctx = buildAgentToolContext(projectRoot, { scan, map: projectMap, structure, context });

    const result = await executeToolCall({ tool: 'read_file', input: { path: 'src/auth.ts' } }, ctx);
    expect(result.success).toBe(true);
    expect(result.autoExecuted).toBe(true);
    expect((result.data as { content?: string }).content).toContain('login');
  });

  it('creates pending operations for write tools without modifying files', async () => {
    const { scan, projectMap } = await scanProject(projectRoot);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ctx = buildAgentToolContext(projectRoot, { scan, map: projectMap, structure, context });
    const before = fs.readFileSync(path.join(projectRoot, 'src/auth.ts'), 'utf-8');

    const result = await executeToolCall(
      {
        tool: 'propose_edit',
        input: { path: 'src/auth.ts', search: 'login', replace: 'signIn' },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.autoExecuted).toBe(false);
    expect(result.pendingOperationId).toBeDefined();
    expect(fs.readFileSync(path.join(projectRoot, 'src/auth.ts'), 'utf-8')).toBe(before);

    const op = getOperationById(db, result.pendingOperationId!);
    expect(op?.status).toBe('pending');
  });
});

describe('risk ranker', () => {
  it('ranks source auth/api files above config files', async () => {
    const projectRoot = createRiskProject();
    const { scan, projectMap } = await scanProject(projectRoot);
    const structure = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap);
    const ranked = rankFilesByRisk(projectMap, structure, context);

    const auth = ranked.find((r) => r.file === 'src/auth.ts');
    const pkg = ranked.find((r) => r.file === 'package.json');
    expect(auth).toBeDefined();
    expect(pkg).toBeDefined();
    expect(auth!.score).toBeGreaterThan(pkg!.score);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('agent query engine', () => {
  it('respects max loop limit with mocked chat', async () => {
    let calls = 0;
    const chatFn = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        return {
          content: JSON.stringify({
            action: 'tools',
            calls: [{ tool: 'search_files', input: { query: 'express' } }],
          }),
          model: 'mock',
          provider: 'mock',
        };
      }
      return {
        content: JSON.stringify({
          action: 'final',
          answer:
            '## Direct Answer\nExpress app.\n## Evidence\n- src/index.ts\n## Risks\nNone\n## Next Action\nRun tests',
        }),
        model: 'mock',
        provider: 'mock',
      };
    });

    const result = await runAgentQuery({
      projectPath: FIXTURE,
      question: 'What does this project do?',
      maxTurns: 3,
      chatFn,
    });

    expect(result.success).toBe(true);
    expect(result.metrics?.turnsUsed).toBeLessThanOrEqual(DEFAULT_MAX_AGENT_TURNS);
    expect(chatFn).toHaveBeenCalled();
    expect(validateStructuredAnswer(result.answer!)).toBe(true);
  });

  it('records audit events for tool execution', async () => {
    clearAuditLogForTests();
    const chatFn = vi.fn(async () => ({
      content: JSON.stringify({
        action: 'final',
        answer:
          '## Direct Answer\nDone.\n## Evidence\n- src/index.ts\n## Risks\nNone\n## Next Action\nScan again',
      }),
      model: 'mock',
      provider: 'mock',
    }));

    await runAgentQuery({
      projectPath: FIXTURE,
      question: 'What are the highest risk files?',
      maxTurns: 1,
      chatFn,
    });

    const events = readAuditEvents(20);
    expect(events.some((e) => e.event === 'agent_tool_executed')).toBe(true);
  });
});

describe('agent prompt parsing', () => {
  it('parses final and tool JSON responses', () => {
    const final = parseAgentModelResponse('{"action":"final","answer":"## Direct Answer\\nHi"}');
    expect(final?.action).toBe('final');

    const tools = parseAgentModelResponse(
      '{"action":"tools","calls":[{"tool":"read_file","input":{"path":"src/a.ts"}}]}',
    );
    expect(tools?.action).toBe('tools');
    if (tools?.action === 'tools') {
      expect(tools.calls[0]?.tool).toBe('read_file');
    }
  });
});
