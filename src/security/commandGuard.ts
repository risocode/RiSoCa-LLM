export type CommandClassification =
  | { kind: 'blocked'; reason: string }
  | { kind: 'read_only_git'; command: string; gitArgs: string[] }
  | { kind: 'pending_whitelist'; command: string; argv: string[]; modifiesFiles: boolean }
  | { kind: 'pending_git_write'; command: string; argv: string[] };

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\b|\brmdir\b|\bdel\b|\berase\b/i, reason: 'Destructive delete command blocked' },
  { pattern: /\bformat\b/i, reason: 'Format command blocked' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash|powershell)/i, reason: 'Remote script execution blocked' },
  { pattern: /-ExecutionPolicy\s+Bypass|executionpolicy\s+bypass/i, reason: 'PowerShell bypass blocked' },
  { pattern: /\bgit\s+push\b|\bgit\s+push\s+--force|\bforce-push\b/i, reason: 'Git push blocked' },
  { pattern: /\bgit\s+reset\s+--hard\b|\breset\s+--hard\b/i, reason: 'Git reset --hard blocked' },
  { pattern: /\bgit\s+clean\b/i, reason: 'Git clean blocked' },
  { pattern: /\bnpm\s+(install|i)\b|\bnpm\s+ci\b|\byarn\s+install\b|\bpnpm\s+install\b/i, reason: 'Package install blocked without explicit approval workflow' },
  { pattern: /[;&|`$<>]|&&|\|\|/, reason: 'Shell chaining/redirection blocked' },
];

const INCOMPLETE_NPM_COMMANDS: Array<{ pattern: RegExp; expected: string }> = [
  { pattern: /^npm run analyze --$/i, expected: 'npm run analyze -- <projectPath>' },
  { pattern: /^npm run scan --$/i, expected: 'npm run scan -- <projectPath>' },
  { pattern: /^npm run ask --$/i, expected: 'npm run ask -- <projectPath> "<question>"' },
  { pattern: /^npm run analyze$/i, expected: 'npm run analyze -- <projectPath>' },
  { pattern: /^npm run scan$/i, expected: 'npm run scan -- <projectPath>' },
];

/** Path token: ".", relative dir, unquoted path, or quoted absolute path */
const PATH_ARG = String.raw`(?:\.\.?/?|"[^"]+"|[A-Za-z]:\\(?:[^"\s]+|\\ )+|[^\s"]+)`;

const WHITELIST_PENDING: Array<{ match: RegExp; modifiesFiles?: boolean }> = [
  { match: /^npm\s+test(\s|$)/i },
  { match: /^npm\s+run\s+build(\s|$)/i, modifiesFiles: true },
  { match: new RegExp(`^npm\\s+run\\s+scan\\s+--\\s+${PATH_ARG}$`, 'i') },
  { match: new RegExp(`^npm\\s+run\\s+analyze\\s+--\\s+${PATH_ARG}$`, 'i') },
  { match: new RegExp(`^npm\\s+run\\s+ask\\s+--\\s+${PATH_ARG}\\s+.`, 'i') },
  { match: /^git\s+status(\s|$)/i },
  { match: /^git\s+diff(\s|$)/i },
  { match: /^git\s+log\s+--oneline(\s|$)/i },
];

const READ_ONLY_GIT: Array<{ match: RegExp; gitArgs: string[] }> = [
  { match: /^git\s+status(\s|$)/i, gitArgs: ['status'] },
  { match: /^git\s+diff(\s|$)/i, gitArgs: ['diff'] },
  { match: /^git\s+log(\s|$)/i, gitArgs: ['log', '--oneline', '-n', '20'] },
  { match: /^git\s+branch(\s|$)/i, gitArgs: ['branch', '-a'] },
];

const GIT_WRITE: Array<{ match: RegExp }> = [
  { match: /^git\s+commit(\s|$)/i },
  { match: /^git\s+checkout(\s|$)/i },
  { match: /^git\s+merge(\s|$)/i },
  { match: /^git\s+revert(\s|$)/i },
];

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const normalized = command.trim();
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function classifyCommand(command: string): CommandClassification {
  const normalized = normalizeCommand(command);
  if (!normalized) return { kind: 'blocked', reason: 'Empty command' };

  for (const incomplete of INCOMPLETE_NPM_COMMANDS) {
    if (incomplete.pattern.test(normalized)) {
      return {
        kind: 'blocked',
        reason: `Validation command is incomplete. Expected:\n${incomplete.expected}`,
      };
    }
  }

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(normalized)) {
      return { kind: 'blocked', reason: blocked.reason };
    }
  }

  for (const entry of READ_ONLY_GIT) {
    if (entry.match.test(normalized)) {
      const tokens = tokenizeCommand(normalized);
      const gitArgs = tokens[0]?.toLowerCase() === 'git' ? tokens.slice(1) : entry.gitArgs;
      return { kind: 'read_only_git', command: normalized, gitArgs };
    }
  }

  for (const entry of GIT_WRITE) {
    if (entry.match.test(normalized)) {
      return { kind: 'pending_git_write', command: normalized, argv: tokenizeCommand(normalized) };
    }
  }

  for (const entry of WHITELIST_PENDING) {
    if (entry.match.test(normalized)) {
      return {
        kind: 'pending_whitelist',
        command: normalized,
        argv: tokenizeCommand(normalized),
        modifiesFiles: entry.modifiesFiles ?? false,
      };
    }
  }

  return { kind: 'blocked', reason: 'Command is not on the approved whitelist' };
}

export function isReadOnlyGitCommand(command: string): boolean {
  return classifyCommand(command).kind === 'read_only_git';
}

export function requiresApproval(classification: CommandClassification): boolean {
  return classification.kind === 'pending_whitelist' || classification.kind === 'pending_git_write';
}

export function modifiesProjectFiles(classification: CommandClassification): boolean {
  if (classification.kind === 'pending_git_write') return true;
  if (classification.kind === 'pending_whitelist') return classification.modifiesFiles;
  return false;
}

export function summarizeCommand(command: string, classification: CommandClassification): string {
  if (classification.kind === 'blocked') return classification.reason;
  if (classification.kind === 'read_only_git') return `Read-only git: ${command}`;
  if (classification.kind === 'pending_git_write') return `Git write (approval required): ${command}`;
  return `Terminal command (approval required): ${command}`;
}
