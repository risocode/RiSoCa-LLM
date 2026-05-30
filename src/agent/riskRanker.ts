import type { ProjectContext, ProjectMap, StructuralAnalysis } from '../types.js';

const LARGE_FILE_LINES = 500;

const SECURITY_PATH = /auth|login|token|password|credential|secret|security|permission|session|oauth/i;
const API_PATH = /(?:^|\/)api(?:\/|\.|$)|route|controller|handler|middleware/i;
const CONFIG_PATH = /(?:^|\/)(?:package\.json|tsconfig\.json|\.eslintrc|vite\.config|webpack\.config|config\.)/i;

export interface RiskRankEntry {
  file: string;
  score: number;
  reasons: string[];
}

function fileLineCount(map: ProjectMap, file: string): number {
  return map.files.find((f) => f.path === file)?.lineCount ?? 0;
}

export function scoreFileRisk(
  file: string,
  map: ProjectMap,
  structure: StructuralAnalysis,
  context: ProjectContext,
): RiskRankEntry {
  let score = 0;
  const reasons: string[] = [];
  const lower = file.toLowerCase();

  if (SECURITY_PATH.test(lower)) {
    score += 45;
    reasons.push('security-related path');
  }
  if (API_PATH.test(lower) || map.routes.some((r) => r.file === file)) {
    score += 35;
    reasons.push('API or route surface');
  }
  if (structure.highFanIn.some((m) => m.file === file)) {
    score += 25;
    reasons.push('high fan-in');
  }
  if (structure.highFanOut.some((m) => m.file === file)) {
    score += 20;
    reasons.push('high fan-out');
  }
  if (structure.unresolvedImports.some((u) => u.from === file || u.to === file)) {
    score += 30;
    reasons.push('unresolved import');
  }
  if (structure.circularImports.some((cycle) => cycle.includes(file))) {
    score += 25;
    reasons.push('circular import');
  }
  if (structure.orphanFiles.includes(file)) {
    score += 10;
    reasons.push('orphan file');
  }
  if (context.highRiskFiles.includes(file)) {
    score += 30;
    reasons.push('flagged high risk');
  }
  if (context.entryPoints.includes(file)) {
    score += 15;
    reasons.push('entry point');
  }

  const lines = fileLineCount(map, file);
  if (lines >= LARGE_FILE_LINES) {
    score += 15;
    reasons.push('large file');
  }

  if (CONFIG_PATH.test(file)) {
    score -= 35;
    reasons.push('config file (lower priority)');
  }

  return { file, score: Math.max(score, 0), reasons };
}

export function rankFilesByRisk(
  map: ProjectMap,
  structure: StructuralAnalysis,
  context: ProjectContext,
  limit = 12,
): RiskRankEntry[] {
  const candidates = new Set<string>([
    ...map.files
      .filter(
        (f) =>
          f.role === 'source' ||
          f.role === 'api' ||
          f.role === 'app' ||
          f.role === 'config' ||
          f.role === 'manifest',
      )
      .map((f) => f.path),
    ...context.entryPoints,
    ...context.highRiskFiles,
    ...structure.orphanFiles,
    ...map.routes.map((r) => r.file),
  ]);

  return [...candidates]
    .map((file) => scoreFileRisk(file, map, structure, context))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
