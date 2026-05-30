import type Database from 'better-sqlite3';
import type { SymbolEntry } from '../types.js';
import { getDatabase } from '../database/db.js';
import { getProjectIdByRoot, querySymbols, type SymbolQueryOptions } from '../database/queries.js';

export interface SearchSymbolsOptions extends SymbolQueryOptions {
  rootPath: string;
}

export interface SearchSymbolsResult {
  query: SearchSymbolsOptions;
  results: SymbolEntry[];
  total: number;
}

export interface SearchSymbolsDbResult {
  query: SymbolQueryOptions;
  results: SymbolEntry[];
  total: number;
}

export function searchSymbolsInDb(
  db: Database.Database,
  projectId: number,
  options: SymbolQueryOptions = {},
): SearchSymbolsDbResult {
  const results = querySymbols(db, projectId, options);
  return { query: options, results, total: results.length };
}

export function searchSymbolsTool(options: SearchSymbolsOptions): SearchSymbolsResult {
  const { rootPath, ...queryOptions } = options;
  const db = getDatabase();
  const projectId = getProjectIdByRoot(rootPath);

  if (projectId === null) {
    return { query: options, results: [], total: 0 };
  }

  const result = searchSymbolsInDb(db, projectId, queryOptions);
  return {
    query: { rootPath, ...queryOptions },
    results: result.results,
    total: result.total,
  };
}
