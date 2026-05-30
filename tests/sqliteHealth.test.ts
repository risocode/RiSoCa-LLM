import { describe, expect, it } from 'vitest';
import {
  formatSqliteFailure,
  parseAbiMismatch,
  verifyNativeSqlite,
  verifyProductionSqlite,
  verifySqliteStack,
} from '../src/utils/sqliteHealth.js';

describe('sqliteHealth', () => {
  it('parses ABI mismatch details from native errors', () => {
    const error = new Error(
      "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.",
    );
    expect(parseAbiMismatch(error)).toEqual({ compiledAbi: '137', requiredAbi: '127' });
  });

  it('formats a clear ABI fix message', () => {
    const message = formatSqliteFailure({
      ok: false,
      abiMismatch: { compiledAbi: '137', requiredAbi: '127' },
      error: new Error('NODE_MODULE_VERSION mismatch'),
    });
    expect(message).toContain('Node version:');
    expect(message).toContain('Current ABI:');
    expect(message).toContain('Module ABI:   137');
    expect(message).toContain('Required ABI: 127');
    expect(message).toContain('npm run rebuild:native');
  });

  it('verifies native sqlite by opening an in-memory database', () => {
    const result = verifyNativeSqlite();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/better-sqlite3@/);
  });

  it('verifies production sqlite through getDatabase()', () => {
    const result = verifyProductionSqlite();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Production database');
  });

  it('does not report production PASS when native fails', () => {
    const stack = verifySqliteStack();
    if (!stack.native.ok) {
      expect(stack.production.ok).toBe(false);
      expect(stack.production.message).toMatch(/Skipped|failed/i);
    } else {
      expect(stack.production.ok).toBe(true);
    }
  });
});
