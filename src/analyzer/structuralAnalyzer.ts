import type {
  GraphNodeMetric,
  ImportEdge,
  ProjectMap,
  StructuralAnalysis,
} from '../types.js';

const LARGE_FILE_LINES = 500;
const METRIC_TOP_N = 5;

function resolvedEdges(map: ProjectMap): ImportEdge[] {
  return map.imports.filter((e) => e.resolved);
}

function buildAdjacency(edges: ImportEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge.to);
    adj.set(edge.from, list);
    if (!adj.has(edge.to)) adj.set(edge.to, []);
  }
  return adj;
}

export function detectCircularImports(map: ProjectMap): string[][] {
  const edges = resolvedEdges(map);
  const adj = buildAdjacency(edges);
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const next of adj.get(node) ?? []) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (stack.has(next)) {
        const start = path.indexOf(next);
        if (start >= 0) {
          const cycle = path.slice(start);
          if (cycle.length > 1) {
            const key = [...cycle].sort().join('->');
            const exists = cycles.some((c) => [...c].sort().join('->') === key);
            if (!exists) cycles.push([...cycle]);
          }
        }
      }
    }

    path.pop();
    stack.delete(node);
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node);
  }

  return cycles;
}

function flattenCycleFiles(cycles: string[][]): string[] {
  return [...new Set(cycles.flat())];
}

export function detectOrphanFiles(map: ProjectMap): string[] {
  const codeRoles = new Set(['source', 'app', 'page', 'component', 'api']);
  const codeFiles = map.files.filter((f) => codeRoles.has(f.role)).map((f) => f.path);

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const file of codeFiles) {
    incoming.set(file, 0);
    outgoing.set(file, 0);
  }

  for (const edge of resolvedEdges(map)) {
    if (incoming.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    if (outgoing.has(edge.from)) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  const entrySet = new Set(map.graph.nodes.filter((n) => map.routes.some((r) => r.file === n)));

  return codeFiles.filter((file) => {
    const inCount = incoming.get(file) ?? 0;
    const outCount = outgoing.get(file) ?? 0;
    if (entrySet.has(file)) return false;
    return inCount === 0 && outCount === 0;
  });
}

export function detectDeadModules(map: ProjectMap, orphans: string[]): string[] {
  const exportedFiles = new Set(map.exports.map((e) => e.file));
  return orphans.filter((file) => !exportedFiles.has(file));
}

function computeFanMetrics(map: ProjectMap): { fanIn: GraphNodeMetric[]; fanOut: GraphNodeMetric[] } {
  const inCounts = new Map<string, number>();
  const outCounts = new Map<string, number>();

  for (const node of map.graph.nodes) {
    inCounts.set(node, 0);
    outCounts.set(node, 0);
  }

  for (const edge of resolvedEdges(map)) {
    outCounts.set(edge.from, (outCounts.get(edge.from) ?? 0) + 1);
    inCounts.set(edge.to, (inCounts.get(edge.to) ?? 0) + 1);
  }

  const fanIn = [...inCounts.entries()]
    .map(([file, fanIn]) => ({ file, fanIn, fanOut: outCounts.get(file) ?? 0 }))
    .filter((m) => m.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, METRIC_TOP_N);

  const fanOut = [...outCounts.entries()]
    .map(([file, fanOut]) => ({ file, fanIn: inCounts.get(file) ?? 0, fanOut }))
    .filter((m) => m.fanOut > 0)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, METRIC_TOP_N);

  return { fanIn, fanOut };
}

function detectDuplicateRoles(map: ProjectMap): StructuralAnalysis['duplicateRoles'] {
  const byRole = new Map<string, string[]>();
  for (const file of map.files) {
    const list = byRole.get(file.role) ?? [];
    list.push(file.path);
    byRole.set(file.role, list);
  }

  return [...byRole.entries()]
    .filter(([, files]) => files.length > 3)
    .map(([role, files]) => ({ role, count: files.length, files: files.slice(0, 5) }))
    .sort((a, b) => b.count - a.count);
}

function buildRecommendedActions(analysis: Omit<StructuralAnalysis, 'recommendedActions' | 'structuralRisks'>): string[] {
  const actions: string[] = [];
  if (analysis.circularImports.length > 0) actions.push('Break circular import chains between coupled modules');
  if (analysis.unresolvedImports.length > 0) actions.push('Fix unresolved local imports or update path aliases');
  if (analysis.orphanFiles.length > 0) actions.push('Review orphan files and remove or wire them into the graph');
  if (analysis.largeFiles.length > 0) actions.push('Split large files into smaller focused modules');
  if (analysis.deadModules.length > 0) actions.push('Delete or integrate unused dead modules');
  if (analysis.highFanIn.length > 0) actions.push('Reduce coupling to high fan-in hub files');
  return actions;
}

function buildStructuralRisks(analysis: Omit<StructuralAnalysis, 'recommendedActions' | 'structuralRisks'>): string[] {
  const risks: string[] = [];
  if (analysis.circularImports.length > 0) {
    risks.push(`${analysis.circularImports.length} circular import chain(s) detected`);
  }
  if (analysis.unresolvedImports.length > 0) {
    risks.push(`${analysis.unresolvedImports.length} unresolved import(s)`);
  }
  if (analysis.orphanFiles.length > 0) {
    risks.push(`${analysis.orphanFiles.length} orphan file(s) with no graph connections`);
  }
  if (analysis.largeFiles.length > 0) {
    risks.push(`${analysis.largeFiles.length} large file(s) exceed ${LARGE_FILE_LINES} lines`);
  }
  if (analysis.deadModules.length > 0) {
    risks.push(`${analysis.deadModules.length} possible dead module(s)`);
  }
  return risks;
}

export function analyzeStructure(map: ProjectMap): StructuralAnalysis {
  const circularImports = detectCircularImports(map);
  const orphanFiles = detectOrphanFiles(map);
  const unresolvedImports = map.imports.filter((e) => !e.resolved && e.spec.startsWith('.'));
  const largeFiles = map.files.filter(
    (f) => f.lineCount > LARGE_FILE_LINES && !f.path.endsWith('package-lock.json'),
  );
  const { fanIn, fanOut } = computeFanMetrics(map);
  const deadModules = detectDeadModules(map, orphanFiles);
  const duplicateRoles = detectDuplicateRoles(map);

  const partial = {
    circularImports,
    orphanFiles,
    unresolvedImports,
    largeFiles,
    highFanIn: fanIn,
    highFanOut: fanOut,
    deadModules,
    routeSummary: map.routes,
    apiSurface: map.apiCalls,
    graphDepth: map.stats.depth,
    duplicateRoles,
  };

  return {
    ...partial,
    recommendedActions: buildRecommendedActions(partial),
    structuralRisks: buildStructuralRisks(partial),
  };
}

export function flattenCycleList(cycles: string[][]): string[] {
  return flattenCycleFiles(cycles);
}

export function formatCycle(cycle: string[]): string {
  return cycle.join(' -> ') + ` -> ${cycle[0]}`;
}
