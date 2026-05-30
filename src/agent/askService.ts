import { formatAgentMetrics, runAgentQuery } from './queryEngine.js';
import type { AgentOptions, AgentResult } from './types.js';

export type AskOptions = AgentOptions;

export type AskResult = AgentResult;

export async function askProject(options: AskOptions): Promise<AskResult> {
  return runAgentQuery(options);
}

/** @deprecated Use formatAgentMetrics — kept for backwards-compatible imports. */
export function formatAskMetrics(metrics: NonNullable<AgentResult['metrics']>): string {
  return formatAgentMetrics(metrics);
}
