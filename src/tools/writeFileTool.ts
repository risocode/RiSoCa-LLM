import {
  buildWritePreview,
  createPendingOperation,
  formatOperationPreview,
} from '../security/approval.js';

export interface WriteFileToolResult {
  success: boolean;
  operationId?: string;
  preview?: string;
  error?: string;
}

export function writeFileTool(projectRoot: string, targetPath: string, content: string): WriteFileToolResult {
  try {
    const preview = buildWritePreview(projectRoot, targetPath, content);
    const operation = createPendingOperation({
      projectRoot,
      targetPath,
      operationType: 'write_file',
      payload: { content },
      preview,
    });
    return {
      success: true,
      operationId: operation.id,
      preview: formatOperationPreview(operation),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Write request failed' };
  }
}
