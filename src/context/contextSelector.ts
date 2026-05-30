import type { AiConfig } from '../security/pathGuard.js';
import type { ProjectContext, ProjectMap, ScanResult, StructuralAnalysis, SymbolEntry } from '../types.js';
import { formatCycle } from '../analyzer/structuralAnalyzer.js';
import { summarizeContext } from './contextBuilder.js';

export type AskIntent =
  | 'overview'
  | 'architecture'
  | 'security'
  | 'files'
  | 'symbols'
  | 'routes'
  | 'database'
  | 'errors'
  | 'general';

export interface ContextLimits {
  maxRankedFiles: number;
  maxSymbols: number;
  maxRoutes: number;
  maxImportEdges: number;
  maxRisks: number;
  maxDependencies: number;
  maxCircularImports: number;
}

export interface ContextPackResult {
  context: string;
  intents: AskIntent[];
  sectionsIncluded: string[];
  contextChars: number;
  truncated: boolean;
  rankedFiles: string[];
}

const DEFAULT_LIMITS: ContextLimits = {
  maxRankedFiles: 12,
  maxSymbols: 15,
  maxRoutes: 8,
  maxImportEdges: 12,
  maxRisks: 6,
  maxDependencies: 8,
  maxCircularImports: 3,
};

export function getContextLimits(config: AiConfig): ContextLimits {
  return { ...DEFAULT_LIMITS, ...(config.contextLimits ?? {}) };
}

export function detectAskIntents(question: string): AskIntent[] {
  const q = question.toLowerCase();
  const intents = new Set<AskIntent>();

  if (/architecture|structure|design|layer|module|organiz/.test(q)) intents.add('architecture');
  if (/security|risk|vulner|danger|secret|credential/.test(q)) intents.add('security');
  if (/file|folder|directory|path|highest risk file/.test(q)) intents.add('files');
  if (/symbol|function|class|component|export|import graph/.test(q)) intents.add('symbols');
  if (/route|api|endpoint|surface|handler/.test(q)) intents.add('routes');
  if (/database|schema|sql|prisma|drizzle|table/.test(q)) intents.add('database');
  if (/error|bug|issue|circular|orphan|unresolved|dead module/.test(q)) intents.add('errors');
  if (/what does|overview|purpose|about this project|project do/.test(q)) intents.add('overview');

  if (intents.size === 0) intents.add('general');
  if (intents.has('overview') && intents.size > 1) {
    // keep overview plus specific intents
  } else if (intents.has('general')) {
    intents.add('overview');
  }

  return [...intents];
}

function scoreFile(path: string, question: string, context: ProjectContext, structure: StructuralAnalysis): number {
  let score = 0;
  const q = question.toLowerCase();
  const lowerPath = path.toLowerCase();

  if (context.entryPoints.includes(path)) score += 50;
  if (context.importantFiles.includes(path)) score += 30;
  if (context.highRiskFiles.includes(path)) score += 40;
  if (structure.highFanIn.some((m) => m.file === path)) score += 25;
  if (structure.orphanFiles.includes(path)) score += 20;
  if (structure.deadModules.includes(path)) score += 20;

  const tokens = q.split(/\s+/).filter((t) => t.length > 3);
  for (const token of tokens) {
    if (lowerPath.includes(token)) score += 15;
  }

  if (/risk|danger/.test(q) && context.highRiskFiles.includes(path)) score += 35;

  return score;
}

export function rankFilesByImportance(
  question: string,
  context: ProjectContext,
  map: ProjectMap,
  structure: StructuralAnalysis,
  limit: number,
): string[] {
  const candidates = new Set<string>([
    ...context.importantFiles,
    ...context.entryPoints,
    ...context.highRiskFiles,
    ...structure.orphanFiles.slice(0, 5),
    ...map.files.filter((f) => f.role !== 'other').map((f) => f.path),
  ]);

  return [...candidates]
    .map((file) => ({ file, score: scoreFile(file, question, context, structure) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.file);
}

function selectSymbols(question: string, map: ProjectMap, rankedFiles: string[], limit: number): SymbolEntry[] {
  const q = question.toLowerCase();
  const fileSet = new Set(rankedFiles);
  const relevant = map.symbols.filter((s) => fileSet.has(s.file) || s.name.toLowerCase().includes(q.slice(0, 8)));

  const scored = relevant.map((s) => {
    let score = fileSet.has(s.file) ? 10 : 0;
    if (s.name.toLowerCase().includes(q.split(' ')[0] ?? '')) score += 5;
    if (s.kind === 'function' || s.kind === 'class') score += 2;
    return { s, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  const suffix = '\n...[context truncated]';
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`, truncated: true };
}

function shouldInclude(section: string, intents: AskIntent[]): boolean {
  const map: Record<string, AskIntent[]> = {
    summary: ['overview', 'general', 'architecture'],
    stack: ['overview', 'architecture', 'general'],
    files: ['overview', 'files', 'architecture', 'security', 'general'],
    entryPoints: ['overview', 'architecture'],
    routes: ['routes', 'architecture', 'overview'],
    schemas: ['database', 'architecture'],
    graph: ['architecture', 'symbols', 'errors'],
    risks: ['security', 'errors', 'files', 'overview'],
    circular: ['errors', 'architecture'],
    dependencies: ['overview', 'architecture'],
    symbols: ['symbols', 'architecture'],
    imports: ['symbols', 'errors', 'architecture'],
    api: ['routes', 'architecture'],
  };
  const allowed = map[section] ?? ['general'];
  return intents.some((i) => allowed.includes(i));
}

export function buildOptimizedPromptContext(
  question: string,
  scan: ScanResult,
  map: ProjectMap,
  context: ProjectContext,
  structure: StructuralAnalysis,
  config: AiConfig,
): ContextPackResult {
  const limits = getContextLimits(config);
  const intents = detectAskIntents(question);
  const rankedFiles = rankFilesByImportance(question, context, map, structure, limits.maxRankedFiles);
  const sectionsIncluded: string[] = [];
  const parts: string[] = [];

  parts.push(`# Project: ${context.projectName}`);
  parts.push(`Path: ${context.rootPath}`);
  sectionsIncluded.push('header');

  if (shouldInclude('summary', intents)) {
    parts.push(summarizeContext(context));
    sectionsIncluded.push('summary');
  }

  if (shouldInclude('stack', intents)) {
    parts.push(
      '',
      '## Stack',
      `Languages: ${scan.stack.languages.join(', ') || 'unknown'}`,
      `Framework: ${context.frameworks.primary ?? 'none'}`,
      `Package manager: ${scan.stack.packageManager ?? 'none'}`,
    );
    sectionsIncluded.push('stack');
  }

  if (shouldInclude('files', intents)) {
    parts.push('', '## Ranked files (evidence)', ...rankedFiles.map((f) => `- ${f}`));
    sectionsIncluded.push('files');
  }

  if (shouldInclude('entryPoints', intents) && context.entryPoints.length > 0) {
    parts.push('', '## Entry points', ...context.entryPoints.slice(0, 5).map((f) => `- ${f}`));
    sectionsIncluded.push('entryPoints');
  }

  if (shouldInclude('routes', intents) && map.routes.length > 0) {
    parts.push(
      '',
      '## Routes',
      ...map.routes.slice(0, limits.maxRoutes).map((r) => `- ${r.method} ${r.path} (${r.file})`),
    );
    sectionsIncluded.push('routes');
  }

  if (shouldInclude('api', intents) && map.apiCalls.length > 0) {
    parts.push(
      '',
      '## API calls',
      ...map.apiCalls.slice(0, 5).map((a) => `- ${a.kind} ${a.file}:${a.line}`),
    );
    sectionsIncluded.push('api');
  }

  if (shouldInclude('schemas', intents) && context.schemaFiles.length > 0) {
    parts.push('', '## Schemas', ...context.schemaFiles.slice(0, 5).map((f) => `- ${f}`));
    sectionsIncluded.push('schemas');
  }

  if (shouldInclude('symbols', intents)) {
    const symbols = selectSymbols(question, map, rankedFiles, limits.maxSymbols);
    if (symbols.length > 0) {
      parts.push(
        '',
        '## Key symbols',
        ...symbols.map((s) => `- ${s.kind} ${s.name} (${s.file}:${s.line})`),
      );
      sectionsIncluded.push('symbols');
    }
  }

  if (shouldInclude('imports', intents)) {
    const fileSet = new Set(rankedFiles);
    const edges = map.imports
      .filter((e) => e.resolved && (fileSet.has(e.from) || fileSet.has(e.to)))
      .slice(0, limits.maxImportEdges);
    if (edges.length > 0) {
      parts.push('', '## Import edges', ...edges.map((e) => `- ${e.from} -> ${e.to}`));
      sectionsIncluded.push('imports');
    }
  }

  if (shouldInclude('graph', intents)) {
    parts.push(
      '',
      '## Graph stats',
      `Files: ${map.stats.fileCount}, Symbols: ${map.stats.symbolCount}, Depth: ${map.stats.depth}`,
    );
    sectionsIncluded.push('graph');
  }

  if (shouldInclude('risks', intents)) {
    const risks = [...new Set([...scan.risks, ...structure.structuralRisks])].slice(0, limits.maxRisks);
    parts.push('', '## Risks', ...(risks.length ? risks.map((r) => `- ${r}`) : ['- none']));
    if (context.highRiskFiles.length > 0 && intents.includes('security')) {
      parts.push('## High-risk files', ...context.highRiskFiles.slice(0, 8).map((f) => `- ${f}`));
    }
    sectionsIncluded.push('risks');
  }

  if (shouldInclude('circular', intents) && structure.circularImports.length > 0) {
    parts.push(
      '',
      '## Circular imports',
      ...structure.circularImports.slice(0, limits.maxCircularImports).map((c) => `- ${formatCycle(c)}`),
    );
    sectionsIncluded.push('circular');
  }

  if (shouldInclude('dependencies', intents)) {
    parts.push(
      '',
      '## Dependencies',
      ...map.dependencies
        .filter((d) => !d.dev)
        .slice(0, limits.maxDependencies)
        .map((d) => `- ${d.name}@${d.version}`),
    );
    sectionsIncluded.push('dependencies');
  }

  const joined = parts.join('\n');
  const { text, truncated } = truncate(joined, config.maxContextChars);

  return {
    context: text,
    intents,
    sectionsIncluded,
    contextChars: text.length,
    truncated,
    rankedFiles,
  };
}
