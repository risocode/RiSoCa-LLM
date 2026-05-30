import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandSnapshot } from '../types.js';
import { getSnapshotsDir } from '../utils/paths.js';
import { captureGitDiff } from './commandExecutor.js';

export async function createCommandSnapshot(
  projectRoot: string,
  projectId: number,
  operationId: string,
): Promise<CommandSnapshot> {
  const beforeDiff = await captureGitDiff(projectRoot);
  const snapshotId = crypto.randomUUID();
  const snapshotDir = path.join(getSnapshotsDir(), 'commands', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'before.diff'), beforeDiff, 'utf-8');
  fs.writeFileSync(
    path.join(snapshotDir, 'meta.json'),
    JSON.stringify({ operationId, projectRoot, createdAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );

  return {
    id: snapshotId,
    projectId,
    operationId,
    beforeDiff,
    afterDiff: null,
    createdAt: new Date().toISOString(),
  };
}

export async function finalizeCommandSnapshot(
  snapshot: CommandSnapshot,
  projectRoot: string,
): Promise<CommandSnapshot> {
  const afterDiff = await captureGitDiff(projectRoot);
  const snapshotDir = path.join(getSnapshotsDir(), 'commands', snapshot.id);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'after.diff'), afterDiff, 'utf-8');
  return { ...snapshot, afterDiff };
}
