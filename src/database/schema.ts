export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT UNIQUE NOT NULL,
  name TEXT,
  fingerprint TEXT,
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS project_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  summary_json TEXT,
  stack_json TEXT,
  health_score INTEGER,
  complexity_score INTEGER,
  risks_json TEXT,
  scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS indexed_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  path TEXT,
  language TEXT,
  size_bytes INTEGER,
  role TEXT,
  hash TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  file_path TEXT,
  name TEXT,
  kind TEXT,
  line INTEGER
);

CREATE TABLE IF NOT EXISTS import_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  from_path TEXT,
  to_path TEXT,
  spec TEXT,
  resolved INTEGER
);

CREATE TABLE IF NOT EXISTS project_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  key TEXT,
  value_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  started_at TEXT,
  command TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_indexed_files_project ON indexed_files(project_id);
CREATE INDEX IF NOT EXISTS idx_symbols_project ON symbols(project_id);
CREATE INDEX IF NOT EXISTS idx_import_edges_project ON import_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_project_memory_project ON project_memory(project_id, key);
`;

export function initializeSchema(db: { exec: (sql: string) => void }): void {
  db.exec(SCHEMA_SQL);
}
