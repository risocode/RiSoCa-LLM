export const ANALYZE_PROMPT = {
  id: 'analyze',
  version: '1.0.0',
  template: `Provide a detailed structural analysis of this codebase.

Project Map Stats:
- Files: {{fileCount}}
- Symbols: {{symbolCount}}
- Routes: {{routeCount}}
- Import graph depth: {{depth}}

Top files by role:
{{topFiles}}

Import relationships:
{{importSummary}}`,
};

export function renderAnalyzePrompt(vars: Record<string, string>): string {
  let output = ANALYZE_PROMPT.template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}
