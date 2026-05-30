export const SCAN_PROMPT = {
  id: 'scan',
  version: '1.0.0',
  template: `Analyze the following project scan results and summarize architecture, risks, and improvement opportunities.

Project: {{projectName}}
Path: {{rootPath}}
Languages: {{languages}}
Framework: {{framework}}
Health Score: {{healthScore}}
Complexity Score: {{complexityScore}}

Risks:
{{risks}}`,
};

export function renderScanPrompt(vars: Record<string, string>): string {
  let output = SCAN_PROMPT.template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}
