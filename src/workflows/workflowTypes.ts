export type WorkflowType = 'fix' | 'refactor' | 'test' | 'review';

export type WorkflowStatus =
  | 'created'
  | 'planned'
  | 'awaiting_approval'
  | 'executing'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowStepKind = 'edit_file' | 'write_file' | 'delete_file' | 'command' | 'validation';

export type WorkflowStepStatus =
  | 'proposed'
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'skipped'
  | 'failed';

import type { EditStrategy } from '../types.js';

export type { EditStrategy };

export interface WorkflowPlanEdit {
  file: string;
  search: string;
  replace: string;
  summary: string;
  strategy?: EditStrategy;
  sectionHeading?: string;
  warning?: string;
  userRequestedText?: string;
}

export interface WorkflowPlan {
  diagnosis: string;
  targetFiles: string[];
  edits: WorkflowPlanEdit[];
  validationCommands: string[];
  notes?: string;
}

export interface WorkflowValidationResult {
  commands: string[];
  status: 'proposed' | 'pending_approval' | 'completed' | 'skipped';
  message?: string;
}

export interface WorkflowLimits {
  maxSteps: number;
  maxEditsPerFile: number;
  maxPlanningCycles: number;
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxSteps: 8,
  maxEditsPerFile: 1,
  maxPlanningCycles: 1,
};

export interface WorkflowStep {
  id: string;
  workflowId: string;
  stepIndex: number;
  kind: WorkflowStepKind;
  status: WorkflowStepStatus;
  target: string;
  payload: Record<string, unknown>;
  linkedOperationId: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface Workflow {
  id: string;
  projectId: number;
  type: WorkflowType;
  status: WorkflowStatus;
  userRequest: string;
  plan: WorkflowPlan | null;
  validation: WorkflowValidationResult | null;
  planningCycles: number;
  linkedOperationIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  error: string | null;
  steps: WorkflowStep[];
}

export interface WorkflowStartResult {
  success: boolean;
  workflow?: Workflow;
  error?: string;
}

export interface PlanGeneratorInput {
  type: WorkflowType;
  userRequest: string;
  projectContext: string;
  analysisSummary: string;
}

export type PlanGenerator = (input: PlanGeneratorInput) => Promise<WorkflowPlan>;
