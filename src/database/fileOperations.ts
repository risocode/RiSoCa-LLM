import type Database from 'better-sqlite3';
import type {
  FileOperation,
  FileOperationPayload,
  FileOperationPreview,
  FileOperationStatus,
  FileOperationType,
  FileSnapshot,
} from '../types.js';
import { getDatabase } from './db.js';

interface OperationRow {
  id: string;
  project_id: number;
  operation_type: FileOperationType;
  target_path: string;
  payload_json: string;
  status: FileOperationStatus;
  preview_json: string | null;
  snapshot_id: string | null;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  rejected_at: string | null;
}

function mapOperation(row: OperationRow): FileOperation {
  return {
    id: row.id,
    projectId: row.project_id,
    operationType: row.operation_type,
    targetPath: row.target_path,
    payload: JSON.parse(row.payload_json) as FileOperationPayload,
    status: row.status,
    preview: JSON.parse(row.preview_json ?? '{}') as FileOperationPreview,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    rejectedAt: row.rejected_at,
  };
}

export function ensureProjectId(db: Database.Database, rootPath: string, name?: string): number {
  const existing = db.prepare('SELECT id FROM projects WHERE root_path = ?').get(rootPath) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const projectName = name ?? rootPath.split(/[/\\]/).pop() ?? 'project';
  db.prepare(
    'INSERT INTO projects (root_path, name, fingerprint, last_scanned_at) VALUES (?, ?, ?, ?)',
  ).run(rootPath, projectName, 'manual', new Date().toISOString());
  return (db.prepare('SELECT id FROM projects WHERE root_path = ?').get(rootPath) as { id: number }).id;
}

export function insertOperation(
  db: Database.Database,
  operation: Omit<FileOperation, 'status' | 'snapshotId' | 'approvedAt' | 'executedAt' | 'rejectedAt'> & {
    status?: FileOperationStatus;
  },
): FileOperation {
  db.prepare(`
    INSERT INTO file_operations (
      id, project_id, operation_type, target_path, payload_json, status, preview_json, snapshot_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    operation.id,
    operation.projectId,
    operation.operationType,
    operation.targetPath,
    JSON.stringify(operation.payload),
    operation.status ?? 'pending',
    JSON.stringify(operation.preview),
    null,
    operation.createdAt,
  );
  return getOperationById(db, operation.id)!;
}

export function getOperationById(db: Database.Database, id: string): FileOperation | null {
  const row = db.prepare('SELECT * FROM file_operations WHERE id = ?').get(id) as OperationRow | undefined;
  return row ? mapOperation(row) : null;
}

export function updateOperationExecuted(
  db: Database.Database,
  id: string,
  snapshotId: string | null,
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE file_operations
    SET status = 'executed', snapshot_id = ?, approved_at = ?, executed_at = ?
    WHERE id = ?
  `).run(snapshotId, now, now, id);
}

export function updateOperationRejected(db: Database.Database, id: string): void {
  db.prepare(`
    UPDATE file_operations SET status = 'rejected', rejected_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export function listPendingOperations(db: Database.Database, projectId?: number): FileOperation[] {
  const rows = projectId
    ? (db.prepare("SELECT * FROM file_operations WHERE status = 'pending' AND project_id = ? ORDER BY created_at DESC").all(
        projectId,
      ) as OperationRow[])
    : (db.prepare("SELECT * FROM file_operations WHERE status = 'pending' ORDER BY created_at DESC").all() as OperationRow[]);
  return rows.map(mapOperation);
}

export function insertSnapshotRecord(db: Database.Database, snapshot: FileSnapshot): void {
  db.prepare(`
    INSERT INTO file_snapshots (id, project_id, original_path, snapshot_path, operation_id, hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.projectId,
    snapshot.originalPath,
    snapshot.snapshotPath,
    snapshot.operationId,
    snapshot.hash,
    snapshot.createdAt,
  );
}

export function getSnapshotById(db: Database.Database, id: string): FileSnapshot | null {
  const row = db
    .prepare('SELECT * FROM file_snapshots WHERE id = ?')
    .get(id) as
    | {
        id: string;
        project_id: number;
        original_path: string;
        snapshot_path: string;
        operation_id: string | null;
        hash: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    originalPath: row.original_path,
    snapshotPath: row.snapshot_path,
    operationId: row.operation_id,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

export function listSnapshots(db: Database.Database, projectId: number): FileSnapshot[] {
  const rows = db
    .prepare('SELECT * FROM file_snapshots WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Array<{
    id: string;
    project_id: number;
    original_path: string;
    snapshot_path: string;
    operation_id: string | null;
    hash: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    originalPath: row.original_path,
    snapshotPath: row.snapshot_path,
    operationId: row.operation_id,
    hash: row.hash,
    createdAt: row.created_at,
  }));
}

export function getProjectRootById(db: Database.Database, projectId: number): string | null {
  const row = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as
    | { root_path: string }
    | undefined;
  return row?.root_path ?? null;
}
