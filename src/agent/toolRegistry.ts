import { editFileTool } from '../tools/editFileTool.js';
import { readFileTool } from '../tools/readFileTool.js';
import { runCommandTool } from '../tools/runCommandTool.js';
import { searchFilesTool } from '../tools/searchFilesTool.js';
import { searchSymbolsTool } from '../tools/searchSymbolsTool.js';
import { writeFileTool } from '../tools/writeFileTool.js';
import { gitDiffTool, gitStatusTool } from '../tools/gitReadTool.js';
import type { AgentToolContext, AgentToolDefinition } from './types.js';
import { rankFilesByRisk } from './riskRanker.js';

const registry = new Map<string, AgentToolDefinition>();

function register(tool: AgentToolDefinition): void {
  registry.set(tool.name, tool);
}

export function getAgentTool(name: string): AgentToolDefinition | undefined {
  return registry.get(name);
}

export function listAgentTools(): AgentToolDefinition[] {
  return [...registry.values()];
}

export function listAgentToolSummaries(): Array<{ name: string; description: string; permission: string }> {
  return listAgentTools().map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
  }));
}

function defineCoreTools(): void {
  register({
    name: 'read_file',
    description: 'Read a project file relative to the project root',
    permission: 'read',
    parameters: {
      path: { type: 'string', required: true, description: 'Relative file path' },
    },
    async execute(input, ctx) {
      const path = String(input.path ?? '');
      return readFileTool(ctx.projectRoot, path);
    },
  });

  register({
    name: 'search_files',
    description: 'Search file contents for a text query',
    permission: 'read',
    parameters: {
      query: { type: 'string', required: true, description: 'Text to search for' },
    },
    async execute(input, ctx) {
      const query = String(input.query ?? '');
      return searchFilesTool(ctx.projectRoot, ctx.map.files, query, 20);
    },
  });

  register({
    name: 'search_symbols',
    description: 'Search indexed symbols by name',
    permission: 'read',
    parameters: {
      name: { type: 'string', required: false, description: 'Symbol name filter' },
    },
    async execute(input, ctx) {
      return searchSymbolsTool({
        rootPath: ctx.projectRoot,
        name: input.name ? String(input.name) : undefined,
        limit: 20,
      });
    },
  });

  register({
    name: 'git_status',
    description: 'Read git status (read-only)',
    permission: 'read',
    parameters: {},
    async execute(_input, ctx) {
      return gitStatusTool(ctx.projectRoot);
    },
  });

  register({
    name: 'git_diff',
    description: 'Read git diff (read-only)',
    permission: 'read',
    parameters: {},
    async execute(_input, ctx) {
      return gitDiffTool(ctx.projectRoot);
    },
  });

  register({
    name: 'rank_risk_files',
    description: 'Rank project files by security and structural risk',
    permission: 'read',
    parameters: {
      limit: { type: 'number', required: false, description: 'Max files to return' },
    },
    async execute(input, ctx) {
      const limit = typeof input.limit === 'number' ? input.limit : 10;
      return rankFilesByRisk(ctx.map, ctx.structure, ctx.context, limit);
    },
  });

  register({
    name: 'propose_edit',
    description: 'Propose a file edit (creates pending operation; does not write immediately)',
    permission: 'write',
    parameters: {
      path: { type: 'string', required: true },
      search: { type: 'string', required: true },
      replace: { type: 'string', required: true },
    },
    async execute(input, ctx) {
      return editFileTool(
        ctx.projectRoot,
        String(input.path ?? ''),
        String(input.search ?? ''),
        String(input.replace ?? ''),
      );
    },
  });

  register({
    name: 'propose_write',
    description: 'Propose writing a file (creates pending operation; does not write immediately)',
    permission: 'write',
    parameters: {
      path: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    async execute(input, ctx) {
      return writeFileTool(ctx.projectRoot, String(input.path ?? ''), String(input.content ?? ''));
    },
  });

  register({
    name: 'propose_command',
    description: 'Propose a terminal command (creates pending operation; does not execute immediately)',
    permission: 'command',
    parameters: {
      command: { type: 'string', required: true },
    },
    async execute(input, ctx) {
      return runCommandTool(ctx.projectRoot, String(input.command ?? ''));
    },
  });
}

let initialized = false;

export function ensureAgentToolsRegistered(): void {
  if (initialized) return;
  defineCoreTools();
  initialized = true;
}

export function resetAgentToolsForTests(): void {
  registry.clear();
  initialized = false;
  ensureAgentToolsRegistered();
}

ensureAgentToolsRegistered();

export function buildAgentToolContext(
  projectRoot: string,
  loaded: {
    scan: AgentToolContext['scan'];
    map: AgentToolContext['map'];
    structure: AgentToolContext['structure'];
    context: AgentToolContext['context'];
  },
): AgentToolContext {
  return {
    projectRoot,
    scan: loaded.scan,
    map: loaded.map,
    structure: loaded.structure,
    context: loaded.context,
  };
}
