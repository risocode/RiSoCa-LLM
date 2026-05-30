import type { WorkflowPlan } from '../workflows/workflowTypes.js';

export const WORKFLOW_PLANNER_SYSTEM_PROMPT = `You are RiSoCa, a local code workflow planner.

Rules:
- Use ONLY the provided project context and analysis.
- Do not invent files that are not in context.
- Do not modify .env or secret files.
- Propose at most 3 file edits.
- For any single file, produce only ONE edit operation.
- Combine all intended changes to the same file (especially README.md and docs) into one consolidated edit.
- Do not create multiple edit steps targeting the same file.
- Do not invent exact search strings. Only use search/replace when the exact source text is provided in context.
- For README and documentation updates, prefer append-section or replace-section style edits with a clear markdown heading.
- Keep one operation per file.
- For documentation files, prefer one consolidated section update instead of fragile exact-string patches.
- Every exact edit must use search text copied verbatim from the provided context.
- Propose validation commands only from: npm test, npm run build, npm run analyze -- ., npm run scan -- .
- Always include the project path after -- for scan/analyze (use ".").
- Do not claim changes were applied.

Respond with JSON only in this shape:
{
  "diagnosis": "short diagnosis",
  "targetFiles": ["relative/path.ts"],
  "edits": [
    {
      "file": "relative/path.ts",
      "search": "exact text to find (only when verbatim in context)",
      "replace": "replacement text or full section markdown",
      "summary": "why this edit helps",
      "strategy": "exact | append_section | replace_section | replace_file"
    }
  ],
  "validationCommands": ["npm test"],
  "notes": "optional"
}`;

export function buildWorkflowPlannerMessage(input: {
  type: string;
  userRequest: string;
  projectContext: string;
  analysisSummary: string;
}): string {
  return [
    `Workflow type: ${input.type}`,
    `User request: ${input.userRequest}`,
    '',
    'Analysis summary:',
    input.analysisSummary,
    '',
    'Project context:',
    input.projectContext,
  ].join('\n');
}

export function parseWorkflowPlanJson(content: string): WorkflowPlan | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as {
      diagnosis?: string;
      targetFiles?: string[];
      edits?: Array<{
        file?: string;
        search?: string;
        replace?: string;
        summary?: string;
        strategy?: string;
        sectionHeading?: string;
      }>;
      validationCommands?: string[];
      notes?: string;
    };
    if (!parsed || typeof parsed.diagnosis !== 'string') return null;
    return {
      diagnosis: parsed.diagnosis,
      targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles.map(String) : [],
      edits: Array.isArray(parsed.edits)
        ? parsed.edits.map((e) => ({
            file: String(e.file ?? ''),
            search: String(e.search ?? ''),
            replace: String(e.replace ?? ''),
            summary: String(e.summary ?? 'Proposed edit'),
            strategy: parseEditStrategy(e.strategy),
            sectionHeading: e.sectionHeading ? String(e.sectionHeading) : undefined,
          }))
        : [],
      validationCommands: Array.isArray(parsed.validationCommands)
        ? parsed.validationCommands.map(String)
        : ['npm test'],
      notes: parsed.notes ? String(parsed.notes) : undefined,
    };
  } catch {
    return null;
  }
}

function parseEditStrategy(value: string | undefined) {
  if (
    value === 'exact' ||
    value === 'append_section' ||
    value === 'replace_section' ||
    value === 'replace_file'
  ) {
    return value;
  }
  return undefined;
}
