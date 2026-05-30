import type { ProjectContext, ProjectMap, ScanResult, StructuralAnalysis } from '../types.js';
import { buildProjectContext } from '../context/contextBuilder.js';
import { buildOptimizedPromptContext, detectAskIntents } from '../context/contextSelector.js';
import { analyzeStructure } from '../analyzer/structuralAnalyzer.js';
import { loadLatestScan, loadProjectMap, saveScanResult } from '../memory/projectMemory.js';
import { scanProject } from '../scanner/projectScanner.js';
import { loadConfig } from '../security/pathGuard.js';
import type { EvidenceBundle, ToolExecutionResult } from './types.js';
import { rankFilesByRisk } from './riskRanker.js';

export async function loadProjectEvidence(projectRoot: string) {
  let scan = loadLatestScan(projectRoot);
  let map = loadProjectMap(projectRoot);
  if (!scan || !map) {
    const result = await scanProject(projectRoot);
    scan = result.scan;
    map = result.projectMap;
    saveScanResult(scan, map);
  }
  const structure = analyzeStructure(map);
  const context = buildProjectContext(scan, map, structure.circularImports.flat());
  return { scan, map, structure, context };
}

export function collectBaseEvidence(
  question: string,
  scan: ScanResult,
  map: ProjectMap,
  structure: StructuralAnalysis,
  context: ProjectContext,
): Pick<EvidenceBundle, 'question' | 'intents' | 'baseContext' | 'sectionsIncluded' | 'rankedRiskFiles'> {
  const aiConfig = loadConfig().ai;
  const packed = buildOptimizedPromptContext(question, scan, map, context, structure, aiConfig);
  const rankedRiskFiles = rankFilesByRisk(map, structure, context);

  return {
    question,
    intents: detectAskIntents(question),
    baseContext: packed.context,
    sectionsIncluded: packed.sectionsIncluded,
    rankedRiskFiles,
  };
}

export function mergeEvidence(
  base: ReturnType<typeof collectBaseEvidence>,
  toolResults: ToolExecutionResult[],
  fileSnippets: EvidenceBundle['fileSnippets'],
): EvidenceBundle {
  return {
    ...base,
    toolResults,
    fileSnippets,
  };
}

export function formatEvidenceForPrompt(evidence: EvidenceBundle): string {
  const parts = [
    evidence.baseContext,
    '',
    '## Risk-ranked files',
    ...evidence.rankedRiskFiles.slice(0, 8).map(
      (r) => `- ${r.file} (score ${r.score}) — ${r.reasons.join(', ') || 'general'}`,
    ),
  ];

  if (evidence.fileSnippets.length > 0) {
    parts.push('', '## Selected file excerpts');
    for (const snippet of evidence.fileSnippets.slice(0, 5)) {
      parts.push(`### ${snippet.file}`, snippet.excerpt);
    }
  }

  if (evidence.toolResults.length > 0) {
    parts.push('', '## Tool results');
    for (const result of evidence.toolResults) {
      parts.push(
        `### ${result.tool} (${result.success ? 'ok' : 'error'}${result.autoExecuted ? ', auto' : ''})`,
        result.error ?? JSON.stringify(result.data ?? {}, null, 2).slice(0, 2000),
      );
      if (result.pendingOperationId) {
        parts.push(`Pending operation: ${result.pendingOperationId}`);
      }
    }
  }

  return parts.join('\n');
}
