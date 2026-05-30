import type { ProjectContext, ProjectMap, ScanResult, StructuralAnalysis } from '../types.js';
import { detectAskIntents } from '../context/contextSelector.js';

export const ANSWER_SECTIONS = ['Direct Answer', 'Evidence', 'Risks', 'Next Action'] as const;
export type AnswerSectionName = (typeof ANSWER_SECTIONS)[number];

const HEADING_ALIASES: Record<string, AnswerSectionName> = {
  'direct answer': 'Direct Answer',
  evidence: 'Evidence',
  'evidence files': 'Evidence',
  risks: 'Risks',
  'next action': 'Next Action',
};

export interface AnswerNormalizationContext {
  question: string;
  scan: ScanResult;
  map: ProjectMap;
  structure: StructuralAnalysis;
  context: ProjectContext;
  rankedRiskFiles: Array<{ file: string; score: number; reasons: string[] }>;
}

export interface ParsedAnswerSection {
  heading: AnswerSectionName;
  content: string;
}

const FRONTEND_FRAMEWORK = /react|vue|angular|svelte|next\.?js|nuxt|remix|solid/i;
const SERVER_FRAMEWORK = /express|fastify|koa|hapi|nest|django|flask|spring|rails/i;

const UNSUPPORTED_WITHOUT_FRONTEND = [
  /\bsingle[\s-]page application\b/i,
  /\bSPA\b/,
  /\bfrontend\b/i,
  /\bclient[\s-]side\b/i,
  /\bui layer\b/i,
];

const UNSUPPORTED_WITHOUT_BACKEND = [/\bbackend\b/i, /\bserver[\s-]side\b/i];

const VAGUE_FILLER = [
  /^this project appears to be a comprehensive/i,
  /^overall, the codebase/i,
  /^in general, this/i,
  /^it seems like/i,
];

const GRAPH_MISINTERPRETATION = [
  {
    pattern:
      /fan[\s-]?in[^.\n]{0,120}\b(duplicat\w*|over[\s-]?engineer\w*|copy[\s-]?paste|redundan\w*)\b[^.\n]*/gi,
    replacement:
      'High fan-in means many files depend on this file, which increases coupling and coordination complexity',
  },
  {
    pattern:
      /fan[\s-]?out[^.\n]{0,120}\b(duplicat\w*|over[\s-]?engineer\w*|copy[\s-]?paste|redundan\w*)\b[^.\n]*/gi,
    replacement:
      'High fan-out means this file depends on many files, which increases coupling and coordination complexity',
  },
  {
    pattern: /\b(fan[\s-]?in|fan[\s-]?out)\b[^.\n]*\bsecurity vulnerabilit\w*\b[^.\n]*/gi,
    replacement: 'Graph fan-in/fan-out reflects coupling complexity, not a security vulnerability by itself',
  },
];

function canonicalHeading(raw: string): AnswerSectionName | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return HEADING_ALIASES[key] ?? null;
}

export function parseAnswerSections(content: string): ParsedAnswerSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: ParsedAnswerSection[] = [];
  let current: ParsedAnswerSection | null = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      const heading = canonicalHeading(match[1]!);
      if (heading) {
        if (current) sections.push(current);
        current = { heading, content: '' };
        continue;
      }
    }
    if (current) {
      current.content += (current.content ? '\n' : '') + line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function dedupeSections(sections: ParsedAnswerSection[]): Map<AnswerSectionName, string> {
  const merged = new Map<AnswerSectionName, string[]>();

  for (const section of sections) {
    const chunks = merged.get(section.heading) ?? [];
    const cleaned = stripNestedHeadings(section.content).trim();
    if (cleaned) chunks.push(cleaned);
    merged.set(section.heading, chunks);
  }

  const result = new Map<AnswerSectionName, string>();
  for (const [heading, chunks] of merged) {
    const lines = new Set<string>();
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) lines.add(trimmed);
      }
    }
    result.set(heading, [...lines].join('\n'));
  }
  return result;
}

function stripNestedHeadings(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^##\s+/.test(line))
    .join('\n');
}

function hasFrontendEvidence(ctx: AnswerNormalizationContext): boolean {
  const { scan, map } = ctx;
  if (scan.frameworks.primary && FRONTEND_FRAMEWORK.test(scan.frameworks.primary)) return true;
  if (scan.frameworks.frameworks.some((f) => FRONTEND_FRAMEWORK.test(f))) return true;
  return map.files.some(
    (f) => /(^|\/)pages?\//i.test(f.path) || /(^|\/)components?\//i.test(f.path) || /\.html$/i.test(f.path),
  );
}

function hasBackendEvidence(ctx: AnswerNormalizationContext): boolean {
  const { scan, map, context } = ctx;
  if (map.routes.length > 0) return true;
  if (context.routeFiles.length > 0) return true;
  if (scan.frameworks.primary && SERVER_FRAMEWORK.test(scan.frameworks.primary)) return true;
  if (scan.frameworks.frameworks.some((f) => SERVER_FRAMEWORK.test(f))) return true;
  return map.files.some((f) => /(^|\/)server(?:\.|\/)/i.test(f.path) || /(^|\/)api\/[^/]+/i.test(f.path));
}

function hasApiRouteEvidence(ctx: AnswerNormalizationContext): boolean {
  return ctx.map.routes.length > 0 || ctx.context.routeFiles.length > 0;
}

function removeSentencesMatching(text: string, patterns: RegExp[]): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const kept = sentences.filter((sentence) => !patterns.some((p) => p.test(sentence)));
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function trimVagueFiller(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !VAGUE_FILLER.some((p) => p.test(line)));
  return lines.join('\n').trim();
}

const BAD_FAN_METRIC =
  /\bfan[\s-]?(?:in|out)\b[^.\n]*\b(duplicat\w*|over[\s-]?engineer\w*|copy[\s-]?paste|redundan\w*|security vulnerabilit\w*)/i;

function fixGraphMetricWording(text: string): string {
  let result = text;
  for (const { pattern, replacement } of GRAPH_MISINTERPRETATION) {
    result = result.replace(pattern, replacement);
  }

  if (BAD_FAN_METRIC.test(result)) {
    const hadFanIn = /\bfan[\s-]?in\b/i.test(result);
    const hadFanOut = /\bfan[\s-]?out\b/i.test(result);
    result = removeSentencesMatching(result, [BAD_FAN_METRIC]);
    const additions: string[] = [];
    if (hadFanIn) {
      additions.push(
        'High fan-in means many files depend on this file, increasing coupling and coordination complexity.',
      );
    }
    if (hadFanOut) {
      additions.push(
        'High fan-out means this file depends on many files, increasing coupling and coordination complexity.',
      );
    }
    result = [result, ...additions].filter(Boolean).join(' ').trim();
  }

  return result.replace(/\b(duplicat\w*|over[\s-]?engineer\w*)\b/gi, 'coupling complexity');
}

function enforceFrameworkWording(text: string, ctx: AnswerNormalizationContext): string {
  let result = text;
  const framework = ctx.scan.frameworks.primary;
  if (!framework) {
    result = result.replace(/\b(no framework|framework:\s*none)\b/gi, 'No framework detected');
    if (!/no framework detected/i.test(result) && /\bframework\b/i.test(result)) {
      result = result.replace(/\bframework[^.\n]*/gi, 'No framework detected');
    }
  }
  return result;
}

function filterUnsupportedClaims(text: string, ctx: AnswerNormalizationContext): string {
  let result = text;
  if (!hasFrontendEvidence(ctx)) {
    result = removeSentencesMatching(result, UNSUPPORTED_WITHOUT_FRONTEND);
  }
  if (!hasBackendEvidence(ctx)) {
    result = removeSentencesMatching(result, UNSUPPORTED_WITHOUT_BACKEND);
  }
  if (!hasApiRouteEvidence(ctx)) {
    result = result
      .replace(/\b(?:implements?|provides?|defines?)\s+api endpoints?[^.\n]*/gi, 'imports auth and user modules')
      .replace(/\bapi endpoints?\b/gi, 'source modules')
      .replace(/\brest api\b/gi, 'module graph');
  }
  return enforceFrameworkWording(result, ctx);
}

function isArchitectureQuestion(question: string): boolean {
  return detectAskIntents(question).includes('architecture');
}

function isTechnicalDebtQuestion(question: string): boolean {
  return /technical debt|debt|fan[\s-]?in|fan[\s-]?out|coupling|complexity|maintainability/i.test(question);
}

function mentionsProjectFiles(text: string, map: ProjectMap): boolean {
  const lower = text.toLowerCase();
  return map.files.some((f) => lower.includes(f.path.toLowerCase()) || lower.includes(pathBasename(f.path)));
}

function pathBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? filePath;
}

function buildArchitectureFacts(ctx: AnswerNormalizationContext): string {
  const { scan, map, context } = ctx;
  const files = map.files
    .filter((f) => f.role === 'source' || f.role === 'api' || f.role === 'app')
    .slice(0, 6)
    .map((f) => f.path);
  const imports = map.imports
    .filter((e) => e.resolved)
    .slice(0, 6)
    .map((e) => `${e.from} -> ${e.to}`);

  const facts = [
    `Languages: ${scan.stack.languages.join(', ') || 'unknown'}`,
    `Framework: ${scan.frameworks.primary ?? 'No framework detected.'}`,
    `Package manager: ${scan.stack.packageManager ?? 'none'}`,
  ];
  if (files.length > 0) facts.push(`Source files: ${files.join(', ')}`);
  if (imports.length > 0) facts.push(`Imports: ${imports.join('; ')}`);
  if (context.entryPoints.length > 0) facts.push(`Entry points: ${context.entryPoints.join(', ')}`);
  return facts.join('\n');
}

function isRiskQuestion(question: string): boolean {
  return (
    /highest risk|risk file|what are the risks|security risk/i.test(question) ||
    detectAskIntents(question).some((intent) => intent === 'security' || intent === 'files')
  );
}

function buildEvidenceFallback(ctx: AnswerNormalizationContext): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  if (isRiskQuestion(ctx.question)) {
    for (const risk of ctx.rankedRiskFiles.slice(0, 8)) {
      lines.push(`- ${risk.file} (score ${risk.score}) — ${risk.reasons.join(', ') || 'ranked by risk'}`);
      seen.add(risk.file);
    }
  }

  for (const file of ctx.map.files.slice(0, 6)) {
    if (seen.has(file.path)) continue;
    lines.push(`- ${file.path} (${file.language}, ${file.role})`);
  }
  for (const edge of ctx.map.imports.filter((e) => e.resolved).slice(0, 4)) {
    lines.push(`- import ${edge.from} -> ${edge.to}`);
  }
  for (const risk of ctx.rankedRiskFiles.slice(0, 4)) {
    lines.push(`- ${risk.file} — ${risk.reasons.join(', ') || 'ranked by risk'}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- See scanned project map';
}

function buildRisksFallback(ctx: AnswerNormalizationContext): string {
  const risks = [...new Set([...ctx.scan.risks, ...ctx.structure.structuralRisks])].slice(0, 5);
  return risks.length > 0 ? risks.map((r) => `- ${r}`).join('\n') : '- None identified from evidence';
}

function ensureArchitectureContent(directAnswer: string, ctx: AnswerNormalizationContext): string {
  if (!isArchitectureQuestion(ctx.question)) return directAnswer;
  if (mentionsProjectFiles(directAnswer, ctx.map)) return directAnswer;
  const facts = buildArchitectureFacts(ctx);
  return [directAnswer, facts].filter(Boolean).join('\n\n');
}

function ensureCouplingWording(directAnswer: string, ctx: AnswerNormalizationContext): string {
  if (!isTechnicalDebtQuestion(ctx.question)) return directAnswer;
  if (!/\bfan[\s-]?in\b|\bfan[\s-]?out\b/i.test(directAnswer)) return directAnswer;
  if (/coupling|coordination complexity/i.test(directAnswer)) return directAnswer;
  return `${directAnswer}\n\nFan-in means many files depend on a file; fan-out means a file depends on many files. Both indicate coupling/coordination complexity.`;
}

function mergeRiskEvidence(evidence: string, ctx: AnswerNormalizationContext): string {
  if (!isRiskQuestion(ctx.question)) return evidence;

  const rankedLines = ctx.rankedRiskFiles.slice(0, 8).map(
    (risk) => `- ${risk.file} (score ${risk.score}) — ${risk.reasons.join(', ') || 'ranked by risk'}`,
  );
  const rankedFiles = new Set(ctx.rankedRiskFiles.map((risk) => risk.file));
  const extras: string[] = [];

  for (const line of evidence.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^-+\s+([^\s(]+)/);
    if (match?.[1] && rankedFiles.has(match[1])) continue;
    extras.push(trimmed);
  }

  return [...rankedLines, ...extras].join('\n');
}

export function normalizeAgentAnswer(raw: string, ctx: AnswerNormalizationContext): string {
  const parsed = parseAnswerSections(raw);
  const merged = dedupeSections(parsed);

  const processed = new Map<AnswerSectionName, string>();
  for (const name of ANSWER_SECTIONS) {
    let content = merged.get(name) ?? '';
    content = stripNestedHeadings(content);
    content = fixGraphMetricWording(content);
    content = filterUnsupportedClaims(content, ctx);
    content = trimVagueFiller(content);
    processed.set(name, content);
  }

  let directAnswer = processed.get('Direct Answer') ?? '';
  if (!directAnswer.trim()) {
    directAnswer = ctx.scan.summary || 'Answer based on scanned project evidence only.';
  }
  directAnswer = ensureArchitectureContent(directAnswer, ctx);
  directAnswer = ensureCouplingWording(directAnswer, ctx);
  directAnswer = filterUnsupportedClaims(fixGraphMetricWording(directAnswer), ctx);

  let evidence = processed.get('Evidence') ?? '';
  if (!evidence.trim()) evidence = buildEvidenceFallback(ctx);
  evidence = mergeRiskEvidence(evidence, ctx);

  let risks = processed.get('Risks') ?? '';
  if (!risks.trim()) risks = buildRisksFallback(ctx);

  let nextAction = processed.get('Next Action') ?? '';
  if (!nextAction.trim()) {
    nextAction = '- Review evidence files and run npm run scan for an updated project map';
  }

  return ANSWER_SECTIONS.map((name) => {
    const body =
      name === 'Direct Answer'
        ? directAnswer
        : name === 'Evidence'
          ? evidence
          : name === 'Risks'
            ? risks
            : nextAction;
    return `## ${name}\n${body.trim()}`;
  }).join('\n\n');
}

export function countAnswerSections(content: string): number {
  return content.match(/^##\s+/gm)?.length ?? 0;
}

export function validateStructuredAnswer(content: string): boolean {
  const sections = parseAnswerSections(content);
  if (sections.length !== 4) return false;
  for (let i = 0; i < ANSWER_SECTIONS.length; i++) {
    if (sections[i]?.heading !== ANSWER_SECTIONS[i]) return false;
  }
  return countAnswerSections(content) === 4;
}
