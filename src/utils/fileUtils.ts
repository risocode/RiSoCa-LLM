import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isSensitivePath } from '../security/pathGuard.js';

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function readFileSafe(root: string, relativePath: string): string | null {
  const fullPath = path.join(root, relativePath);
  if (isSensitivePath(relativePath)) {
    return null;
  }
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function hashFile(root: string, relativePath: string): string {
  const content = readFileSafe(root, relativePath);
  if (content === null) return '';
  return hashContent(content);
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split('\n').length;
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
