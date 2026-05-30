import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../security/pathGuard.js';
import { validateScanPath } from '../security/pathGuard.js';
import { getDataDir, getDbPath, getProjectRoot } from '../utils/paths.js';
import { formatOllamaNotRunningHelp, formatMissingModelHelp } from '../utils/ollamaHelp.js';
import {
  formatSqliteFailure,
  getBetterSqlite3Version,
  verifyNativeSqlite,
  verifyProductionSqlite,
} from '../utils/sqliteHealth.js';

export type DoctorStatus = 'PASS' | 'WARN' | 'FAIL';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  projectPath?: string;
  fetchImpl?: typeof fetch;
  verbose?: boolean;
}

export interface DoctorVerboseInfo {
  nodeVersion: string;
  abiVersion: string;
  betterSqlite3Version: string;
  databasePath: string;
  aiProvider: string;
  aiModel: string;
  ollamaStatus: string;
}

const RECOMMENDED_NODE_MAJOR = 22;

function sqliteFix(result: ReturnType<typeof verifyNativeSqlite>): string | undefined {
  if (result.ok) return undefined;
  return formatSqliteFailure(result);
}

function checkNodeVersion(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < RECOMMENDED_NODE_MAJOR) {
    return {
      name: 'Node version',
      status: 'FAIL',
      message: `${process.version} (requires Node ${RECOMMENDED_NODE_MAJOR})`,
      fix: 'Install Node 22 LTS and run: npm install',
    };
  }
  if (major !== RECOMMENDED_NODE_MAJOR) {
    return {
      name: 'Node version',
      status: 'WARN',
      message: `${process.version} (ABI ${process.versions.modules}; recommended Node ${RECOMMENDED_NODE_MAJOR})`,
      fix: 'Switch to Node 22 LTS (.nvmrc) and run: npm run rebuild:native',
    };
  }
  return { name: 'Node version', status: 'PASS', message: `${process.version} (ABI ${process.versions.modules})` };
}

function checkNpmVersion(): DoctorCheck {
  try {
    const version = execSync('npm --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { name: 'npm version', status: 'PASS', message: version };
  } catch {
    return {
      name: 'npm version',
      status: 'FAIL',
      message: 'npm not found on PATH',
      fix: 'Install Node.js 22 LTS (includes npm)',
    };
  }
}

function checkBetterSqlite3(): DoctorCheck {
  const result = verifyNativeSqlite();
  if (result.ok) {
    return { name: 'better-sqlite3', status: 'PASS', message: result.message ?? 'Native module usable' };
  }
  return {
    name: 'better-sqlite3',
    status: 'FAIL',
    message: result.message ?? 'Native module unusable',
    fix: sqliteFix(result),
  };
}

function checkDataFolderWritable(): DoctorCheck {
  try {
    const dataDir = getDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, '.doctor-write-test');
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return { name: 'Data folder writable', status: 'PASS', message: dataDir };
  } catch (err) {
    return {
      name: 'Data folder writable',
      status: 'FAIL',
      message: err instanceof Error ? err.message : 'Not writable',
      fix: 'Ensure the data/ directory is writable',
    };
  }
}

function checkSqliteAccessible(nativeResult: ReturnType<typeof verifyNativeSqlite>): DoctorCheck {
  if (!nativeResult.ok) {
    return {
      name: 'SQLite DB accessible',
      status: 'FAIL',
      message: 'Blocked — better-sqlite3 native module failed',
      fix: sqliteFix(nativeResult),
    };
  }

  const result = verifyProductionSqlite();
  if (result.ok) {
    return { name: 'SQLite DB accessible', status: 'PASS', message: result.message ?? getDbPath() };
  }
  return {
    name: 'SQLite DB accessible',
    status: 'FAIL',
    message: result.message ?? 'Database unavailable',
    fix: sqliteFix(result),
  };
}

async function checkOllamaReachable(fetchImpl: typeof fetch): Promise<DoctorCheck> {
  const { baseUrl } = loadConfig().ai;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return {
        name: 'Ollama reachable',
        status: 'FAIL',
        message: `HTTP ${response.status} at ${baseUrl}`,
        fix: formatOllamaNotRunningHelp(),
      };
    }
    return { name: 'Ollama reachable', status: 'PASS', message: baseUrl };
  } catch {
    return {
      name: 'Ollama reachable',
      status: 'FAIL',
      message: `Cannot connect to ${baseUrl}`,
      fix: formatOllamaNotRunningHelp(),
    };
  }
}

async function checkOllamaModel(fetchImpl: typeof fetch): Promise<DoctorCheck> {
  const { baseUrl, model } = loadConfig().ai;
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return {
        name: 'Ollama model installed',
        status: 'WARN',
        message: `Cannot verify model (Ollama HTTP ${response.status})`,
        fix: formatOllamaNotRunningHelp(model),
      };
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? []).map((m) => m.name ?? '');
    const installed = names.some((name) => name === model || name.startsWith(`${model}:`));
    if (installed) {
      return { name: 'Ollama model installed', status: 'PASS', message: model };
    }
    return {
      name: 'Ollama model installed',
      status: 'FAIL',
      message: `${model} not found`,
      fix: formatMissingModelHelp(model),
    };
  } catch {
    return {
      name: 'Ollama model installed',
      status: 'WARN',
      message: 'Skipped (Ollama unreachable)',
      fix: formatOllamaNotRunningHelp(model),
    };
  }
}

function checkGitAvailable(): DoctorCheck {
  try {
    const version = execSync('git --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { name: 'Git available', status: 'PASS', message: version };
  } catch {
    return {
      name: 'Git available',
      status: 'WARN',
      message: 'git not found on PATH',
      fix: 'Install Git for Windows to use git:status and git tools',
    };
  }
}

function checkPackageJson(projectPath: string): DoctorCheck {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    return {
      name: 'Project package.json',
      status: 'WARN',
      message: validation.error ?? 'Invalid project path',
    };
  }
  const pkgPath = path.join(validation.absolutePath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return { name: 'Project package.json', status: 'PASS', message: pkgPath };
  }
  return {
    name: 'Project package.json',
    status: 'WARN',
    message: 'package.json not found in project path',
  };
}

function checkGitRepo(projectPath: string): DoctorCheck {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    return { name: 'Project git repo', status: 'WARN', message: 'Skipped (invalid project path)' };
  }
  const gitDir = path.join(validation.absolutePath, '.git');
  if (fs.existsSync(gitDir)) {
    return { name: 'Project git repo', status: 'PASS', message: '.git present' };
  }
  return {
    name: 'Project git repo',
    status: 'WARN',
    message: 'Not a git repository',
    fix: 'Run: git init (optional, for git tools)',
  };
}

export async function runDoctorChecks(options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const projectPath = options.projectPath ?? getProjectRoot();
  const fetchImpl = options.fetchImpl ?? fetch;
  const nativeResult = verifyNativeSqlite();

  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    checkNpmVersion(),
    checkBetterSqlite3(),
    checkDataFolderWritable(),
    checkSqliteAccessible(nativeResult),
    await checkOllamaReachable(fetchImpl),
    await checkOllamaModel(fetchImpl),
    checkGitAvailable(),
    checkPackageJson(projectPath),
    checkGitRepo(projectPath),
  ];

  return checks;
}

export async function buildDoctorVerboseInfo(fetchImpl: typeof fetch = fetch): Promise<DoctorVerboseInfo> {
  const config = loadConfig().ai;
  let ollamaStatus = 'unreachable';
  try {
    const response = await fetchImpl(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    ollamaStatus = response.ok ? 'reachable' : `HTTP ${response.status}`;
  } catch {
    ollamaStatus = 'unreachable';
  }

  return {
    nodeVersion: process.version,
    abiVersion: process.versions.modules,
    betterSqlite3Version: getBetterSqlite3Version(),
    databasePath: getDbPath(),
    aiProvider: config.provider,
    aiModel: config.model,
    ollamaStatus,
  };
}

export function formatDoctorVerbose(info: DoctorVerboseInfo): string {
  return [
    'Verbose Diagnostics',
    '───────────────────',
    `Node version:       ${info.nodeVersion}`,
    `ABI version:        ${info.abiVersion}`,
    `better-sqlite3:     ${info.betterSqlite3Version}`,
    `Database path:      ${info.databasePath}`,
    `AI provider:        ${info.aiProvider}`,
    `AI model:           ${info.aiModel}`,
    `Ollama status:      ${info.ollamaStatus}`,
  ].join('\n');
}

export function formatDoctorReport(checks: DoctorCheck[], verboseInfo?: DoctorVerboseInfo): string {
  const lines = ['RiSoCa Doctor', '─────────────'];
  for (const check of checks) {
    lines.push(`[${check.status}] ${check.name.padEnd(22)} ${check.message}`);
    if (check.fix && check.status !== 'PASS') {
      for (const fixLine of check.fix.split('\n')) {
        lines.push(`         ${fixLine}`);
      }
    }
  }

  const failCount = checks.filter((c) => c.status === 'FAIL').length;
  const warnCount = checks.filter((c) => c.status === 'WARN').length;
  lines.push('');
  lines.push(`Summary: ${checks.filter((c) => c.status === 'PASS').length} pass, ${warnCount} warn, ${failCount} fail`);

  if (verboseInfo) {
    lines.push('', formatDoctorVerbose(verboseInfo));
  }

  return lines.join('\n');
}

export function doctorExitCode(checks: DoctorCheck[]): number {
  return checks.some((c) => c.status === 'FAIL') ? 1 : 0;
}
