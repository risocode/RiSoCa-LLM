import fs from 'node:fs';
import path from 'node:path';
import type { Ignore } from 'ignore';
import type { DependencyEntry, FileEntry } from '../types.js';
import { isSensitivePath } from '../security/pathGuard.js';
import { countLines, hashContent } from '../utils/fileUtils.js';
import { detectLanguage } from '../scanner/stackDetector.js';
import { isEnvFile } from '../scanner/ignoreRules.js';

const ROLE_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /(^|\/)tests?\//i, role: 'test' },
  { pattern: /(__tests__|\.test\.|\.spec\.)/i, role: 'test' },
  { pattern: /(^|\/)src\//i, role: 'source' },
  { pattern: /(^|\/)app\//i, role: 'app' },
  { pattern: /(^|\/)components?\//i, role: 'component' },
  { pattern: /(^|\/)pages?\//i, role: 'page' },
  { pattern: /(^|\/)api\//i, role: 'api' },
  { pattern: /(^|\/)config\//i, role: 'config' },
  { pattern: /package\.json$/i, role: 'manifest' },
  { pattern: /tsconfig.*\.json$/i, role: 'config' },
  { pattern: /README\.md$/i, role: 'docs' },
];

function classifyRole(relativePath: string): string {
  for (const { pattern, role } of ROLE_PATTERNS) {
    if (pattern.test(relativePath)) return role;
  }
  return 'other';
}

export interface FileIndexInput {
  rootPath: string;
  filePaths: string[];
  ig: Ignore;
}

export function indexFiles(input: FileIndexInput): { files: FileEntry[]; skippedCount: number } {
  const { rootPath, filePaths, ig } = input;
  const files: FileEntry[] = [];
  let skippedCount = 0;

  for (const rel of filePaths) {
    const normalized = rel.replace(/\\/g, '/');
    if (isEnvFile(normalized) || isSensitivePath(normalized) || ig.ignores(normalized)) {
      skippedCount++;
      continue;
    }

    const fullPath = path.join(rootPath, normalized);
    try {
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      files.push({
        path: normalized,
        language: detectLanguage(normalized),
        size: stat.size,
        role: classifyRole(normalized),
        hash: hashContent(content),
        lineCount: countLines(content),
      });
    } catch {
      skippedCount++;
    }
  }

  return { files, skippedCount };
}

export function indexDependencies(rootPath: string, deps: DependencyEntry[]): DependencyEntry[] {
  if (deps.length > 0) return deps;

  const reqPath = path.join(rootPath, 'requirements.txt');
  if (!fs.existsSync(reqPath)) return [];

  const lines = fs.readFileSync(reqPath, 'utf-8').split('\n');
  const parsed: DependencyEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [name, version = '*'] = trimmed.split(/[=<>~!]/);
    parsed.push({ name: name.trim(), version: version.trim(), kind: 'python', dev: false });
  }
  return parsed;
}
