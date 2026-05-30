import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertAgentDataPath, isSensitivePath, loadConfig } from '../security/pathGuard.js';
import { isSubPath, resolveAbsolute } from './paths.js';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav',
  '.pdf', '.db', '.sqlite', '.sqlite3', '.lockb',
  '.class', '.jar', '.o', '.obj',
]);

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function isBinaryExtension(relativePath: string): boolean {
  const ext = path.extname(relativePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export function shouldSkipIndexing(relativePath: string, sizeBytes: number): boolean {
  if (isSensitivePath(relativePath)) return true;
  if (isBinaryExtension(relativePath)) return true;
  const { maxFileSizeBytes } = loadConfig();
  return sizeBytes > maxFileSizeBytes;
}

export function readFileSafe(root: string, relativePath: string): string | null {
  if (isSensitivePath(relativePath) || isBinaryExtension(relativePath)) {
    return null;
  }

  const fullPath = path.join(root, relativePath);
  try {
    const stat = fs.statSync(fullPath);
    const { maxFileSizeBytes } = loadConfig();
    if (stat.size > maxFileSizeBytes) return null;

    const buffer = fs.readFileSync(fullPath);
    if (isBinaryBuffer(buffer)) return null;
    return buffer.toString('utf-8');
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
  assertAgentDataPath(dirPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJson(filePath: string, data: unknown): void {
  const resolved = resolveAbsolute(filePath);
  assertAgentDataPath(resolved);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function assertWithinProjectRoot(root: string, relativePath: string): void {
  const fullPath = resolveAbsolute(path.join(root, relativePath));
  const projectRoot = resolveAbsolute(root);
  if (!isSubPath(projectRoot, fullPath)) {
    throw new Error('Path escapes project root');
  }
}
