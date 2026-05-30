import crypto from 'node:crypto';
import type { CommandCategory, CommandOperation } from '../types.js';
import {
  ensureProjectId,
  getProjectRootById,
} from '../database/fileOperations.js';
import {
  getCommandOperationById,
  insertCommandOperation,
  insertCommandSnapshotRecord,
  listPendingCommandOperations,
  updateCommandOperationExecuted,
  updateCommandOperationRejected,
  updateCommandSnapshotAfterDiff,
} from '../database/commandOperations.js';
import { getDatabase } from '../database/db.js';
import { appendAuditEvent } from './auditLog.js';
import {
  classifyCommand,
  modifiesProjectFiles,
  normalizeCommand,
  summarizeCommand,
} from './commandGuard.js';
import { executeCommand, summarizeExecution } from './commandExecutor.js';
import { createCommandSnapshot, finalizeCommandSnapshot } from './commandSnapshot.js';
import { validateScanPath } from './pathGuard.js';
import { approveOperation, rejectOperation, type ApproveResult } from './approval.js';

export interface CreateCommandInput {
  projectRoot: string;
  command: string;
}

export interface CommandExecutionResult {
  success: boolean;
  operation?: CommandOperation;
  output?: string;
  error?: string;
}

function categoryForClassification(
  classification: ReturnType<typeof classifyCommand>,
): CommandCategory {
  if (classification.kind === 'pending_git_write') return 'git_write';
  return 'terminal';
}

export function createPendingCommand(input: CreateCommandInput): CommandOperation {
  const validation = validateScanPath(input.projectRoot);
  if (!validation.valid) throw new Error(validation.error ?? 'Invalid project root');

  const command = normalizeCommand(input.command);
  const classification = classifyCommand(command);
  if (classification.kind === 'blocked') throw new Error(classification.reason);
  if (classification.kind === 'read_only_git') {
    throw new Error('Read-only git commands must use git:status or git:diff CLI');
  }

  const db = getDatabase();
  const projectId = ensureProjectId(db, validation.absolutePath);
  const id = crypto.randomUUID();
  const preview = {
    summary: summarizeCommand(command, classification),
    command,
    category: categoryForClassification(classification),
    requiresApproval: true,
    modifiesFiles: modifiesProjectFiles(classification),
  };

  const operation = insertCommandOperation(db, {
    id,
    projectId,
    command,
    category: preview.category,
    preview,
    requiresApproval: true,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });

  appendAuditEvent({
    event: 'command_requested',
    operationId: operation.id,
    command: operation.command,
    operationType: operation.category,
    status: 'pending',
    message: operation.preview.summary,
  });

  return operation;
}

export async function executeReadOnlyGit(
  projectRoot: string,
  command: string,
): Promise<CommandExecutionResult> {
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return { success: false, error: validation.error };

  const normalized = normalizeCommand(command);
  const classification = classifyCommand(normalized);
  if (classification.kind !== 'read_only_git') {
    return { success: false, error: 'Command is not an approved read-only git command' };
  }

  const outcome = await executeCommand({
    projectRoot: validation.absolutePath,
    command: normalized,
    argv: ['git', ...classification.gitArgs],
  });

  if (!outcome.result) return { success: false, error: outcome.error ?? 'Git command failed' };

  const summary = summarizeExecution(outcome.result);
  appendAuditEvent({
    event: 'command_executed',
    command: normalized,
    operationType: 'git_read',
    status: 'executed',
    exitCode: outcome.result.exitCode,
    stdoutSummary: summary.stdoutSummary,
    stderrSummary: summary.stderrSummary,
    message: 'Read-only git command executed',
  });

  const output = [outcome.result.stdout, outcome.result.stderr].filter(Boolean).join('\n').trim();
  return { success: outcome.result.exitCode === 0 || outcome.result.stdout.length > 0, output };
}

export async function approveCommandOperation(operationId: string): Promise<ApproveResult & { output?: string }> {
  const db = getDatabase();
  const operation = getCommandOperationById(db, operationId);
  if (!operation) return { success: false, error: 'Command operation not found' };
  if (operation.status !== 'pending') return { success: false, error: `Operation is ${operation.status}` };

  const projectRoot = getProjectRootById(db, operation.projectId);
  if (!projectRoot) return { success: false, error: 'Project not found' };

  const classification = classifyCommand(operation.command);
  if (classification.kind === 'blocked') return { success: false, error: classification.reason };

  appendAuditEvent({
    event: 'command_approved',
    operationId,
    command: operation.command,
    operationType: operation.category,
    status: 'approved',
  });

  let snapshotId: string | null = null;
  if (operation.preview.modifiesFiles || operation.category === 'git_write') {
    const snapshot = await createCommandSnapshot(projectRoot, operation.projectId, operationId);
    insertCommandSnapshotRecord(db, snapshot);
    snapshotId = snapshot.id;
    appendAuditEvent({
      event: 'snapshot_created',
      operationId,
      snapshotId,
      message: 'Git diff snapshot captured before command',
    });
  }

  const argv =
    classification.kind === 'pending_git_write' || classification.kind === 'pending_whitelist'
      ? classification.argv
      : tokenizeFallback(operation.command);

  const outcome = await executeCommand({
    projectRoot,
    command: operation.command,
    argv,
  });

  if (!outcome.result) {
    return { success: false, error: outcome.error ?? 'Command execution failed' };
  }

  if (snapshotId) {
    const snapshotRecord = await finalizeCommandSnapshot(
      {
        id: snapshotId,
        projectId: operation.projectId,
        operationId,
        beforeDiff: '',
        afterDiff: null,
        createdAt: new Date().toISOString(),
      },
      projectRoot,
    );
    updateCommandSnapshotAfterDiff(db, snapshotId, snapshotRecord.afterDiff ?? '');
  }

  updateCommandOperationExecuted(db, operationId, outcome.result, snapshotId);
  const summary = summarizeExecution(outcome.result);
  appendAuditEvent({
    event: 'command_executed',
    operationId,
    snapshotId: snapshotId ?? undefined,
    command: operation.command,
    operationType: operation.category,
    status: 'executed',
    exitCode: outcome.result.exitCode,
    stdoutSummary: summary.stdoutSummary,
    stderrSummary: summary.stderrSummary,
    message: outcome.result.timedOut ? 'Command timed out' : 'Command executed',
  });

  const output = [outcome.result.stdout, outcome.result.stderr].filter(Boolean).join('\n').trim();
  return { success: true, output };
}

function tokenizeFallback(command: string): string[] {
  return command.split(/\s+/).filter(Boolean);
}

export function rejectCommandOperation(operationId: string): ApproveResult {
  const db = getDatabase();
  const operation = getCommandOperationById(db, operationId);
  if (!operation) return { success: false, error: 'Command operation not found' };
  if (operation.status !== 'pending') return { success: false, error: `Operation is ${operation.status}` };

  updateCommandOperationRejected(db, operationId);
  appendAuditEvent({
    event: 'command_rejected',
    operationId,
    command: operation.command,
    operationType: operation.category,
    status: 'rejected',
  });

  return { success: true };
}

export function getPendingCommandOperations(projectRoot?: string): CommandOperation[] {
  const db = getDatabase();
  if (!projectRoot) return listPendingCommandOperations(db);
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return [];
  const projectId = ensureProjectId(db, validation.absolutePath);
  return listPendingCommandOperations(db, projectId);
}

export function formatCommandPreview(operation: CommandOperation): string {
  return [
    `Command Operation: ${operation.id}`,
    `Category:  ${operation.category}`,
    `Command:   ${operation.command}`,
    `Status:    ${operation.status}`,
    `Summary:   ${operation.preview.summary}`,
    `Approval:  ${operation.requiresApproval ? 'required' : 'not required'}`,
  ].join('\n');
}

export async function approveAnyOperation(operationId: string): Promise<ApproveResult & { output?: string; kind?: 'file' | 'command' }> {
  const db = getDatabase();
  const fileOp = db.prepare('SELECT id FROM file_operations WHERE id = ?').get(operationId);
  if (fileOp) {
    return { ...approveOperation(operationId), kind: 'file' };
  }

  const commandResult = await approveCommandOperation(operationId);
  return { ...commandResult, kind: 'command' };
}

export function rejectAnyOperation(operationId: string): ApproveResult & { kind?: 'file' | 'command' } {
  const db = getDatabase();
  const fileOp = db.prepare('SELECT id FROM file_operations WHERE id = ?').get(operationId);
  if (fileOp) {
    return { ...rejectOperation(operationId), kind: 'file' };
  }
  return { ...rejectCommandOperation(operationId), kind: 'command' };
}
