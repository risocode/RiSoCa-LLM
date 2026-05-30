import fs from 'node:fs';
import path from 'node:path';
import type { FileOperation } from '../types.js';
import { getDatabase } from '../database/db.js';
import { getOperationById, getProjectRootById } from '../database/fileOperations.js';
import { applyEditStrategy } from '../workflows/editStrategy.js';
import { buildUnifiedDiff } from '../utils/unifiedDiff.js';

export interface OperationPreviewDetail {
  operationId: string;
  operationType: string;
  target: string;
  status: string;
  before: string;
  after: string;
  unifiedDiff: string;
}

export function computeFileOperationBefore(projectRoot: string, operation: FileOperation): string {
  const fullPath = path.join(projectRoot, operation.targetPath);
  if (operation.operationType === 'delete_file') {
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
  }
  if (operation.operationType === 'write_file' && !fs.existsSync(fullPath)) {
    return '';
  }
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
}

export function computeFileOperationAfter(projectRoot: string, operation: FileOperation): string {
  const before = computeFileOperationBefore(projectRoot, operation);

  if (operation.operationType === 'write_file') {
    return operation.payload.content ?? '';
  }

  if (operation.operationType === 'delete_file') {
    return '';
  }

  return applyEditStrategy(before, {
    search: operation.payload.search,
    replace: operation.payload.replace,
    editStrategy: operation.payload.editStrategy,
    sectionHeading: operation.payload.sectionHeading,
  });
}

export function previewOperationById(
  operationId: string,
): { success: true; preview: OperationPreviewDetail } | { success: false; error: string } {
  const db = getDatabase();
  const operation = getOperationById(db, operationId);
  if (!operation) return { success: false, error: 'Operation not found' };

  const projectRoot = getProjectRootById(db, operation.projectId);
  if (!projectRoot) return { success: false, error: 'Project not found' };

  const before = computeFileOperationBefore(projectRoot, operation);
  let after = before;

  try {
    after = computeFileOperationAfter(projectRoot, operation);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not compute operation preview',
    };
  }

  return {
    success: true,
    preview: {
      operationId: operation.id,
      operationType: operation.operationType,
      target: operation.targetPath,
      status: operation.status,
      before,
      after,
      unifiedDiff: buildUnifiedDiff(before, after, operation.targetPath),
    },
  };
}

export function formatOperationPreviewDetail(preview: OperationPreviewDetail): string {
  return [
    `Operation: ${preview.operationId}`,
    `Type:      ${preview.operationType}`,
    `Target:    ${preview.target}`,
    `Status:    ${preview.status}`,
    '',
    'Before:',
    preview.before || '(empty)',
    '',
    'After:',
    preview.after || '(empty)',
    '',
    'Unified diff:',
    preview.unifiedDiff,
  ].join('\n');
}
