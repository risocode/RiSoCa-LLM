import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../src/database/schema.js';
import { closeDatabase, resetDatabase, setDatabaseInstance } from '../src/database/db.js';
import { validateWritePath } from '../src/security/writeGuard.js';
import { writeFileTool } from '../src/tools/writeFileTool.js';
import { editFileTool } from '../src/tools/editFileTool.js';
import { deleteFileTool } from '../src/tools/deleteFileTool.js';
import { approveOperation, rejectOperation } from '../src/security/approval.js';
import { getOperationById } from '../src/database/fileOperations.js';
import { getSnapshotById } from '../src/database/fileOperations.js';
import { restoreSnapshotTool } from '../src/tools/restoreSnapshotTool.js';
import { readAuditEvents, clearAuditLogForTests } from '../src/security/auditLog.js';
import { getSnapshotsDir } from '../src/utils/paths.js';

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risoca-phase3-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const value = "original";\n');
  return dir;
}

describe('writeGuard', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('blocks sensitive files', () => {
    expect(validateWritePath(projectRoot, '.env').allowed).toBe(false);
    expect(validateWritePath(projectRoot, 'secrets/credentials.json').allowed).toBe(false);
  });

  it('blocks path traversal', () => {
    expect(validateWritePath(projectRoot, '../outside.ts').allowed).toBe(false);
  });

  it('blocks node_modules and dist', () => {
    expect(validateWritePath(projectRoot, 'node_modules/pkg/index.js').allowed).toBe(false);
    expect(validateWritePath(projectRoot, 'dist/bundle.js').allowed).toBe(false);
    expect(validateWritePath(projectRoot, '.git/config').allowed).toBe(false);
  });
});

describe('file operations approval flow', () => {
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(() => {
    projectRoot = createTempProject();
    db = new Database(':memory:');
    initializeSchema(db);
    setDatabaseInstance(db);
    clearAuditLogForTests();
    fs.mkdirSync(getSnapshotsDir(), { recursive: true });
  });

  afterEach(() => {
    resetDatabase();
    clearAuditLogForTests();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('write creates pending operation only', () => {
    const target = 'src/new-file.ts';
    const result = writeFileTool(projectRoot, target, 'export const x = 1;\n');
    expect(result.success).toBe(true);
    expect(result.operationId).toBeDefined();

    const op = getOperationById(db, result.operationId!);
    expect(op?.status).toBe('pending');
    expect(fs.existsSync(path.join(projectRoot, target))).toBe(false);
  });

  it('approve executes write and creates snapshot for existing file', () => {
    const target = 'src/app.ts';
    const pending = writeFileTool(projectRoot, target, 'export const value = "updated";\n');
    const approved = approveOperation(pending.operationId!);
    expect(approved.success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, target), 'utf-8')).toContain('updated');

    const op = getOperationById(db, pending.operationId!);
    expect(op?.status).toBe('executed');
    expect(op?.snapshotId).toBeTruthy();
  });

  it('edit creates pending operation and approve applies change with snapshot', () => {
    const pending = editFileTool(projectRoot, 'src/app.ts', 'original', 'changed');
    expect(pending.success).toBe(true);

    approveOperation(pending.operationId!);
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.ts'), 'utf-8')).toContain('changed');
  });

  it('delete creates pending operation and approve removes file with snapshot', () => {
    const pending = deleteFileTool(projectRoot, 'src/app.ts');
    expect(pending.success).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'src/app.ts'))).toBe(true);

    approveOperation(pending.operationId!);
    expect(fs.existsSync(path.join(projectRoot, 'src/app.ts'))).toBe(false);

    const op = getOperationById(db, pending.operationId!);
    expect(op?.snapshotId).toBeTruthy();
  });

  it('reject prevents execution', () => {
    const pending = deleteFileTool(projectRoot, 'src/app.ts');
    const rejected = rejectOperation(pending.operationId!);
    expect(rejected.success).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'src/app.ts'))).toBe(true);

    const op = getOperationById(db, pending.operationId!);
    expect(op?.status).toBe('rejected');
  });

  it('restore works from snapshot', () => {
    const pending = editFileTool(projectRoot, 'src/app.ts', 'original', 'changed');
    approveOperation(pending.operationId!);
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.ts'), 'utf-8')).toContain('changed');

    const op = getOperationById(db, pending.operationId!);
    const snapshot = getSnapshotById(db, op!.snapshotId!);
    fs.writeFileSync(path.join(projectRoot, 'src/app.ts'), 'broken content');

    const restored = restoreSnapshotTool(snapshot!.id);
    expect(restored.success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.ts'), 'utf-8')).toContain('original');
  });

  it('writes audit log events', () => {
    const pending = writeFileTool(projectRoot, 'src/new.ts', 'export const n = 1;\n');
    approveOperation(pending.operationId!);

    const events = readAuditEvents(20);
    expect(events.some((e) => e.event === 'operation_requested')).toBe(true);
    expect(events.some((e) => e.event === 'operation_approved')).toBe(true);
    expect(events.some((e) => e.event === 'operation_executed')).toBe(true);
  });
});
