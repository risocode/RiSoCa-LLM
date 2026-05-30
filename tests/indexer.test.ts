import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, extractImports } from '../src/indexer/dependencyGraph.js';
import { indexSymbols } from '../src/indexer/symbolIndexer.js';
import { buildProjectMap } from '../src/indexer/projectMap.js';
import { createIgnoreFilter } from '../src/scanner/ignoreRules.js';
import { parsePackageJsonDependencies } from '../src/scanner/stackDetector.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

describe('indexer', () => {
  it('extracts imports from TypeScript', () => {
    const content = `import express from 'express';\nimport { helper } from './utils/helper.js';`;
    const specs = extractImports(content);
    expect(specs).toContain('express');
    expect(specs).toContain('./utils/helper.js');
  });

  it('indexes symbols including classes and functions', () => {
    const files = ['src/index.ts', 'src/utils/helper.ts'];
    const result = indexSymbols(FIXTURE, files);
    expect(result.symbols.some((s) => s.name === 'helper')).toBe(true);
    expect(result.symbols.some((s) => s.name === 'HelperService')).toBe(true);
  });

  it('builds resolved import graph', () => {
    const files = ['src/index.ts', 'src/utils/helper.ts'];
    const { imports } = buildDependencyGraph(FIXTURE, files);
    const resolved = imports.filter((e) => e.resolved);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((e) => e.to.includes('helper'))).toBe(true);
  });

  it('builds complete project map', () => {
    const ig = createIgnoreFilter(FIXTURE);
    const files = ['package.json', 'README.md', 'src/index.ts', 'src/utils/helper.ts'];
    const map = buildProjectMap({
      rootPath: FIXTURE,
      scannedAt: new Date().toISOString(),
      filePaths: files,
      dependencies: parsePackageJsonDependencies(FIXTURE),
      ig,
    });

    expect(map.files.length).toBe(4);
    expect(map.symbols.length).toBeGreaterThan(0);
    expect(map.routes.length).toBeGreaterThan(0);
    expect(map.dependencies.some((d) => d.name === 'express')).toBe(true);
    expect(map.graph.nodes.length).toBeGreaterThan(0);
  });
});
