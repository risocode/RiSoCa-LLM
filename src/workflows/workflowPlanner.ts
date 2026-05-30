import { formatAskProviderError } from '../utils/ollamaHelp.js';
import { loadConfig } from '../security/pathGuard.js';
import { createAIProvider } from '../providers/providerFactory.js';
import {
  WORKFLOW_PLANNER_SYSTEM_PROMPT,
  buildWorkflowPlannerMessage,
  parseWorkflowPlanJson,
} from '../prompts/workflowPrompt.js';
import { ProviderError } from '../providers/aiProvider.js';
import type { PlanGenerator, PlanGeneratorInput, WorkflowPlan } from './workflowTypes.js';

export async function generateWorkflowPlanWithAi(
  input: PlanGeneratorInput,
  fetchImpl?: typeof fetch,
): Promise<WorkflowPlan> {
  const aiConfig = loadConfig().ai;
  const provider = createAIProvider(aiConfig, fetchImpl);
  const userMessage = buildWorkflowPlannerMessage({
    type: input.type,
    userRequest: input.userRequest,
    projectContext: input.projectContext,
    analysisSummary: input.analysisSummary,
  });

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: WORKFLOW_PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      model: aiConfig.model,
      maxOutputChars: aiConfig.maxOutputChars,
    });

    const plan = parseWorkflowPlanJson(response.content);
    if (!plan) throw new ProviderError('Planner returned invalid JSON plan', 'invalid_plan');
    return plan;
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Planning failed';
    throw new ProviderError(formatAskProviderError(raw, loadConfig().ai.model), 'planning_failed');
  }
}

export const defaultPlanGenerator: PlanGenerator = generateWorkflowPlanWithAi;
