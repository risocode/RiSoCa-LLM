import { getDatabase } from '../database/db.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { getDbPath } from './paths.js';

export const ABI_MISMATCH_PATTERN = /NODE_MODULE_VERSION/i;
export const RECOMMENDED_NODE_MAJOR = 22;

export interface AbiMismatchInfo {
  compiledAbi: string;
  requiredAbi: string;
}

export interface SqliteVerifyResult {
  ok: boolean;
  message?: string;
  error?: Error;
  abiMismatch?: AbiMismatchInfo;
}

export function parseAbiMismatch(error: Error): AbiMismatchInfo | null {
  const match = error.message.match(/NODE_MODULE_VERSION (\d+)[\s\S]*NODE_MODULE_VERSION (\d+)/i);
  if (!match) return null;
  return { compiledAbi: match[1]!, requiredAbi: match[2]! };
}

export function getBetterSqlite3Version(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('better-sqlite3/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function formatSqliteFailure(result: SqliteVerifyResult): string {
  const lines = ['SQLite is unusable — RiSoCa cannot run file, command, or ask features that need the database.'];

  lines.push(`Node version: ${process.version}`);
  lines.push(`Current ABI:  ${process.versions.modules}`);

  if (result.abiMismatch) {
    lines.push(`Module ABI:   ${result.abiMismatch.compiledAbi} (compiled)`);
    lines.push(`Required ABI: ${result.abiMismatch.requiredAbi} (this Node)`);
  } else if (result.error) {
    lines.push(`Error: ${result.error.message.split('\n')[0]}`);
  }

  lines.push('');
  lines.push('Fix:');
  lines.push('  npm run rebuild:native');
  lines.push('');
  lines.push('If you recently changed Node versions, always rebuild native modules.');
  return lines.join('\n');
}

function toVerifyResult(err: unknown, successMessage: string): SqliteVerifyResult {
  if (!(err instanceof Error)) {
    return { ok: false, error: new Error('Unknown SQLite error') };
  }

  const abiMismatch = parseAbiMismatch(err);
  if (abiMismatch || ABI_MISMATCH_PATTERN.test(err.message)) {
    return {
      ok: false,
      error: err,
      abiMismatch: abiMismatch ?? {
        compiledAbi: 'unknown',
        requiredAbi: process.versions.modules,
      },
      message: abiMismatch
        ? `ABI mismatch: module=${abiMismatch.compiledAbi}, required=${abiMismatch.requiredAbi}`
        : err.message.split('\n')[0],
    };
  }

  return { ok: false, error: err, message: err.message.split('\n')[0] };
}

/** Instantiate better-sqlite3 against :memory: — proves the native binding works. */
export function verifyNativeSqlite(): SqliteVerifyResult {
  try {
    const require = createRequire(import.meta.url);
    const DatabaseCtor = require('better-sqlite3') as typeof Database;
    const db = new DatabaseCtor(':memory:');
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    db.close();
    if (row?.ok !== 1) {
      return { ok: false, error: new Error('SQLite memory probe returned unexpected result') };
    }
    return { ok: true, message: `Native module OK (better-sqlite3@${getBetterSqlite3Version()})` };
  } catch (err) {
    return toVerifyResult(err, '');
  }
}

/** Open the production database via getDatabase() — same path used by pending/ask flows. */
export function verifyProductionSqlite(): SqliteVerifyResult {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    if (row?.ok !== 1) {
      return { ok: false, error: new Error('Production database probe returned unexpected result') };
    }
    return { ok: true, message: `Production database opens and queries (${getDbPath()})` };
  } catch (err) {
    return toVerifyResult(err, '');
  }
}

export function verifySqliteStack(): { native: SqliteVerifyResult; production: SqliteVerifyResult } {
  const native = verifyNativeSqlite();
  if (!native.ok) {
    return {
      native,
      production: {
        ok: false,
        message: 'Skipped — native module check failed',
        error: native.error,
        abiMismatch: native.abiMismatch,
      },
    };
  }
  return { native, production: verifyProductionSqlite() };
}

export function isDoctorCommand(argv: string[] = process.argv): boolean {
  return argv.some((arg) => arg === 'doctor' || arg.endsWith('doctor'));
}

export function assertSqliteReady(argv: string[] = process.argv): void {
  const { native, production } = verifySqliteStack();
  if (native.ok && production.ok) return;

  if (isDoctorCommand(argv)) return;

  const failure = !native.ok ? native : production;
  console.error(formatSqliteFailure(failure));
  process.exit(1);
}
