import type { ProjectContext, ProjectMap, ScanResult } from '../types.js';

const LARGE_FILE_LINES = 500;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function pickImportantFiles(scan: ScanResult, map: ProjectMap): string[] {
  const files = new Set<string>();
  for (const ep of scan.stack.entryPoints) files.add(ep);
  for (const route of map.routes) files.add(route.file);
  for (const file of map.files) {
    if (['manifest', 'config', 'app', 'page', 'api'].includes(file.role)) {
      files.add(file.path);
    }
  }
  return [...files].slice(0, 20);
}

function pickHighRiskFiles(map: ProjectMap, circularFiles: string[]): string[] {
  const risks = new Set<string>();
  for (const file of map.files) {
    if (file.lineCount > LARGE_FILE_LINES) risks.add(file.path);
  }
  for (const file of circularFiles) risks.add(file);
  return [...risks].slice(0, 15);
}

export function buildProjectContext(scan: ScanResult, map: ProjectMap, circularFiles: string[] = []): ProjectContext {
  const routeFiles = unique(map.routes.map((r) => r.file));
  const configFiles = map.files.filter((f) => f.role === 'config' || f.role === 'manifest').map((f) => f.path);
  const schemaFiles = map.schemas.map((s) => s.file);

  return {
    projectName: scan.name,
    rootPath: scan.rootPath,
    scannedAt: scan.scannedAt,
    summary: scan.summary,
    stack: scan.stack,
    frameworks: scan.frameworks,
    healthScore: scan.healthScore,
    complexityScore: scan.complexityScore,
    importantFiles: pickImportantFiles(scan, map),
    entryPoints: scan.stack.entryPoints,
    routeFiles,
    configFiles,
    schemaFiles: unique(schemaFiles),
    highRiskFiles: pickHighRiskFiles(map, circularFiles),
    stats: map.stats,
  };
}

export function summarizeContext(context: ProjectContext): string {
  return [
    context.summary,
    `Framework: ${context.frameworks.primary ?? 'none'}`,
    `Files: ${context.stats.fileCount}, Symbols: ${context.stats.symbolCount}, Depth: ${context.stats.depth}`,
    `Entry points: ${context.entryPoints.length}, Routes: ${context.stats.routeCount}`,
  ].join(' | ');
}
