import {
  buildEditPreview,
  createPendingOperation,
  formatOperationPreview,
} from '../security/approval.js';
import type { EditStrategy } from '../types.js';

export interface EditFileToolOptions {
  editStrategy?: EditStrategy;
  sectionHeading?: string;
  fallbackNote?: string;
  userRequestedText?: string;
}

export interface EditFileToolResult {
  success: boolean;
  operationId?: string;
  preview?: string;
  error?: string;
}

export function editFileTool(
  projectRoot: string,
  targetPath: string,
  search: string,
  replace: string,
  options?: EditFileToolOptions,
): EditFileToolResult {
  try {
    const preview = buildEditPreview(projectRoot, targetPath, search, replace, {
      editStrategy: options?.editStrategy ?? 'exact',
      sectionHeading: options?.sectionHeading,
      fallbackNote: options?.fallbackNote,
    });
    const operation = createPendingOperation({
      projectRoot,
      targetPath,
      operationType: 'edit_file',
      payload: {
        search,
        replace,
        editStrategy: options?.editStrategy ?? 'exact',
        sectionHeading: options?.sectionHeading,
        fallbackNote: options?.fallbackNote,
        userRequestedText: options?.userRequestedText,
      },
      preview,
    });
    return {
      success: true,
      operationId: operation.id,
      preview: formatOperationPreview(operation),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Edit request failed' };
  }
}
