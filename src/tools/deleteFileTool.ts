import {
  buildDeletePreview,
  createPendingOperation,
  formatOperationPreview,
} from '../security/approval.js';

export interface DeleteFileToolResult {
  success: boolean;
  operationId?: string;
  preview?: string;
  error?: string;
}

export function deleteFileTool(projectRoot: string, targetPath: string): DeleteFileToolResult {
  try {
    const preview = buildDeletePreview(projectRoot, targetPath);
    const operation = createPendingOperation({
      projectRoot,
      targetPath,
      operationType: 'delete_file',
      payload: {},
      preview,
    });
    return {
      success: true,
      operationId: operation.id,
      preview: formatOperationPreview(operation),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Delete request failed' };
  }
}
