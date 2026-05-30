import path from 'node:path';
import type { ImportEdge } from '../types.js';
import { isSensitivePath } from '../security/pathGuard.js';
import { readFileSafe } from '../utils/fileUtils.js';

const IMPORT_REGEX =
  /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveImport(fromFile: string, spec: string, allFiles: Set<string>): string | null {
  if (spec.startsWith('.')) {
    const dir = path.dirname(fromFile).replace(/\\/g, '/');
    let baseSpec = spec.replace(/\\/g, '/');
    if (baseSpec.endsWith('.js') || baseSpec.endsWith('.jsx')) {
      baseSpec = baseSpec.replace(/\.jsx?$/, '');
    }

    const candidates = [
      path.join(dir, baseSpec).replace(/\\/g, '/'),
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}.ts`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}.tsx`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}.js`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}.jsx`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}/index.ts`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}/index.tsx`,
      `${path.join(dir, baseSpec).replace(/\\/g, '/')}/index.js`,
      path.join(dir, spec).replace(/\\/g, '/'),
      `${path.join(dir, spec).replace(/\\/g, '/')}.ts`,
      `${path.join(dir, spec).replace(/\\/g, '/')}.tsx`,
    ];
    for (const candidate of candidates) {
      const normalized = candidate.replace(/\\/g, '/');
      if (allFiles.has(normalized)) return normalized;
    }
  }
  return null;
}

export function extractImports(content: string): string[] {
  const specs: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_REGEX.lastIndex = 0;
  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

export function buildDependencyGraph(
  rootPath: string,
  filePaths: string[],
): { imports: ImportEdge[]; depth: number } {
  const codeFiles = filePaths.filter((f) =>
    CODE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
  );
  const allFiles = new Set(codeFiles.map((f) => f.replace(/\\/g, '/')));
  const imports: ImportEdge[] = [];
  const adjacency = new Map<string, string[]>();

  for (const fromFile of codeFiles) {
    if (isSensitivePath(fromFile)) continue;
    const content = readFileSafe(rootPath, fromFile);
    if (!content) continue;

    const specs = extractImports(content);
    const targets: string[] = [];

    for (const spec of specs) {
      const resolved = resolveImport(fromFile, spec, allFiles);
      imports.push({
        from: fromFile.replace(/\\/g, '/'),
        to: resolved ?? spec,
        spec,
        resolved: resolved !== null,
      });
      if (resolved) targets.push(resolved);
    }

    adjacency.set(fromFile.replace(/\\/g, '/'), targets);
  }

  const depth = computeMaxDepth(adjacency);
  return { imports, depth };
}

function computeMaxDepth(adjacency: Map<string, string[]>): number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  function dfs(node: string): number {
    if (memo.has(node)) return memo.get(node)!;
    if (visiting.has(node)) return 0;
    visiting.add(node);
    const children = adjacency.get(node) ?? [];
    let maxChild = 0;
    for (const child of children) {
      maxChild = Math.max(maxChild, dfs(child));
    }
    visiting.delete(node);
    const depth = children.length === 0 ? 0 : maxChild + 1;
    memo.set(node, depth);
    return depth;
  }

  let maxDepth = 0;
  for (const node of adjacency.keys()) {
    maxDepth = Math.max(maxDepth, dfs(node));
  }
  return maxDepth;
}

export function buildGraphNodesEdges(imports: ImportEdge[]): { nodes: string[]; edges: ImportEdge[] } {
  const nodeSet = new Set<string>();
  for (const edge of imports) {
    nodeSet.add(edge.from);
    if (edge.resolved) nodeSet.add(edge.to);
  }
  return { nodes: [...nodeSet].sort(), edges: imports };
}
