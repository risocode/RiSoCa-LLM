import type { ProjectContext, ProjectMap, ScanResult, StructuralAnalysis } from '../types.js';
import type { AskIntent } from '../context/contextSelector.js';

export type ToolPermission = 'read' | 'write' | 'command';

export interface ToolParameterSpec {
  type: 'string' | 'number';
  required?: boolean;
  description?: string;
}

export interface AgentToolContext {
  projectRoot: string;
  scan: ScanResult;
  map: ProjectMap;
  structure: StructuralAnalysis;
  context: ProjectContext;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: Record<string, ToolParameterSpec>;
  execute(input: Record<string, unknown>, ctx: AgentToolContext): Promise<unknown>;
}

export interface ToolCallRequest {
  tool: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
  pendingOperationId?: string;
  autoExecuted: boolean;
}

export interface EvidenceBundle {
  question: string;
  intents: AskIntent[];
  baseContext: string;
  sectionsIncluded: string[];
  rankedRiskFiles: Array<{ file: string; score: number; reasons: string[] }>;
  toolResults: ToolExecutionResult[];
  fileSnippets: Array<{ file: string; excerpt: string }>;
}

export interface AgentModelToolResponse {
  action: 'tools';
  calls: ToolCallRequest[];
  reasoning?: string;
}

export interface AgentModelFinalResponse {
  action: 'final';
  answer: string;
}

export type AgentModelResponse = AgentModelToolResponse | AgentModelFinalResponse;

export interface AgentLoopMetrics {
  turnsUsed: number;
  maxTurns: number;
  toolsExecuted: number;
  readToolsAutoRun: number;
  pendingOperationsCreated: number;
  evidenceSections: string[];
  provider: string;
  model: string;
  totalMs: number;
}

export interface AgentResult {
  success: boolean;
  answer?: string;
  evidence?: EvidenceBundle;
  metrics?: AgentLoopMetrics;
  error?: string;
}

export interface AgentOptions {
  projectPath: string;
  question: string;
  fetchImpl?: typeof fetch;
  maxTurns?: number;
  chatFn?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<{ content: string; model: string; provider: string }>;
}
