import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAgentDataPath, isSensitivePath } from '../src/security/pathGuard.js';
import {
  isBinaryExtension,
  readFileSafe,
  shouldSkipIndexing,
  writeJson,
} from '../src/utils/fileUtils.js';
import { getDataDir } from '../src/utils/paths.js';

describe('security', () => {
  it('blocks sensitive file paths', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('.env.production')).toBe(true);
    expect(isSensitivePath('config/credentials.json')).toBe(true);
    expect(isSensitivePath('.ssh/id_rsa')).toBe(true);
    expect(isSensitivePath('certs/private.key')).toBe(true);
    expect(isSensitivePath('src/index.ts')).toBe(false);
  });

  it('detects binary extensions', () => {
    expect(isBinaryExtension('assets/logo.png')).toBe(true);
    expect(isBinaryExtension('src/index.ts')).toBe(false);
  });

  it('skips oversized files', () => {
    expect(shouldSkipIndexing('src/huge.ts', 2_000_000)).toBe(true);
    expect(shouldSkipIndexing('src/index.ts', 100)).toBe(false);
  });

  it('does not read env files from fixture', () => {
    const fixture = path.join(import.meta.dirname, 'fixtures', 'minimal-project');
    expect(readFileSafe(fixture, '.env')).toBeNull();
  });

  it('restricts agent writes to data directory', () => {
    expect(() => assertAgentDataPath(path.join(getDataDir(), 'project-map.json'))).not.toThrow();
    expect(() => assertAgentDataPath('C:\\Windows\\temp\\hack.json')).toThrow(
      /restricted to the data directory/i,
    );
  });

  it('writeJson rejects paths outside data directory', () => {
    expect(() => writeJson('C:\\Windows\\temp\\evil.json', { ok: true })).toThrow(
      /restricted to the data directory/i,
    );
  });
});
