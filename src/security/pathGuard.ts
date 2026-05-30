import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getConfigPath, getDataDir, isSubPath, normalizePath, resolveAbsolute } from '../utils/paths.js';

const ContextLimitsSchema = z.object({
  maxRankedFiles: z.number().int().positive().default(12),
  maxSymbols: z.number().int().positive().default(15),
  maxRoutes: z.number().int().positive().default(8),
  maxImportEdges: z.number().int().positive().default(12),
  maxRisks: z.number().int().positive().default(6),
  maxDependencies: z.number().int().positive().default(8),
  maxCircularImports: z.number().int().positive().default(3),
});

const AiConfigSchema = z.object({
  provider: z.enum(['ollama', 'openai', 'anthropic']).default('ollama'),
  model: z.string().default('qwen2.5-coder:7b'),
  fallbackModel: z.string().default('qwen2.5-coder:3b'),
  availableModels: z
    .array(z.string())
    .default(['qwen2.5-coder:7b', 'qwen2.5-coder:3b', 'qwen3.6']),
  baseUrl: z.string().url().default('http://localhost:11434'),
  timeoutMs: z.number().int().positive().default(120_000),
  maxContextChars: z.number().int().positive().default(12_000),
  maxOutputChars: z.number().int().positive().default(2000),
  contextLimits: ContextLimitsSchema.default({}),
});

const ConfigSchema = z.object({
  allowedRoots: z.array(z.string()).default([]),
  extraIgnores: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(1_048_576),
  maxIndexedFiles: z.number().int().positive().default(10_000),
  commandTimeoutMs: z.number().int().positive().default(120_000),
  ai: AiConfigSchema.default({}),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

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

const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.my.cnf',
]);

const SENSITIVE_NAME_PATTERNS = [
  /^\.env\./i,
  /credentials/i,
  /secrets?/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_dsa/i,
  /private\.key/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /\.token$/i,
  /token\.json$/i,
  /service-account.*\.json$/i,
];

const SENSITIVE_PATH_SEGMENTS = ['.ssh', '.aws', '.gnupg'];

export function isSensitivePath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  const lower = normalized.toLowerCase();
  const base = path.basename(lower);

  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(base))) return true;

  const segments = lower.split('/');
  if (segments.some((segment) => SENSITIVE_PATH_SEGMENTS.includes(segment))) return true;

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
    throw new Error('Reading sensitive files is blocked');
  }
}

export function assertAgentDataPath(targetPath: string): void {
  const resolved = resolveAbsolute(targetPath);
  const dataDir = resolveAbsolute(getDataDir());
  if (!isSubPath(dataDir, resolved)) {
    throw new Error('Agent writes are restricted to the data directory');
  }
}
