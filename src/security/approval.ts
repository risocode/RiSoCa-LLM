import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileOperation, FileOperationType, FileSnapshot } from '../types.js';
import {
  ensureProjectId,
  getOperationById,
  getProjectRootById,
  getSnapshotById,
  insertOperation,
  insertSnapshotRecord,
  listPendingOperations,
  listSnapshots,
  updateOperationExecuted,
  updateOperationRejected,
} from '../database/fileOperations.js';
import { getDatabase } from '../database/db.js';
import { appendAuditEvent } from './auditLog.js';
import { createSnapshotFile, restoreSnapshotFile } from './snapshots.js';
import { assertWriteAllowed, validateOperationType, validateWritePath } from './writeGuard.js';
import { validateScanPath } from './pathGuard.js';
import { applyEditStrategy } from '../workflows/editStrategy.js';
import type { EditStrategy } from '../types.js';

export interface CreateOperationInput {
  projectRoot: string;
  targetPath: string;
  operationType: FileOperationType;
  payload: FileOperation['payload'];
  preview: FileOperation['preview'];
}

export interface ApproveResult {
  success: boolean;
  operation?: FileOperation;
  error?: string;
}

function snippet(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function buildWritePreview(projectRoot: string, targetPath: string, content: string): FileOperation['preview'] {
  const exists = fs.existsSync(path.join(projectRoot, targetPath));
  return {
    summary: exists ? `Replace file content (${content.length} chars)` : `Create new file (${content.length} chars)`,
    exists,
    beforeSnippet: exists ? snippet(fs.readFileSync(path.join(projectRoot, targetPath), 'utf-8')) : undefined,
    afterSnippet: snippet(content),
  };
}

export function buildEditPreview(
  projectRoot: string,
  targetPath: string,
  search: string,
  replace: string,
  options?: { editStrategy?: EditStrategy; sectionHeading?: string; fallbackNote?: string },
): FileOperation['preview'] {
  const fullPath = path.join(projectRoot, targetPath);
  const exists = fs.existsSync(fullPath);
  const before = exists ? fs.readFileSync(fullPath, 'utf-8') : '';
  const strategy = options?.editStrategy ?? 'exact';
  let after = before;
  try {
    after = applyEditStrategy(before, {
      search,
      replace,
      editStrategy: strategy,
      sectionHeading: options?.sectionHeading,
    });
  } catch {
    after = before;
  }

  const strategyLabel =
    strategy === 'exact'
      ? `Replace "${snippet(search, 60)}" with "${snippet(replace, 60)}"`
      : strategy === 'append_section'
        ? `Append section to end of file`
        : strategy === 'replace_section'
          ? `Replace section ${options?.sectionHeading ?? 'heading'}`
          : 'Replace entire file';

  const summary = options?.fallbackNote
    ? `${options.fallbackNote} (${strategyLabel})`
    : strategyLabel;

  return {
    summary,
    exists,
    beforeSnippet: snippet(before),
    afterSnippet: snippet(after),
    diffLines: before === after ? ['No change preview available'] : [`Strategy: ${strategy}`],
  };
}

export function buildDeletePreview(projectRoot: string, targetPath: string): FileOperation['preview'] {
  const fullPath = path.join(projectRoot, targetPath);
  const exists = fs.existsSync(fullPath);
  return {
    summary: exists ? 'Delete existing file' : 'Delete requested but file does not exist',
    exists,
    beforeSnippet: exists ? snippet(fs.readFileSync(fullPath, 'utf-8')) : undefined,
  };
}

export function createPendingOperation(input: CreateOperationInput): FileOperation {
  const validation = validateScanPath(input.projectRoot);
  if (!validation.valid) throw new Error(validation.error ?? 'Invalid project root');

  if (!validateOperationType(input.operationType)) {
    throw new Error('Invalid operation type');
  }

  const guard = assertWriteAllowed(
    validation.absolutePath,
    input.targetPath,
    input.operationType === 'write_file' ? input.payload.content ?? '' : undefined,
  );
  if (!guard.allowed) throw new Error(guard.error ?? 'Write blocked');

  if (input.operationType === 'edit_file') {
    const fullPath = path.join(validation.absolutePath, guard.normalizedPath);
    if (!fs.existsSync(fullPath)) throw new Error('Edit target does not exist');
    const current = fs.readFileSync(fullPath, 'utf-8');
    const strategy = input.payload.editStrategy ?? 'exact';

    if (strategy === 'exact' && !current.includes(input.payload.search ?? '')) {
      throw new Error('Search string not found');
    }

    if (strategy === 'append_section' && input.payload.search && current !== input.payload.search) {
      throw new Error('File changed since edit was planned');
    }

    let edited: string;
    try {
      edited = applyEditStrategy(current, {
        search: input.payload.search,
        replace: input.payload.replace,
        editStrategy: strategy,
        sectionHeading: input.payload.sectionHeading,
      });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Edit validation failed');
    }

    const contentCheck = assertWriteAllowed(validation.absolutePath, guard.normalizedPath, edited);
    if (!contentCheck.allowed) throw new Error(contentCheck.error ?? 'Edited content blocked');
  }

  if (input.operationType === 'delete_file') {
    const fullPath = path.join(validation.absolutePath, guard.normalizedPath);
    if (!fs.existsSync(fullPath)) throw new Error('Delete target does not exist');
  }

  const db = getDatabase();
  const projectId = ensureProjectId(db, validation.absolutePath);
  const id = crypto.randomUUID();
  const operation = insertOperation(db, {
    id,
    projectId,
    operationType: input.operationType,
    targetPath: guard.normalizedPath,
    payload: input.payload,
    preview: input.preview,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });

  appendAuditEvent({
    event: 'operation_requested',
    operationId: operation.id,
    targetPath: operation.targetPath,
    operationType: operation.operationType,
    status: 'pending',
    message: operation.preview.summary,
  });

  return operation;
}

function recordSnapshot(
  db: ReturnType<typeof getDatabase>,
  projectId: number,
  projectRoot: string,
  targetPath: string,
  operationId: string,
): string | null {
  const snap = createSnapshotFile(projectRoot, targetPath, operationId);
  if (!snap.existed) return null;

  const record: FileSnapshot = {
    id: snap.snapshotId,
    projectId,
    originalPath: targetPath,
    snapshotPath: snap.snapshotPath,
    operationId,
    hash: snap.hash,
    createdAt: new Date().toISOString(),
  };
  insertSnapshotRecord(db, record);
  appendAuditEvent({
    event: 'snapshot_created',
    operationId,
    snapshotId: record.id,
    targetPath,
    message: 'Pre-operation snapshot stored',
  });
  return record.id;
}

function executeOperation(projectRoot: string, operation: FileOperation): void {
  const fullPath = path.join(projectRoot, operation.targetPath);

  if (operation.operationType === 'write_file') {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, operation.payload.content ?? '', 'utf-8');
    return;
  }

  if (operation.operationType === 'edit_file') {
    const current = fs.readFileSync(fullPath, 'utf-8');
    const next = applyEditStrategy(current, {
      search: operation.payload.search,
      replace: operation.payload.replace,
      editStrategy: operation.payload.editStrategy,
      sectionHeading: operation.payload.sectionHeading,
    });
    fs.writeFileSync(fullPath, next, 'utf-8');
    return;
  }

  if (operation.operationType === 'delete_file') {
    fs.unlinkSync(fullPath);
  }
}

export function approveOperation(operationId: string): ApproveResult {
  const db = getDatabase();
  const operation = getOperationById(db, operationId);
  if (!operation) return { success: false, error: 'Operation not found' };
  if (operation.status !== 'pending') return { success: false, error: `Operation is ${operation.status}` };

  const projectRoot = getProjectRootById(db, operation.projectId);
  if (!projectRoot) return { success: false, error: 'Project not found' };

  const guard = assertWriteAllowed(projectRoot, operation.targetPath, operation.payload.content);
  if (!guard.allowed) return { success: false, error: guard.error };

  appendAuditEvent({
    event: 'operation_approved',
    operationId,
    targetPath: operation.targetPath,
    operationType: operation.operationType,
    status: 'approved',
  });

  let snapshotId: string | null = null;
  const targetExists = fs.existsSync(path.join(projectRoot, operation.targetPath));
  const needsSnapshot =
    operation.operationType === 'delete_file' ||
    operation.operationType === 'edit_file' ||
    (operation.operationType === 'write_file' && targetExists);

  if (needsSnapshot) {
    snapshotId = recordSnapshot(db, operation.projectId, projectRoot, operation.targetPath, operationId);
  }

  try {
    executeOperation(projectRoot, operation);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }

  updateOperationExecuted(db, operationId, snapshotId);
  appendAuditEvent({
    event: 'operation_executed',
    operationId,
    snapshotId: snapshotId ?? undefined,
    targetPath: operation.targetPath,
    operationType: operation.operationType,
    status: 'executed',
  });

  return { success: true, operation: getOperationById(db, operationId)! };
}

export function rejectOperation(operationId: string): ApproveResult {
  const db = getDatabase();
  const operation = getOperationById(db, operationId);
  if (!operation) return { success: false, error: 'Operation not found' };
  if (operation.status !== 'pending') return { success: false, error: `Operation is ${operation.status}` };

  updateOperationRejected(db, operationId);
  appendAuditEvent({
    event: 'operation_rejected',
    operationId,
    targetPath: operation.targetPath,
    operationType: operation.operationType,
    status: 'rejected',
  });

  return { success: true, operation: getOperationById(db, operationId)! };
}

export function getPendingOperations(projectRoot?: string): FileOperation[] {
  const db = getDatabase();
  if (!projectRoot) return listPendingOperations(db);
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return [];
  const projectId = ensureProjectId(db, validation.absolutePath);
  return listPendingOperations(db, projectId);
}

export function getSnapshotsForProject(projectRoot: string): FileSnapshot[] {
  const db = getDatabase();
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return [];
  const projectId = ensureProjectId(db, validation.absolutePath);
  return listSnapshots(db, projectId);
}

export function restoreFromSnapshot(snapshotId: string): ApproveResult {
  const db = getDatabase();
  const snapshot = getSnapshotById(db, snapshotId);
  if (!snapshot) return { success: false, error: 'Snapshot not found' };

  const projectRoot = getProjectRootById(db, snapshot.projectId);
  if (!projectRoot) return { success: false, error: 'Project not found' };

  const guard = validateWritePath(projectRoot, snapshot.originalPath);
  if (!guard.allowed) return { success: false, error: guard.error };

  restoreSnapshotFile(snapshot, projectRoot);
  appendAuditEvent({
    event: 'restore_performed',
    snapshotId,
    targetPath: snapshot.originalPath,
    message: 'File restored from snapshot',
  });

  return { success: true };
}

export function formatOperationPreview(operation: FileOperation): string {
  const lines = [
    `Operation: ${operation.id}`,
    `Type:      ${operation.operationType}`,
    `Target:    ${operation.targetPath}`,
    `Status:    ${operation.status}`,
    `Summary:   ${operation.preview.summary}`,
  ];
  if (operation.preview.beforeSnippet) lines.push(`Before:    ${operation.preview.beforeSnippet}`);
  if (operation.preview.afterSnippet) lines.push(`After:     ${operation.preview.afterSnippet}`);
  return lines.join('\n');
}
