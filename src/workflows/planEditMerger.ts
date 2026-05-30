import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowPlan, WorkflowPlanEdit } from './workflowTypes.js';

export interface MergePlanResult {
  plan: WorkflowPlan;
  mergedFiles: Array<{ file: string; count: number }>;
  mergeError?: string;
}

function mergeNote(count: number, file: string): string {
  return `Merged ${count} planned edits into one operation for ${file}`;
}

function mergeEditsForFile(
  projectRoot: string,
  file: string,
  edits: WorkflowPlanEdit[],
): { success: true; edit: WorkflowPlanEdit } | { success: false; error: string } {
  const fullPath = path.join(projectRoot, file);
  if (!fs.existsSync(fullPath)) {
    return {
      success: false,
      error: [
        `Cannot merge ${edits.length} edits for missing file: ${file}`,
        `Duplicated file paths: ${file}`,
        'Try rerunning with a narrower request.',
      ].join('\n'),
    };
  }

  const original = fs.readFileSync(fullPath, 'utf-8');
  let current = original;

  for (const edit of edits) {
    if (!edit.search) {
      return {
        success: false,
        error: [
          `Cannot merge edits for ${file}: edit missing search text`,
          `Duplicated file paths: ${file}`,
          'Try rerunning with a narrower request.',
        ].join('\n'),
      };
    }
    if (!current.includes(edit.search)) {
      return {
        success: false,
        error: [
          `Cannot merge ${edits.length} edits for ${file}: search text not found after prior changes`,
          `Duplicated file paths: ${file}`,
          'Try rerunning with a narrower request or one combined edit.',
        ].join('\n'),
      };
    }
    current = current.replace(edit.search, edit.replace);
  }

  if (current === original) {
    return {
      success: false,
      error: [
        `Cannot merge edits for ${file}: merged result is unchanged`,
        `Duplicated file paths: ${file}`,
        'Try rerunning with a narrower request.',
      ].join('\n'),
    };
  }

  return {
    success: true,
    edit: {
      file,
      search: original,
      replace: current,
      summary: edits.map((e) => e.summary).join('; '),
    },
  };
}

export function normalizeWorkflowPlanEdits(plan: WorkflowPlan, projectRoot: string): MergePlanResult {
  const byFile = new Map<string, WorkflowPlanEdit[]>();
  for (const edit of plan.edits) {
    const list = byFile.get(edit.file) ?? [];
    list.push(edit);
    byFile.set(edit.file, list);
  }

  const mergedEdits: WorkflowPlanEdit[] = [];
  const mergedFiles: Array<{ file: string; count: number }> = [];
  const mergeNotes: string[] = [];

  for (const [file, edits] of byFile) {
    if (edits.length === 1) {
      mergedEdits.push(edits[0]!);
      continue;
    }

    const merged = mergeEditsForFile(projectRoot, file, edits);
    if (!merged.success) {
      return { plan, mergedFiles: [], mergeError: merged.error };
    }

    mergedEdits.push(merged.edit);
    mergedFiles.push({ file, count: edits.length });
    mergeNotes.push(mergeNote(edits.length, file));
  }

  const notes = [plan.notes, ...mergeNotes].filter(Boolean).join('\n');
  return {
    plan: { ...plan, edits: mergedEdits, notes: notes || undefined },
    mergedFiles,
  };
}

export function applyMergedEditPreview(original: string, edit: WorkflowPlanEdit): string {
  if (edit.search === original) return edit.replace;
  return original.replace(edit.search, edit.replace);
}
