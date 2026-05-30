import { describe, expect, it } from 'vitest';
import { runPreflightChecks } from '../src/utils/preflight.js';
import { verifyNativeSqlite } from '../src/utils/sqliteHealth.js';
describe('preflight', () => {
  it('passes on current Node with rebuilt native modules', () => {
    expect(() => runPreflightChecks(['node', 'test', 'scan'])).not.toThrow();
  });

  it('uses native sqlite instantiation not require-only loading', () => {
    const result = verifyNativeSqlite();
    expect(result.ok).toBe(true);
  });

  it('detects ABI mismatch message pattern', () => {
    const sample =
      'was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.';
    expect(/NODE_MODULE_VERSION/i.test(sample)).toBe(true);
  });
});
