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

CREATE TABLE IF NOT EXISTS file_operations (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  operation_type TEXT NOT NULL,
  target_path TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  preview_json TEXT,
  snapshot_id TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  executed_at TEXT,
  rejected_at TEXT
);

CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  original_path TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  operation_id TEXT,
  hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_operations_project ON file_operations(project_id);
CREATE INDEX IF NOT EXISTS idx_file_operations_status ON file_operations(status);
CREATE INDEX IF NOT EXISTS idx_file_snapshots_project ON file_snapshots(project_id);

CREATE TABLE IF NOT EXISTS command_operations (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  command TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  preview_json TEXT,
  result_json TEXT,
  snapshot_id TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  executed_at TEXT,
  rejected_at TEXT
);

CREATE TABLE IF NOT EXISTS command_snapshots (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  operation_id TEXT NOT NULL,
  before_diff TEXT NOT NULL,
  after_diff TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_operations_project ON command_operations(project_id);
CREATE INDEX IF NOT EXISTS idx_command_operations_status ON command_operations(status);
CREATE INDEX IF NOT EXISTS idx_command_snapshots_project ON command_snapshots(project_id);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  user_request TEXT NOT NULL,
  plan_json TEXT,
  validation_json TEXT,
  planning_cycles INTEGER NOT NULL DEFAULT 0,
  linked_operation_ids_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id),
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  target TEXT NOT NULL,
  payload_json TEXT,
  linked_operation_id TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id);
`;

export function initializeSchema(db: { exec: (sql: string) => void }): void {
  db.exec(SCHEMA_SQL);
}
