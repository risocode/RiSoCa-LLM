import type { CommandOperation, FileOperation } from '../types.js';

export function formatApproveCommand(operationId: string): string {
  return `npm run approve -- "${operationId}"`;
}

export function formatPendingOperationNotice(input: {
  operationId: string;
  operationType: string;
  target: string;
  preview: string;
}): string {
  return [
    'Pending operation created (approval required).',
    '',
    `Operation ID: ${input.operationId}`,
    `Type:         ${input.operationType}`,
    `Target:       ${input.target}`,
    '',
    'Preview:',
    input.preview,
    '',
    'Approve with:',
    `  ${formatApproveCommand(input.operationId)}`,
  ].join('\n');
}

export function formatPendingFileOperation(op: FileOperation): string {
  return [
    `ID:       ${op.id}`,
    `Type:     ${op.operationType}`,
    `Status:   ${op.status}`,
    `Target:   ${op.targetPath}`,
    `Created:  ${op.createdAt}`,
    `Summary:  ${op.preview.summary}`,
    `Approve:  ${formatApproveCommand(op.id)}`,
  ].join('\n');
}

export function formatPendingCommandOperation(op: CommandOperation): string {
  return [
    `ID:       ${op.id}`,
    `Type:     ${op.category}`,
    `Status:   ${op.status}`,
    `Target:   ${op.command}`,
    `Created:  ${op.createdAt}`,
    `Summary:  ${op.preview.summary}`,
    `Approve:  ${formatApproveCommand(op.id)}`,
  ].join('\n');
}

export function formatPendingOperationsList(
  fileOps: FileOperation[],
  commandOps: CommandOperation[],
): string {
  const total = fileOps.length + commandOps.length;
  if (total === 0) return 'No pending operations.';

  const lines = [`Pending Operations (${total})`, '──────────────────────'];
  for (const op of fileOps) {
    lines.push(formatPendingFileOperation(op), '---');
  }
  for (const op of commandOps) {
    lines.push(formatPendingCommandOperation(op), '---');
  }
  return lines.join('\n');
}
