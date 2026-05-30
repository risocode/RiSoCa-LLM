import { appendAuditEvent } from '../security/auditLog.js';
import { getAgentTool } from './toolRegistry.js';
import type {
  AgentToolContext,
  AgentToolDefinition,
  ToolCallRequest,
  ToolExecutionResult,
  ToolParameterSpec,
} from './types.js';

export function validateToolInput(
  tool: AgentToolDefinition,
  input: Record<string, unknown>,
): string | null {
  for (const [key, spec] of Object.entries(tool.parameters)) {
    if (spec.required && (input[key] === undefined || input[key] === null || input[key] === '')) {
      return `Missing required parameter: ${key}`;
    }
    if (input[key] !== undefined && input[key] !== null) {
      const expected = spec.type;
      const actual = typeof input[key];
      if (expected === 'string' && actual !== 'string') return `Parameter ${key} must be a string`;
      if (expected === 'number' && actual !== 'number') return `Parameter ${key} must be a number`;
    }
  }
  return null;
}

function isAutoExecutable(permission: AgentToolDefinition['permission']): boolean {
  return permission === 'read';
}

export async function executeToolCall(
  call: ToolCallRequest,
  ctx: AgentToolContext,
): Promise<ToolExecutionResult> {
  const tool = getAgentTool(call.tool);
  if (!tool) {
    appendAuditEvent({
      event: 'agent_tool_blocked',
      message: `Unknown tool: ${call.tool}`,
    });
    return {
      tool: call.tool,
      success: false,
      error: `Unknown tool: ${call.tool}`,
      autoExecuted: false,
    };
  }

  const validationError = validateToolInput(tool, call.input);
  if (validationError) {
    appendAuditEvent({
      event: 'agent_tool_validation_failed',
      message: `${tool.name}: ${validationError}`,
    });
    return {
      tool: tool.name,
      success: false,
      error: validationError,
      autoExecuted: false,
    };
  }

  if (!isAutoExecutable(tool.permission)) {
    appendAuditEvent({
      event: 'agent_tool_pending',
      message: `${tool.name} requires approval — creating pending operation only`,
    });
  }

  try {
    const data = await tool.execute(call.input, ctx);
    const resultObj = data as { success?: boolean; operationId?: string; error?: string };
    const success = resultObj.success !== false;
    const pendingOperationId = resultObj.operationId;

    appendAuditEvent({
      event: success ? 'agent_tool_executed' : 'agent_tool_failed',
      operationId: pendingOperationId,
      message: `${tool.name} ${success ? 'completed' : 'failed'}${isAutoExecutable(tool.permission) ? '' : ' (pending)'}`,
    });

    return {
      tool: tool.name,
      success,
      data,
      error: success ? undefined : resultObj.error ?? 'Tool failed',
      pendingOperationId,
      autoExecuted: isAutoExecutable(tool.permission) && success,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    appendAuditEvent({
      event: 'agent_tool_failed',
      message: `${tool.name}: ${message}`,
    });
    return {
      tool: tool.name,
      success: false,
      error: message,
      autoExecuted: false,
    };
  }
}

export function describeToolParameters(parameters: Record<string, ToolParameterSpec>): string {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return 'none';
  return entries
    .map(([name, spec]) => `${name}:${spec.type}${spec.required ? '*' : ''}`)
    .join(', ');
}
