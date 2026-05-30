import { assertReadablePath } from '../security/pathGuard.js';
import { readFileSafe } from '../utils/fileUtils.js';

export interface ReadFileResult {
  success: boolean;
  path: string;
  content?: string;
  error?: string;
}

export function readFileTool(root: string, relativePath: string): ReadFileResult {
  try {
    assertReadablePath(root, relativePath);
    const content = readFileSafe(root, relativePath);
    if (content === null) {
      return { success: false, path: relativePath, error: 'File not readable or blocked' };
    }
    return { success: true, path: relativePath, content };
  } catch (err) {
    return {
      success: false,
      path: relativePath,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
