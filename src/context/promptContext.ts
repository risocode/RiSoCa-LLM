import type { AiConfig } from '../security/pathGuard.js';
import type { ProjectContext, ProjectMap, ScanResult, StructuralAnalysis } from '../types.js';
import { buildOptimizedPromptContext, type ContextPackResult } from './contextSelector.js';

/** @deprecated Use buildOptimizedPromptContext */
export function buildPromptContext(
  scan: ScanResult,
  map: ProjectMap,
  context: ProjectContext,
  structure: StructuralAnalysis,
  maxChars: number,
  question = 'What does this project do?',
): string {
  const config = { maxContextChars: maxChars } as AiConfig;
  return buildOptimizedPromptContext(question, scan, map, context, structure, config).context;
}

export function buildQuestionAwareContext(
  question: string,
  scan: ScanResult,
  map: ProjectMap,
  context: ProjectContext,
  structure: StructuralAnalysis,
  config: AiConfig,
): ContextPackResult {
  return buildOptimizedPromptContext(question, scan, map, context, structure, config);
}

export function getMaxContextChars(config: AiConfig): number {
  return config.maxContextChars;
}
