import { describe, expect, it, vi } from 'vitest';
import { doctorExitCode, formatDoctorReport, runDoctorChecks, buildDoctorVerboseInfo } from '../src/doctor/doctorService.js';
import { formatAskProviderError, formatMissingModelHelp, formatOllamaNotRunningHelp } from '../src/utils/ollamaHelp.js';
import {
  formatApproveCommand,
  formatPendingOperationNotice,
  formatPendingOperationsList,
} from '../src/utils/operationUx.js';
import type { FileOperation } from '../src/types.js';

describe('doctorService', () => {
  it('formats PASS WARN FAIL report', async () => {
    const checks = await runDoctorChecks({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 })),
    });
    const report = formatDoctorReport(checks);
    expect(report).toContain('RiSoCa Doctor');
    expect(report).toMatch(/\[(PASS|WARN|FAIL)\]/);
    expect(report).toContain('Summary:');
  });

  it('returns exit code 1 when any check fails', async () => {
    const checks = [
      { name: 'Node version', status: 'PASS' as const, message: 'v22.22.0' },
      { name: 'Ollama reachable', status: 'FAIL' as const, message: 'down', fix: 'ollama serve' },
    ];
    expect(doctorExitCode(checks)).toBe(1);
  });

  it('returns exit code 0 when only warnings', () => {
    const checks = [{ name: 'Git repo', status: 'WARN' as const, message: 'none' }];
    expect(doctorExitCode(checks)).toBe(0);
  });

  it('marks sqlite checks consistently', async () => {
    const checks = await runDoctorChecks({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })),
    });
    const native = checks.find((c) => c.name === 'better-sqlite3');
    const db = checks.find((c) => c.name === 'SQLite DB accessible');
    expect(native?.status).toBe('PASS');
    expect(db?.status).toBe('PASS');
  });

  it('includes verbose diagnostics', async () => {
    const checks = await runDoctorChecks({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })),
    });
    const verbose = await buildDoctorVerboseInfo(
      vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })),
    );
    const report = formatDoctorReport(checks, verbose);
    expect(report).toContain('Verbose Diagnostics');
    expect(report).toContain('ABI version:');
    expect(report).toContain('better-sqlite3:');
    expect(report).toContain('Database path:');
  });
});

describe('ollamaHelp', () => {
  it('prints Windows Ollama serve instructions', () => {
    const help = formatOllamaNotRunningHelp('qwen2.5-coder:7b');
    expect(help).toContain('Start a second PowerShell and run:');
    expect(help).toContain('ollama serve');
    expect(help).toContain('ollama pull qwen2.5-coder:7b');
  });

  it('prints missing model pull command', () => {
    const help = formatMissingModelHelp('qwen2.5-coder:3b');
    expect(help).toContain('ollama pull qwen2.5-coder:3b');
  });

  it('maps provider errors to helpful ask messages', () => {
    const help = formatAskProviderError('Ollama is not running. Start it with `ollama serve`', 'qwen2.5-coder:7b');
    expect(help).toContain('ollama serve');
  });
});

describe('operationUx', () => {
  it('prints approve command hint', () => {
    expect(formatApproveCommand('abc-123')).toBe('npm run approve -- "abc-123"');
  });

  it('prints pending operation notice with approve command', () => {
    const notice = formatPendingOperationNotice({
      operationId: 'abc-123',
      operationType: 'write_file',
      target: 'src/app.ts',
      preview: 'Summary: create file',
    });
    expect(notice).toContain('Operation ID: abc-123');
    expect(notice).toContain('Type:         write_file');
    expect(notice).toContain('Target:       src/app.ts');
    expect(notice).toContain('npm run approve -- "abc-123"');
  });

  it('formats unified pending list', () => {
    const fileOp: FileOperation = {
      id: 'file-1',
      projectId: 1,
      operationType: 'write_file',
      targetPath: 'src/a.ts',
      payload: {},
      status: 'pending',
      preview: { summary: 'Create file', exists: false },
      snapshotId: null,
      createdAt: '2026-05-30T12:00:00.000Z',
      approvedAt: null,
      executedAt: null,
      rejectedAt: null,
    };
    const output = formatPendingOperationsList([fileOp], []);
    expect(output).toContain('Pending Operations (1)');
    expect(output).toContain('ID:       file-1');
    expect(output).toContain('Approve:  npm run approve -- "file-1"');
  });
});

describe('askService provider errors', () => {
  it('returns formatted message when Ollama is unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { askProject } = await import('../src/agent/askService.js');
    const result = await askProject({
      projectPath: 'tests/fixtures/minimal-project',
      question: 'What does this project do?',
      fetchImpl,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ollama serve');
    expect(result.error).toContain('ollama pull');
  });
});
