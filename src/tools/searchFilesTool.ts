import type { FileEntry } from '../types.js';
import { isSensitivePath } from '../security/pathGuard.js';
import { readFileSafe } from '../utils/fileUtils.js';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchFilesResult {
  query: string;
  matches: SearchMatch[];
  total: number;
}

export function searchFilesTool(
  root: string,
  files: FileEntry[],
  query: string,
  maxResults = 50,
): SearchFilesResult {
  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  for (const file of files) {
    if (isSensitivePath(file.path)) continue;
    const content = readFileSafe(root, file.path);
    if (!content) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        matches.push({ file: file.path, line: i + 1, content: lines[i].trim() });
        if (matches.length >= maxResults) {
          return { query, matches, total: matches.length };
        }
      }
    }
  }

  return { query, matches, total: matches.length };
}
