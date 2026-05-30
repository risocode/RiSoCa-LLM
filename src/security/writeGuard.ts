import fs from 'node:fs';
import path from 'node:path';
import { validateScanPath, isSensitivePath } from './pathGuard.js';
import { isBinaryExtension, isBinaryBuffer } from '../utils/fileUtils.js';
import { loadConfig } from './pathGuard.js';
import { normalizePath, resolveProjectFile } from '../utils/paths.js';
import type { FileOperationType } from '../types.js';

const BLOCKED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.expo',
  'vendor',
]);

export interface WriteGuardResult {
  allowed: boolean;
  absolutePath: string;
  normalizedPath: string;
  error?: string;
}

function hasBlockedSegment(relativePath: string): boolean {
  const segments = normalizePath(relativePath).toLowerCase().split('/');
  return segments.some((segment) => BLOCKED_SEGMENTS.has(segment));
}

export function validateWritePath(projectRoot: string, relativePath: string): WriteGuardResult {
  const rootValidation = validateScanPath(projectRoot);
  if (!rootValidation.valid) {
    return { allowed: false, absolutePath: '', normalizedPath: '', error: rootValidation.error };
  }

  const normalized = normalizePath(relativePath);
  if (!normalized || normalized === '.') {
    return { allowed: false, absolutePath: '', normalizedPath: normalized, error: 'Invalid target path' };
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return { allowed: false, absolutePath: '', normalizedPath: normalized, error: 'Absolute paths are not allowed' };
  }

  const absolutePath = resolveProjectFile(rootValidation.absolutePath, normalized);
  const relative = path.relative(rootValidation.absolutePath, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { allowed: false, absolutePath, normalizedPath: normalized, error: 'Path traversal blocked' };
  }

  if (isSensitivePath(normalized)) {
    return { allowed: false, absolutePath, normalizedPath: normalized, error: 'Sensitive file path blocked' };
  }

  if (hasBlockedSegment(normalized)) {
    return { allowed: false, absolutePath, normalizedPath: normalized, error: 'Blocked directory segment' };
  }

  if (isBinaryExtension(normalized)) {
    return { allowed: false, absolutePath, normalizedPath: normalized, error: 'Binary file extension blocked' };
  }

  return { allowed: true, absolutePath, normalizedPath: normalized };
}

export function validateWriteContent(content: string): WriteGuardResult {
  const { maxFileSizeBytes } = loadConfig();
  const size = Buffer.byteLength(content, 'utf-8');
  if (size > maxFileSizeBytes) {
    return {
      allowed: false,
      absolutePath: '',
      normalizedPath: '',
      error: `Content exceeds max size (${maxFileSizeBytes} bytes)`,
    };
  }
  if (isBinaryBuffer(Buffer.from(content))) {
    return { allowed: false, absolutePath: '', normalizedPath: '', error: 'Binary content blocked' };
  }
  return { allowed: true, absolutePath: '', normalizedPath: '' };
}

export function validateOperationType(type: string): type is FileOperationType {
  return type === 'write_file' || type === 'edit_file' || type === 'delete_file';
}

export function assertWriteAllowed(projectRoot: string, relativePath: string, content?: string): WriteGuardResult {
  const pathResult = validateWritePath(projectRoot, relativePath);
  if (!pathResult.allowed) return pathResult;
  if (content !== undefined) {
    const contentResult = validateWriteContent(content);
    if (!contentResult.allowed) return contentResult;
  }
  if (fs.existsSync(pathResult.absolutePath)) {
    const stat = fs.statSync(pathResult.absolutePath);
    if (stat.isDirectory()) {
      return { ...pathResult, allowed: false, error: 'Target is a directory' };
    }
    const { maxFileSizeBytes } = loadConfig();
    if (stat.size > maxFileSizeBytes) {
      return { ...pathResult, allowed: false, error: 'Existing file exceeds max size' };
    }
  }
  return pathResult;
}

export function requiresApproval(operationType: FileOperationType): boolean {
  return operationType === 'write_file' || operationType === 'edit_file' || operationType === 'delete_file';
}
