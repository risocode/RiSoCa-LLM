import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { loadConfig } from '../security/pathGuard.js';
import { normalizePath } from '../utils/paths.js';

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.expo/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.env',
  '**/.env.*',
];

export function createIgnoreFilter(projectRoot: string): Ignore {
  const config = loadConfig();
  const ig = ignore();

  ig.add(DEFAULT_IGNORE_PATTERNS);
  ig.add(config.extraIgnores);

  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(gitignoreContent);
  }

  return ig;
}

export function shouldIgnore(relativePath: string, ig: Ignore): boolean {
  const normalized = normalizePath(relativePath);
  return ig.ignores(normalized);
}

export function isEnvFile(relativePath: string): boolean {
  const base = path.basename(normalizePath(relativePath)).toLowerCase();
  return base === '.env' || base.startsWith('.env.');
}
