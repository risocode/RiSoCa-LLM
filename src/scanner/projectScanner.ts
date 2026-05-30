import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { ProjectMap, ScanResult } from '../types.js';
import { buildProjectMap } from '../indexer/projectMap.js';
import { countLines, hashContent } from '../utils/fileUtils.js';
import { detectFrameworks } from './frameworkDetector.js';
import { createIgnoreFilter, isEnvFile } from './ignoreRules.js';
import { detectLanguage, detectStack, parsePackageJsonDependencies } from './stackDetector.js';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
]);

function computeFingerprint(root: string, filePaths: string[]): string {
  const payload = `${root}:${filePaths.length}:${filePaths.slice(0, 20).join(',')}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function computeHealthScore(root: string, fileCount: number, risks: string[]): number {
  let score = 50;
  if (fileCount > 0 && fileCount < 5000) score += 10;
  if (fileCount >= 5000) score -= 10;

  const hasReadme = ['README.md', 'readme.md', 'README.txt'].some((f) =>
    fs.existsSync(path.join(root, f)),
  );
  if (hasReadme) score += 10;

  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  if (testDirs.some((d) => fs.existsSync(path.join(root, d)))) score += 15;

  if (fs.existsSync(path.join(root, '.github', 'workflows'))) score += 10;
  if (fs.existsSync(path.join(root, 'eslint.config.js')) || fs.existsSync(path.join(root, '.eslintrc.json'))) score += 5;
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) score += 5;

  score -= risks.length * 5;
  return Math.max(0, Math.min(100, score));
}

function computeComplexityScore(fileCount: number, largeFileCount: number, graphDepth: number): number {
  let score = 0;
  score += Math.min(40, Math.floor(fileCount / 25));
  score += Math.min(30, largeFileCount * 5);
  score += Math.min(30, graphDepth * 3);
  return Math.max(0, Math.min(100, score));
}

function detectRisks(
  root: string,
  files: { path: string; lineCount: number }[],
  stack: ReturnType<typeof detectStack>,
): { risks: string[]; improvements: string[] } {
  const risks: string[] = [];
  const improvements: string[] = [];

  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  if (!testDirs.some((d) => fs.existsSync(path.join(root, d)))) {
    risks.push('No test directory detected');
    improvements.push('Add a tests/ directory with unit tests');
  }

  const largeFiles = files.filter((f) => f.lineCount > 500);
  if (largeFiles.length > 0) {
    risks.push(`${largeFiles.length} file(s) exceed 500 lines`);
    improvements.push('Split large files into smaller modules');
  }

  if (!stack.hasCi) {
    risks.push('No CI/CD pipeline detected');
    improvements.push('Add GitHub Actions or similar CI workflow');
  }

  if (!fs.existsSync(path.join(root, 'README.md')) && !fs.existsSync(path.join(root, 'readme.md'))) {
    risks.push('No README detected');
    improvements.push('Add a README with setup and usage instructions');
  }

  if (files.length > 1000) {
    risks.push('Large codebase (>1000 indexed files)');
  }

  return { risks, improvements };
}

export interface ScanPipelineResult {
  scan: ScanResult;
  projectMap: ProjectMap;
}

export async function scanProject(rootPath: string): Promise<ScanPipelineResult> {
  const root = path.resolve(rootPath);
  const ig = createIgnoreFilter(root);
  const scannedAt = new Date().toISOString();

  const allPaths = await fg('**/*', {
    cwd: root,
    absolute: false,
    onlyFiles: true,
    dot: false,
  });

  let skippedCount = 0;
  const indexedPaths: string[] = [];

  for (const rel of allPaths) {
    const normalized = rel.replace(/\\/g, '/');
    if (isEnvFile(normalized) || ig.ignores(normalized)) {
      skippedCount++;
      continue;
    }
    indexedPaths.push(normalized);
  }

  const languages = new Set<string>();
  const fileMeta: { path: string; lineCount: number }[] = [];

  for (const rel of indexedPaths) {
    languages.add(detectLanguage(rel));
    if (CODE_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
      try {
        const content = fs.readFileSync(path.join(root, rel), 'utf-8');
        fileMeta.push({ path: rel, lineCount: countLines(content) });
      } catch {
        fileMeta.push({ path: rel, lineCount: 0 });
      }
    }
  }

  const stack = detectStack(root, languages);
  const frameworks = detectFrameworks(root);
  const fingerprint = computeFingerprint(root, indexedPaths);

  const projectMap = buildProjectMap({
    rootPath: root,
    scannedAt,
    filePaths: indexedPaths,
    dependencies: parsePackageJsonDependencies(root),
    ig,
  });

  const { risks, improvements } = detectRisks(root, fileMeta, stack);
  const healthScore = computeHealthScore(root, indexedPaths.length, risks);
  const complexityScore = computeComplexityScore(
    indexedPaths.length,
    fileMeta.filter((f) => f.lineCount > 500).length,
    projectMap.stats.depth,
  );

  const name = path.basename(root);
  const summary = `${name}: ${indexedPaths.length} files, ${stack.languages.join(', ') || 'unknown languages'}${frameworks.primary ? `, ${frameworks.primary}` : ''}`;

  const scan: ScanResult = {
    rootPath: root,
    name,
    scannedAt,
    fingerprint,
    fileCount: indexedPaths.length,
    skippedCount,
    stack,
    frameworks,
    healthScore,
    complexityScore,
    risks,
    improvements,
    summary,
  };

  return { scan, projectMap };
}

export function fingerprintFromScan(scan: ScanResult): string {
  return scan.fingerprint || hashContent(`${scan.rootPath}:${scan.fileCount}:${scan.scannedAt}`);
}
