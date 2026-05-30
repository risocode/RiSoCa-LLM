import { spawn } from 'node:child_process';
import type { CommandOperationResult } from '../types.js';
import { loadConfig } from './pathGuard.js';
import { validateScanPath } from './pathGuard.js';

export interface ExecuteCommandOptions {
  projectRoot: string;
  command: string;
  argv?: string[];
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

export interface ExecuteCommandOutcome {
  success: boolean;
  result?: CommandOperationResult;
  error?: string;
}

function summarizeOutput(text: string, max = 500): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function resolveExecutable(argv: string[]): { executable: string; args: string[]; shell: boolean } {
  const [first, ...rest] = argv;
  if (!first) throw new Error('Missing executable');
  if (first.toLowerCase() === 'npm') {
    return { executable: 'npm', args: rest, shell: process.platform === 'win32' };
  }
  if (first.toLowerCase() === 'git') {
    return { executable: 'git', args: rest, shell: false };
  }
  return { executable: first, args: rest, shell: false };
}

export function assertWorkingDirectory(projectRoot: string): { valid: boolean; absolutePath: string; error?: string } {
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return validation;
  return { valid: true, absolutePath: validation.absolutePath };
}

export async function executeCommand(options: ExecuteCommandOptions): Promise<ExecuteCommandOutcome> {
  const cwdCheck = assertWorkingDirectory(options.projectRoot);
  if (!cwdCheck.valid) return { success: false, error: cwdCheck.error ?? 'Invalid working directory' };

  const argv = options.argv ?? options.command.split(/\s+/).filter(Boolean);
  if (argv.length === 0) return { success: false, error: 'Empty command' };

  const { executable, args, shell } = resolveExecutable(argv);
  const timeoutMs = options.timeoutMs ?? loadConfig().commandTimeoutMs;
  const spawnFn = options.spawnImpl ?? spawn;
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawnFn(executable, args, {
      cwd: cwdCheck.absolutePath,
      env: process.env,
      shell,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const result: CommandOperationResult = {
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      };
      resolve({ success: !timedOut, result, error: timedOut ? `Command timed out after ${timeoutMs}ms` : undefined });
    });
  });
}

export async function captureGitDiff(projectRoot: string): Promise<string> {
  const outcome = await executeCommand({
    projectRoot,
    command: 'git diff',
    argv: ['git', 'diff'],
    timeoutMs: 30_000,
  });
  return outcome.result?.stdout ?? '';
}

export function summarizeExecution(result: CommandOperationResult): {
  stdoutSummary: string;
  stderrSummary: string;
} {
  return {
    stdoutSummary: summarizeOutput(result.stdout),
    stderrSummary: summarizeOutput(result.stderr),
  };
}
