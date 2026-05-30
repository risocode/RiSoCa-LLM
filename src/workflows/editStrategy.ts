import fs from 'node:fs';
import path from 'node:path';
import { readFileSafe } from '../utils/fileUtils.js';
import type { EditStrategy } from '../types.js';
import {
  extractUserSpecifiedText,
  formatMarkdownQualityError,
  getProjectDisplayNames,
  normalizeMarkdownEditContent,
} from './markdownEditQuality.js';
import type { WorkflowPlan, WorkflowPlanEdit } from './workflowTypes.js';

export interface ResolvedPlanEdit extends WorkflowPlanEdit {
  strategy: EditStrategy;
  sectionHeading?: string;
  warning?: string;
}

export interface NormalizeEditStrategiesResult {
  plan: WorkflowPlan;
  warnings: string[];
  strategyError?: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/m;

export function isDocumentationFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === 'README.md' || normalized.endsWith('/README.md')) return true;
  if (/\.md$/i.test(normalized)) return true;
  return false;
}

export function extractSectionHeading(text: string): string | null {
  const match = text.match(HEADING_PATTERN);
  if (!match) return null;
  return `${match[1]} ${match[2]!.trim()}`;
}

export function findSectionRange(content: string, heading: string): { start: number; end: number } | null {
  const lines = content.split('\n');
  const headingLevel = heading.match(/^(#{1,6})\s/)?.[1]?.length ?? 0;
  const headingText = heading.replace(/^#{1,6}\s+/, '').trim().toLowerCase();

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    if (match[2]!.trim().toLowerCase() === headingText && match[1]!.length === headingLevel) {
      startLine = i;
      break;
    }
  }

  if (startLine < 0) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
      if (match && match[2]!.trim().toLowerCase() === headingText) {
        startLine = i;
        break;
      }
    }
  }

  if (startLine < 0) return null;

  let endLine = lines.length;
  const startLevel = lines[startLine]!.match(/^(#{1,6})\s/)?.[1]?.length ?? 6;
  for (let i = startLine + 1; i < lines.length; i++) {
    const match = lines[i]!.match(/^(#{1,6})\s+/);
    if (match && match[1]!.length <= startLevel) {
      endLine = i;
      break;
    }
  }

  let start = 0;
  for (let i = 0; i < startLine; i++) start += lines[i]!.length + 1;
  let end = start;
  for (let i = startLine; i < endLine; i++) end += lines[i]!.length + 1;
  if (end > 0 && content[end - 1] === '\n' && endLine < lines.length) {
    // keep trailing newline before next section
  }

  return { start, end };
}

function appendSeparator(content: string): string {
  if (content.length === 0) return '';
  if (content.endsWith('\n\n')) return '';
  if (content.endsWith('\n')) return '\n';
  return '\n\n';
}

function invalidEditMessage(file: string, converted: boolean, strategy?: EditStrategy): string {
  if (converted && strategy) {
    const label =
      strategy === 'append_section'
        ? 'append-section'
        : strategy === 'replace_section'
          ? 'replace-section'
          : strategy.replace('_', '-');
    return `Planner proposed an invalid exact edit for ${file}.\nConverted to ${label} edit.`;
  }
  return `Planner proposed an invalid exact edit for ${file}.\nNo safe fallback available.`;
}

export function resolvePlanEdit(
  projectRoot: string,
  edit: WorkflowPlanEdit,
): { success: true; edit: ResolvedPlanEdit } | { success: false; error: string } {
  const content = readFileSafe(projectRoot, edit.file);
  if (content === null) {
    const fullPath = path.join(projectRoot, edit.file);
    const error = !edit.file
      ? 'Edit missing file path'
      : `Cannot read edit target: ${edit.file}${pathExists(fullPath) ? '' : ' (file not found)'}`;
    return { success: false, error };
  }

  if (edit.search && content.includes(edit.search)) {
    return {
      success: true,
      edit: {
        ...edit,
        strategy: edit.strategy ?? 'exact',
      },
    };
  }

  if (edit.strategy === 'append_section' && isDocumentationFile(edit.file)) {
    const addition = edit.replace.trim();
    if (!addition) {
      return { success: false, error: invalidEditMessage(edit.file, false) };
    }
    return {
      success: true,
      edit: {
        ...edit,
        strategy: 'append_section',
        sectionHeading: extractSectionHeading(addition) ?? edit.sectionHeading,
        search: content,
        replace: addition,
        warning: edit.warning,
      },
    };
  }

  if (edit.strategy === 'replace_section' && isDocumentationFile(edit.file)) {
    const sectionHeading = edit.sectionHeading ?? extractSectionHeading(edit.replace) ?? extractSectionHeading(edit.search);
    if (sectionHeading) {
      const range = findSectionRange(content, sectionHeading);
      if (range) {
        return {
          success: true,
          edit: {
            ...edit,
            strategy: 'replace_section',
            sectionHeading,
            search: content.slice(range.start, range.end),
            replace: edit.replace,
            warning: edit.warning,
          },
        };
      }
    }
  }

  if (edit.strategy === 'replace_file' && isDocumentationFile(edit.file) && edit.replace) {
    return {
      success: true,
      edit: {
        ...edit,
        strategy: 'replace_file',
        search: content,
        replace: edit.replace,
        warning: edit.warning,
      },
    };
  }

  if (!isDocumentationFile(edit.file)) {
    return {
      success: false,
      error: invalidEditMessage(edit.file, false),
    };
  }

  const headingFromReplace = extractSectionHeading(edit.replace);
  const headingFromSearch = extractSectionHeading(edit.search);
  const sectionHeading = headingFromReplace ?? headingFromSearch;

  if (sectionHeading) {
    const range = findSectionRange(content, sectionHeading);
    if (range) {
      const sectionText = content.slice(range.start, range.end);
      return {
        success: true,
        edit: {
          ...edit,
          strategy: 'replace_section',
          sectionHeading,
          search: sectionText,
          replace: edit.replace,
          warning: invalidEditMessage(edit.file, true, 'replace_section'),
        },
      };
    }
  }

  const addition = edit.replace.trim();
  if (!addition) {
    return {
      success: false,
      error: invalidEditMessage(edit.file, false),
    };
  }

  return {
    success: true,
    edit: {
      ...edit,
      strategy: 'append_section',
      sectionHeading: headingFromReplace ?? undefined,
      search: content,
      replace: addition,
      warning: invalidEditMessage(edit.file, true, 'append_section'),
    },
  };
}

function pathExists(fullPath: string): boolean {
  return fs.existsSync(fullPath);
}

function applyMarkdownQuality(
  edit: ResolvedPlanEdit,
  projectRoot: string,
  userRequest?: string,
): { success: true; edit: ResolvedPlanEdit } | { success: false; error: string } {
  if (!isDocumentationFile(edit.file)) {
    return { success: true, edit };
  }

  const projectNames = getProjectDisplayNames(projectRoot);
  const userText = userRequest ? extractUserSpecifiedText(userRequest) : null;
  const fieldsToCheck: Array<{ key: 'replace' | 'search'; value: string }> = [
    { key: 'replace', value: edit.replace },
  ];

  if (edit.strategy === 'exact' && edit.search && !edit.search.includes('\n') && edit.search.length < 200) {
    fieldsToCheck.push({ key: 'search', value: edit.search });
  }

  let nextEdit = { ...edit };

  for (const field of fieldsToCheck) {
    const normalized = normalizeMarkdownEditContent(field.value, {
      userRequest,
      userText,
      projectNames,
      strategy: edit.strategy,
    });
    if (normalized.error) {
      return { success: false, error: formatMarkdownQualityError(edit.file, [normalized.error]) };
    }
    nextEdit = { ...nextEdit, [field.key]: normalized.content };
  }

  if (userText) {
    nextEdit.userRequestedText = userText;
  }

  return { success: true, edit: nextEdit };
}

export function normalizeWorkflowPlanEditStrategies(
  plan: WorkflowPlan,
  projectRoot: string,
  options?: { userRequest?: string },
): NormalizeEditStrategiesResult {
  const resolvedEdits: WorkflowPlanEdit[] = [];
  const warnings: string[] = [];

  for (const edit of plan.edits) {
    const resolved = resolvePlanEdit(projectRoot, edit);
    if (!resolved.success) {
      return { plan, warnings, strategyError: resolved.error };
    }

    const quality = applyMarkdownQuality(resolved.edit, projectRoot, options?.userRequest);
    if (!quality.success) {
      return { plan, warnings, strategyError: quality.error };
    }

    resolvedEdits.push(quality.edit);
    if (quality.edit.warning) warnings.push(quality.edit.warning);
  }

  const notes = [plan.notes, ...warnings].filter(Boolean).join('\n');
  return {
    plan: { ...plan, edits: resolvedEdits, notes: notes || undefined },
    warnings,
  };
}

export function applyEditStrategy(
  content: string,
  payload: {
    search?: string;
    replace?: string;
    editStrategy?: EditStrategy;
    sectionHeading?: string;
  },
): string {
  const strategy = payload.editStrategy ?? 'exact';

  if (strategy === 'replace_file') {
    return payload.replace ?? '';
  }

  if (strategy === 'append_section') {
    const addition = payload.replace ?? '';
    if (payload.search && content === payload.search) {
      return content + appendSeparator(content) + addition;
    }
    return content + appendSeparator(content) + addition;
  }

  if (strategy === 'replace_section') {
    const heading = payload.sectionHeading ?? extractSectionHeading(payload.replace ?? '');
    if (heading) {
      const range = findSectionRange(content, heading);
      if (range) {
        return content.slice(0, range.start) + (payload.replace ?? '') + content.slice(range.end);
      }
    }
    if (payload.search && content.includes(payload.search)) {
      return content.replace(payload.search, payload.replace ?? '');
    }
    throw new Error('Section heading not found');
  }

  const search = payload.search ?? '';
  if (!search || !content.includes(search)) {
    throw new Error('Search string not found');
  }
  return content.replace(search, payload.replace ?? '');
}
