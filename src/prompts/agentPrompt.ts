import type { AgentModelResponse } from '../agent/types.js';

export function AGENT_SYSTEM_PROMPT(
  tools: Array<{ name: string; description: string; permission: string }>,
): string {
  const toolLines = tools
    .map((t) => `- ${t.name} [${t.permission}]: ${t.description}`)
    .join('\n');

  return `You are RiSoCa, a local project intelligence agent.

Rules:
- Use ONLY provided evidence and tool results. Every claim must be traceable to evidence.
- Do not invent files, routes, dependencies, frontend/backend layers, or frameworks.
- If framework is "none", say "No framework detected."
- Do not mention frontend, backend, SPA, or single-page application unless evidence shows routes, server files, or a detected web framework.
- For architecture questions, describe actual files, imports, languages, package manager, and entry points only when detected.
- fan-in = many files depend on this file; fan-out = this file depends on many files; both indicate coupling/coordination complexity.
- Do NOT describe fan-in/fan-out as duplication, over-engineering, or security vulnerabilities.
- Read-only tools may be auto-run; write/command tools only create pending operations.
- Never claim files were modified or commands executed.
- Final answers must use exactly four sections once, in order: Direct Answer, Evidence, Risks, Next Action.

Available tools:
${toolLines}

Respond with JSON only:
{"action":"tools","calls":[{"tool":"read_file","input":{"path":"src/example.ts"}}]}
OR
{"action":"final","answer":"## Direct Answer\\n...\\n## Evidence\\n- ...\\n## Risks\\n- ...\\n## Next Action\\n- ..."}`;
}

export function buildAgentTurnMessage(input: {
  question: string;
  evidence: string;
  turn: number;
  maxTurns: number;
  priorMessages: Array<{ role: string; content: string }>;
}): string {
  const history =
    input.priorMessages.length > 0
      ? `\nPrior turns:\n${input.priorMessages.map((m) => `[${m.role}] ${m.content.slice(0, 500)}`).join('\n')}\n`
      : '';

  return [
    `Turn ${input.turn} of ${input.maxTurns}`,
    '',
    'Evidence:',
    input.evidence,
    history,
    `Question: ${input.question}`,
    '',
    'If you need more evidence, request read-only tools. Otherwise respond with action final.',
  ].join('\n');
}

export function parseAgentModelResponse(content: string): AgentModelResponse | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), trimmed].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { action?: string; answer?: string; calls?: unknown[] };
      if (parsed.action === 'final' && typeof parsed.answer === 'string') {
        return { action: 'final', answer: parsed.answer };
      }
      if (parsed.action === 'tools' && Array.isArray(parsed.calls)) {
        const calls = parsed.calls
          .map((c) => c as { tool?: string; input?: Record<string, unknown> })
          .filter((c) => typeof c.tool === 'string')
          .map((c) => ({ tool: c.tool!, input: c.input ?? {} }));
        if (calls.length > 0) return { action: 'tools', calls };
      }
    } catch {
      // try next candidate
    }
  }

  if (trimmed.includes('## Direct Answer')) {
    return { action: 'final', answer: trimmed };
  }

  return null;
}
