import {
  getSnapshotsForProject,
  restoreFromSnapshot,
} from '../security/approval.js';
import type { FileSnapshot } from '../types.js';

export interface RestoreSnapshotResult {
  success: boolean;
  error?: string;
}

export function listSnapshotsTool(projectRoot: string): FileSnapshot[] {
  return getSnapshotsForProject(projectRoot);
}

export function restoreSnapshotTool(snapshotId: string): RestoreSnapshotResult {
  const result = restoreFromSnapshot(snapshotId);
  return { success: result.success, error: result.error };
}
