import fs from 'node:fs';
import path from 'node:path';
import type { DependencyEntry, StackInfo } from '../types.js';
import { normalizePath } from '../utils/paths.js';

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.sql': 'SQL',
  '.prisma': 'Prisma',
};

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? 'Other';
}

export function detectPackageManager(root: string): string | null {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(root, 'package.json'))) return 'npm';
  if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'))) {
    return 'pip';
  }
  return null;
}

export function detectRuntimes(root: string): string[] {
  const runtimes: string[] = [];
  if (fs.existsSync(path.join(root, 'package.json'))) runtimes.push('Node.js');
  if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'))) {
    runtimes.push('Python');
  }
  if (fs.existsSync(path.join(root, 'Dockerfile')) || fs.existsSync(path.join(root, 'docker-compose.yml'))) {
    runtimes.push('Docker');
  }
  return runtimes;
}

export function detectCiPaths(root: string): string[] {
  const ciPaths: string[] = [];
  const candidates = [
    '.github/workflows',
    '.gitlab-ci.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    '.circleci/config.yml',
  ];
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full)) ciPaths.push(normalizePath(candidate));
  }
  return ciPaths;
}

export function detectEntryPoints(root: string): string[] {
  const entries: string[] = [];
  const candidates = [
    'src/main.ts',
    'src/index.ts',
    'index.ts',
    'index.js',
    'main.ts',
    'main.js',
    'app/index.ts',
    'app/page.tsx',
    'src/app/page.tsx',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(root, candidate))) {
      entries.push(normalizePath(candidate));
    }
  }
  return entries;
}

export function parsePackageJsonDependencies(root: string): DependencyEntry[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: DependencyEntry[] = [];
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      deps.push({ name, version, kind: 'npm', dev: false });
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      deps.push({ name, version, kind: 'npm', dev: true });
    }
    return deps;
  } catch {
    return [];
  }
}

export function detectStack(root: string, indexedLanguages: Set<string>): StackInfo {
  const languages = [...indexedLanguages].sort();
  return {
    languages,
    packageManager: detectPackageManager(root),
    runtimes: detectRuntimes(root),
    hasDocker: fs.existsSync(path.join(root, 'Dockerfile')) || fs.existsSync(path.join(root, 'docker-compose.yml')),
    hasCi: detectCiPaths(root).length > 0,
    ciPaths: detectCiPaths(root),
    entryPoints: detectEntryPoints(root),
  };
}
