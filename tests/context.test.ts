import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildProjectContext } from '../src/context/contextBuilder.js';
import {
  analyzeStructure,
  detectCircularImports,
  detectOrphanFiles,
  formatCycle,
} from '../src/analyzer/structuralAnalyzer.js';
import { buildProjectMap } from '../src/indexer/projectMap.js';
import { createIgnoreFilter } from '../src/scanner/ignoreRules.js';
import { parsePackageJsonDependencies } from '../src/scanner/stackDetector.js';
import { scanProject } from '../src/scanner/projectScanner.js';
import { initializeSchema } from '../src/database/schema.js';
import { insertTestProject, insertTestSymbol, querySymbols } from '../src/database/queries.js';
import { searchSymbolsInDb } from '../src/tools/searchSymbolsTool.js';

const MINIMAL = path.join(import.meta.dirname, 'fixtures', 'minimal-project');
const CIRCULAR = path.join(import.meta.dirname, 'fixtures', 'circular-project');

function buildFixtureMap(fixtureRoot: string, files: string[]) {
  const ig = createIgnoreFilter(fixtureRoot);
  return buildProjectMap({
    rootPath: fixtureRoot,
    scannedAt: new Date().toISOString(),
    filePaths: files,
    dependencies: parsePackageJsonDependencies(fixtureRoot),
    ig,
  });
}

describe('contextBuilder', () => {
  it('builds compact project context from scan and map', async () => {
    const { scan, projectMap } = await scanProject(MINIMAL);
    const analysis = analyzeStructure(projectMap);
    const context = buildProjectContext(scan, projectMap, analysis.circularImports.flat());

    expect(context.projectName).toBe('minimal-project');
    expect(context.entryPoints.length).toBeGreaterThan(0);
    expect(context.routeFiles.length).toBeGreaterThan(0);
    expect(context.configFiles).toContain('package.json');
    expect(context.stats.symbolCount).toBeGreaterThan(0);
    expect(context.importantFiles.length).toBeGreaterThan(0);
  });
});

describe('structuralAnalyzer', () => {
  it('detects circular imports', () => {
    const map = buildFixtureMap(CIRCULAR, [
      'package.json',
      'src/main.ts',
      'src/a.ts',
      'src/b.ts',
      'src/orphan.ts',
      'src/broken-import.ts',
    ]);
    const cycles = detectCircularImports(map);
    expect(cycles.length).toBeGreaterThan(0);
    expect(formatCycle(cycles[0])).toContain('a.ts');
    expect(formatCycle(cycles[0])).toContain('b.ts');
  });

  it('detects orphan and unresolved imports', () => {
    const map = buildFixtureMap(CIRCULAR, [
      'package.json',
      'src/main.ts',
      'src/a.ts',
      'src/b.ts',
      'src/orphan.ts',
      'src/broken-import.ts',
    ]);
    const analysis = analyzeStructure(map);

    expect(analysis.orphanFiles).toContain('src/orphan.ts');
    expect(analysis.unresolvedImports.some((e) => e.from.includes('broken-import'))).toBe(true);
    expect(analysis.structuralRisks.length).toBeGreaterThan(0);
    expect(analysis.recommendedActions.length).toBeGreaterThan(0);
  });

  it('detects orphan files with no graph edges', () => {
    const map = buildFixtureMap(CIRCULAR, ['src/orphan.ts']);
    const orphans = detectOrphanFiles(map);
    expect(orphans).toContain('src/orphan.ts');
  });
});

describe('searchSymbolsTool', () => {
  it('searches symbols from sqlite with filters', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    const projectId = insertTestProject(db, '/tmp/test', 'test');

    insertTestSymbol(db, projectId, { name: 'helper', kind: 'function', file: 'src/a.ts', line: 1 });
    insertTestSymbol(db, projectId, { name: 'HelperService', kind: 'class', file: 'src/b.ts', line: 4 });
    insertTestSymbol(db, projectId, { name: 'other', kind: 'variable', file: 'src/c.ts', line: 2 });

    const byName = searchSymbolsInDb(db, projectId, { name: 'help' });
    expect(byName.total).toBe(2);

    const byKind = querySymbols(db, projectId, { kind: 'class' });
    expect(byKind).toHaveLength(1);
    expect(byKind[0].name).toBe('HelperService');

    const byFile = querySymbols(db, projectId, { filePath: 'src/a.ts' });
    expect(byFile).toHaveLength(1);

    db.close();
  });
});

describe('structuralAnalyzer metrics', () => {
  it('reports graph depth and route surface', async () => {
    const { projectMap } = await scanProject(MINIMAL);
    const analysis = analyzeStructure(projectMap);

    expect(analysis.graphDepth).toBeGreaterThanOrEqual(0);
    expect(analysis.routeSummary.length).toBeGreaterThan(0);
    expect(analysis.apiSurface.length).toBeGreaterThan(0);
  });
});
