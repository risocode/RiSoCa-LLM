import { createPendingCommand, formatCommandPreview } from '../security/commandApproval.js';

export interface RunCommandToolResult {
  success: boolean;
  operationId?: string;
  preview?: string;
  error?: string;
}

export function runCommandTool(projectRoot: string, command: string): RunCommandToolResult {
  try {
    const operation = createPendingCommand({ projectRoot, command });
    return {
      success: true,
      operationId: operation.id,
      preview: formatCommandPreview(operation),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Command planning failed',
    };
  }
}
