import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getConfigPath, normalizePath, resolveAbsolute } from '../utils/paths.js';

const ConfigSchema = z.object({
  allowedRoots: z.array(z.string()).default([]),
  extraIgnores: z.array(z.string()).default([]),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = getConfigPath();
  const raw = fs.readFileSync(configPath, 'utf-8');
  cachedConfig = ConfigSchema.parse(JSON.parse(raw));
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export interface PathValidationResult {
  valid: boolean;
  absolutePath: string;
  error?: string;
}

export function validateScanPath(inputPath: string): PathValidationResult {
  const absolutePath = resolveAbsolute(inputPath);
  const normalized = normalizePath(absolutePath);

  if (!fs.existsSync(absolutePath)) {
    return { valid: false, absolutePath, error: `Path does not exist: ${normalized}` };
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    return { valid: false, absolutePath, error: `Path is not a directory: ${normalized}` };
  }

  const config = loadConfig();
  if (config.allowedRoots.length > 0) {
    const allowed = config.allowedRoots.some((root) => {
      const resolvedRoot = resolveAbsolute(root);
      const relative = path.relative(resolvedRoot, absolutePath);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
    if (!allowed) {
      return {
        valid: false,
        absolutePath,
        error: 'Path is outside configured allowedRoots',
      };
    }
  }

  return { valid: true, absolutePath };
}

export function isSensitivePath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).toLowerCase();
  const base = path.basename(normalized);
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (normalized.includes('/.env/') || normalized.startsWith('.env/')) return true;
  return false;
}

export function assertReadablePath(root: string, relativePath: string): void {
  const fullPath = path.join(root, relativePath);
  const validation = validateScanPath(root);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid root path');
  }
  const relative = path.relative(validation.absolutePath, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes project root');
  }
  if (isSensitivePath(relativePath)) {
    throw new Error('Reading sensitive .env files is blocked');
  }
}
