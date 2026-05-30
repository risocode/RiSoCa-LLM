import type Database from 'better-sqlite3';
import type { ImportEdge, SymbolEntry } from '../types.js';
import { getDatabase } from './db.js';

export function getProjectIdByRoot(rootPath: string): number | null {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM projects WHERE root_path = ?').get(rootPath) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

export interface SymbolQueryOptions {
  name?: string;
  kind?: SymbolEntry['kind'];
  filePath?: string;
  limit?: number;
}

export function querySymbols(
  db: Database.Database,
  projectId: number,
  options: SymbolQueryOptions = {},
): SymbolEntry[] {
  const { name, kind, filePath, limit = 50 } = options;
  const conditions = ['project_id = @project_id'];
  const params: Record<string, unknown> = { project_id: projectId, limit };

  if (name) {
    conditions.push('name LIKE @name');
    params.name = `%${name}%`;
  }
  if (kind) {
    conditions.push('kind = @kind');
    params.kind = kind;
  }
  if (filePath) {
    conditions.push('file_path LIKE @file_path');
    params.file_path = `%${filePath}%`;
  }

  const sql = `
    SELECT file_path AS file, name, kind, line
    FROM symbols
    WHERE ${conditions.join(' AND ')}
    ORDER BY file_path, line
    LIMIT @limit
  `;

  return db.prepare(sql).all(params) as SymbolEntry[];
}

export function queryImportEdges(db: Database.Database, projectId: number): ImportEdge[] {
  const rows = db
    .prepare(
      'SELECT from_path AS "from", to_path AS "to", spec, resolved FROM import_edges WHERE project_id = ?',
    )
    .all(projectId) as Array<{ from: string; to: string; spec: string; resolved: number }>;

  return rows.map((row) => ({
    from: row.from,
    to: row.to,
    spec: row.spec,
    resolved: row.resolved === 1,
  }));
}

export function insertTestSymbol(
  db: Database.Database,
  projectId: number,
  symbol: SymbolEntry,
): void {
  db.prepare(
    'INSERT INTO symbols (project_id, file_path, name, kind, line) VALUES (?, ?, ?, ?, ?)',
  ).run(projectId, symbol.file, symbol.name, symbol.kind, symbol.line);
}

export function insertTestProject(db: Database.Database, rootPath: string, name: string): number {
  db.prepare(
    'INSERT INTO projects (root_path, name, fingerprint, last_scanned_at) VALUES (?, ?, ?, ?)',
  ).run(rootPath, name, 'test', new Date().toISOString());
  const row = db.prepare('SELECT id FROM projects WHERE root_path = ?').get(rootPath) as {
    id: number;
  };
  return row.id;
}
