import type { Ignore } from 'ignore';
import type { DependencyEntry, ProjectMap } from '../types.js';
import { indexDependencies, indexFiles } from './fileIndexer.js';
import { buildDependencyGraph, buildGraphNodesEdges } from './dependencyGraph.js';
import { indexSymbols } from './symbolIndexer.js';

export interface BuildProjectMapInput {
  rootPath: string;
  scannedAt: string;
  filePaths: string[];
  dependencies: DependencyEntry[];
  ig: Ignore;
}

export function buildProjectMap(input: BuildProjectMapInput): ProjectMap {
  const { rootPath, scannedAt, filePaths, dependencies, ig } = input;

  const { files, skippedCount } = indexFiles({ rootPath, filePaths, ig });
  const filePathList = files.map((f) => f.path);
  const symbolResult = indexSymbols(rootPath, filePathList);
  const { imports, depth } = buildDependencyGraph(rootPath, filePathList);
  const graph = buildGraphNodesEdges(imports);
  const deps = indexDependencies(rootPath, dependencies);

  return {
    rootPath,
    scannedAt,
    files,
    symbols: symbolResult.symbols,
    imports,
    exports: symbolResult.exports,
    routes: symbolResult.routes,
    apiCalls: symbolResult.apiCalls,
    schemas: symbolResult.schemas,
    dependencies: deps,
    graph,
    stats: {
      fileCount: files.length,
      symbolCount: symbolResult.symbols.length,
      routeCount: symbolResult.routes.length,
      depth,
      skippedCount,
    },
  };
}

export function serializeProjectMap(map: ProjectMap): string {
  return JSON.stringify(map, null, 2);
}
