import { executeReadOnlyGit } from '../security/commandApproval.js';

export interface GitReadToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function gitStatusTool(projectRoot: string): Promise<GitReadToolResult> {
  return executeReadOnlyGit(projectRoot, 'git status');
}

export async function gitDiffTool(projectRoot: string): Promise<GitReadToolResult> {
  return executeReadOnlyGit(projectRoot, 'git diff');
}

export async function gitLogTool(projectRoot: string): Promise<GitReadToolResult> {
  return executeReadOnlyGit(projectRoot, 'git log --oneline');
}

export async function gitBranchTool(projectRoot: string): Promise<GitReadToolResult> {
  return executeReadOnlyGit(projectRoot, 'git branch');
}
