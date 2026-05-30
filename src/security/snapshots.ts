import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileSnapshot } from '../types.js';
import { hashContent } from '../utils/fileUtils.js';
import { assertAgentDataPath } from './pathGuard.js';
import { getSnapshotsDir, normalizePath } from '../utils/paths.js';

export function createSnapshotFile(
  projectRoot: string,
  relativePath: string,
  operationId: string,
): { snapshotId: string; snapshotPath: string; hash: string; existed: boolean } {
  const normalized = normalizePath(relativePath);
  const sourcePath = path.join(projectRoot, normalized);
  const snapshotId = crypto.randomUUID();
  const snapshotDir = path.join(getSnapshotsDir(), snapshotId);
  const snapshotPath = path.join(snapshotDir, normalized.replace(/\//g, path.sep));

  assertAgentDataPath(snapshotDir);

  if (!fs.existsSync(sourcePath)) {
    return { snapshotId, snapshotPath, hash: '', existed: false };
  }

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const content = fs.readFileSync(sourcePath);
  fs.writeFileSync(snapshotPath, content);
  const metaPath = path.join(snapshotDir, 'meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ originalPath: normalized, operationId, createdAt: new Date().toISOString() }, null, 2),
  );

  return { snapshotId, snapshotPath, hash: hashContent(content.toString('utf-8')), existed: true };
}

export function restoreSnapshotFile(snapshot: FileSnapshot, projectRoot: string): void {
  const targetPath = path.join(projectRoot, snapshot.originalPath);
  if (!fs.existsSync(snapshot.snapshotPath)) {
    throw new Error(`Snapshot file missing: ${snapshot.snapshotPath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(snapshot.snapshotPath, targetPath);
}

export function listSnapshotFiles(projectId: number, snapshots: FileSnapshot[]): FileSnapshot[] {
  return snapshots.filter((s) => s.projectId === projectId);
}

export function removeSnapshotDir(snapshotId: string): void {
  const dir = path.join(getSnapshotsDir(), snapshotId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
