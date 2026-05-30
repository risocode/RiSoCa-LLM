import { normalizeCommand } from '../security/commandGuard.js';
import { validateScanPath } from '../security/pathGuard.js';
import type { WorkflowPlan } from './workflowTypes.js';

const INCOMPLETE_COMMANDS: Array<{ pattern: RegExp; expected: string }> = [
  { pattern: /^npm run analyze --$/i, expected: 'npm run analyze -- <projectPath>' },
  { pattern: /^npm run scan --$/i, expected: 'npm run scan -- <projectPath>' },
  { pattern: /^npm run ask --$/i, expected: 'npm run ask -- <projectPath> "<question>"' },
  { pattern: /^npm run analyze$/i, expected: 'npm run analyze -- <projectPath>' },
  { pattern: /^npm run scan$/i, expected: 'npm run scan -- <projectPath>' },
];

export function formatCommandProjectPath(projectRoot: string): string {
  if (projectRoot === '.' || projectRoot === './') return '.';
  const validation = validateScanPath(projectRoot);
  if (!validation.valid) return projectRoot;
  if (validation.absolutePath.includes(' ')) return `"${validation.absolutePath}"`;
  return validation.absolutePath;
}

export function getIncompleteCommandMessage(command: string): string | null {
  const normalized = normalizeCommand(command);
  for (const entry of INCOMPLETE_COMMANDS) {
    if (entry.pattern.test(normalized)) {
      return `Validation command is incomplete. Expected:\n${entry.expected}`;
    }
  }
  return null;
}

export function normalizeValidationCommand(command: string, projectRoot: string): string {
  const normalized = normalizeCommand(command);
  const projectArg = formatCommandProjectPath(projectRoot);

  if (/^npm run analyze --$/i.test(normalized) || /^npm run analyze$/i.test(normalized)) {
    return `npm run analyze -- ${projectArg}`;
  }
  if (/^npm run scan --$/i.test(normalized) || /^npm run scan$/i.test(normalized)) {
    return `npm run scan -- ${projectArg}`;
  }

  return normalized;
}

export function normalizeWorkflowPlanValidation(plan: WorkflowPlan, projectRoot: string): WorkflowPlan {
  return {
    ...plan,
    validationCommands: plan.validationCommands.map((cmd) => normalizeValidationCommand(cmd, projectRoot)),
  };
}

export function getAllowedValidationCommands(_projectRoot: string): Set<string> {
  const projectArg = formatCommandProjectPath(_projectRoot);
  const allowed = new Set([
    'npm test',
    'npm run build',
    `npm run analyze -- ${projectArg}`,
    `npm run scan -- ${projectArg}`,
    'npm run analyze -- .',
    'npm run scan -- .',
  ]);
  return allowed;
}

export function validateWorkflowValidationCommand(command: string, projectRoot: string): string | null {
  const incomplete = getIncompleteCommandMessage(command);
  if (incomplete) return incomplete;

  const normalized = normalizeValidationCommand(command, projectRoot);
  const allowed = getAllowedValidationCommands(projectRoot);
  if (!allowed.has(normalized)) {
    return `Validation command not allowed: ${command}`;
  }
  return null;
}

export function assertNoIncompleteValidationCommands(commands: string[]): string | null {
  for (const command of commands) {
    const incomplete = getIncompleteCommandMessage(command);
    if (incomplete) return incomplete;
  }
  return null;
}
