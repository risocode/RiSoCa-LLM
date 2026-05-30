import type Database from 'better-sqlite3';
import type {
  CommandCategory,
  CommandOperation,
  CommandOperationPreview,
  CommandOperationResult,
  CommandOperationStatus,
  CommandSnapshot,
} from '../types.js';

interface CommandOperationRow {
  id: string;
  project_id: number;
  command: string;
  category: CommandCategory;
  status: CommandOperationStatus;
  preview_json: string | null;
  result_json: string | null;
  snapshot_id: string | null;
  requires_approval: number;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  rejected_at: string | null;
}

function mapCommandOperation(row: CommandOperationRow): CommandOperation {
  return {
    id: row.id,
    projectId: row.project_id,
    command: row.command,
    category: row.category,
    status: row.status,
    preview: JSON.parse(row.preview_json ?? '{}') as CommandOperationPreview,
    result: row.result_json ? (JSON.parse(row.result_json) as CommandOperationResult) : null,
    snapshotId: row.snapshot_id,
    requiresApproval: row.requires_approval === 1,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    rejectedAt: row.rejected_at,
  };
}

export function insertCommandOperation(
  db: Database.Database,
  operation: Omit<
    CommandOperation,
    'status' | 'result' | 'snapshotId' | 'approvedAt' | 'executedAt' | 'rejectedAt'
  > & { status?: CommandOperationStatus },
): CommandOperation {
  db.prepare(`
    INSERT INTO command_operations (
      id, project_id, command, category, status, preview_json, result_json,
      snapshot_id, requires_approval, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    operation.id,
    operation.projectId,
    operation.command,
    operation.category,
    operation.status ?? 'pending',
    JSON.stringify(operation.preview),
    null,
    null,
    operation.requiresApproval ? 1 : 0,
    operation.createdAt,
  );
  return getCommandOperationById(db, operation.id)!;
}

export function getCommandOperationById(db: Database.Database, id: string): CommandOperation | null {
  const row = db.prepare('SELECT * FROM command_operations WHERE id = ?').get(id) as
    | CommandOperationRow
    | undefined;
  return row ? mapCommandOperation(row) : null;
}

export function updateCommandOperationExecuted(
  db: Database.Database,
  id: string,
  result: CommandOperationResult,
  snapshotId: string | null,
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE command_operations
    SET status = 'executed', result_json = ?, snapshot_id = ?, approved_at = ?, executed_at = ?
    WHERE id = ?
  `).run(JSON.stringify(result), snapshotId, now, now, id);
}

export function updateCommandOperationRejected(db: Database.Database, id: string): void {
  db.prepare(`
    UPDATE command_operations SET status = 'rejected', rejected_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export function listPendingCommandOperations(db: Database.Database, projectId?: number): CommandOperation[] {
  const rows = projectId
    ? (db
        .prepare("SELECT * FROM command_operations WHERE status = 'pending' AND project_id = ? ORDER BY created_at DESC")
        .all(projectId) as CommandOperationRow[])
    : (db
        .prepare("SELECT * FROM command_operations WHERE status = 'pending' ORDER BY created_at DESC")
        .all() as CommandOperationRow[]);
  return rows.map(mapCommandOperation);
}

export function insertCommandSnapshotRecord(db: Database.Database, snapshot: CommandSnapshot): void {
  db.prepare(`
    INSERT INTO command_snapshots (id, project_id, operation_id, before_diff, after_diff, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.projectId,
    snapshot.operationId,
    snapshot.beforeDiff,
    snapshot.afterDiff,
    snapshot.createdAt,
  );
}

export function updateCommandSnapshotAfterDiff(
  db: Database.Database,
  snapshotId: string,
  afterDiff: string,
): void {
  db.prepare('UPDATE command_snapshots SET after_diff = ? WHERE id = ?').run(afterDiff, snapshotId);
}

export function getCommandSnapshotById(db: Database.Database, id: string): CommandSnapshot | null {
  const row = db.prepare('SELECT * FROM command_snapshots WHERE id = ?').get(id) as
    | {
        id: string;
        project_id: number;
        operation_id: string;
        before_diff: string;
        after_diff: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    operationId: row.operation_id,
    beforeDiff: row.before_diff,
    afterDiff: row.after_diff,
    createdAt: row.created_at,
  };
}
