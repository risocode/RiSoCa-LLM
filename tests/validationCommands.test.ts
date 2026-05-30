import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../src/security/commandGuard.js';
import {
  assertNoIncompleteValidationCommands,
  normalizeValidationCommand,
  normalizeWorkflowPlanValidation,
  validateWorkflowValidationCommand,
} from '../src/workflows/validationCommands.js';

describe('validationCommands', () => {
  it('allows npm run analyze -- .', () => {
    expect(validateWorkflowValidationCommand('npm run analyze -- .', '.')).toBeNull();
    expect(classifyCommand('npm run analyze -- .').kind).toBe('pending_whitelist');
  });

  it('rejects npm run analyze -- with clear message', () => {
    const error = validateWorkflowValidationCommand('npm run analyze --', '.');
    expect(error).toContain('Validation command is incomplete');
    expect(error).toContain('npm run analyze -- <projectPath>');

    const blocked = classifyCommand('npm run analyze --');
    expect(blocked.kind).toBe('blocked');
    if (blocked.kind === 'blocked') {
      expect(blocked.reason).toContain('Validation command is incomplete');
    }
  });

  it('normalizes incomplete analyze command to include project path', () => {
    expect(normalizeValidationCommand('npm run analyze --', '.')).toBe('npm run analyze -- .');
    expect(normalizeValidationCommand('npm run scan --', '.')).toBe('npm run scan -- .');
  });

  it('never leaves incomplete commands after workflow normalization', () => {
    const normalized = normalizeWorkflowPlanValidation(
      {
        diagnosis: 'test',
        targetFiles: [],
        edits: [],
        validationCommands: ['npm run analyze --', 'npm test'],
      },
      '.',
    );
    expect(assertNoIncompleteValidationCommands(normalized.validationCommands)).toBeNull();
    expect(normalized.validationCommands).toContain('npm run analyze -- .');
    expect(normalized.validationCommands).not.toContain('npm run analyze --');
  });
});
