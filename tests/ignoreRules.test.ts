import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIgnoreFilter, isEnvFile, shouldIgnore } from '../src/scanner/ignoreRules.js';
import { isSensitivePath } from '../src/security/pathGuard.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

describe('ignoreRules', () => {
  it('skips node_modules and dist', () => {
    const ig = createIgnoreFilter(FIXTURE);
    expect(shouldIgnore('node_modules/pkg/index.js', ig)).toBe(true);
    expect(shouldIgnore('dist/bundle.js', ig)).toBe(true);
  });

  it('skips env files', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('.env.local')).toBe(true);
    expect(isEnvFile('src/config.ts')).toBe(false);
    expect(isSensitivePath('.env')).toBe(true);
  });

  it('allows source files', () => {
    const ig = createIgnoreFilter(FIXTURE);
    expect(shouldIgnore('src/index.ts', ig)).toBe(false);
    expect(shouldIgnore('README.md', ig)).toBe(false);
  });
});
