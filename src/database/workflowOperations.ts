import type Database from 'better-sqlite3';
import type {
  Workflow,
  WorkflowPlan,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowStepStatus,
  WorkflowType,
  WorkflowValidationResult,
} from '../workflows/workflowTypes.js';

interface WorkflowRow {
  id: string;
  project_id: number;
  type: WorkflowType;
  status: WorkflowStatus;
  user_request: string;
  plan_json: string | null;
  validation_json: string | null;
  planning_cycles: number;
  linked_operation_ids_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  step_index: number;
  kind: WorkflowStepKind;
  status: WorkflowStepStatus;
  target: string;
  payload_json: string | null;
  linked_operation_id: string | null;
  result_json: string | null;
  created_at: string;
}

function mapWorkflow(row: WorkflowRow, steps: WorkflowStep[] = []): Workflow {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    userRequest: row.user_request,
    plan: row.plan_json ? (JSON.parse(row.plan_json) as WorkflowPlan) : null,
    validation: row.validation_json ? (JSON.parse(row.validation_json) as WorkflowValidationResult) : null,
    planningCycles: row.planning_cycles,
    linkedOperationIds: row.linked_operation_ids_json
      ? (JSON.parse(row.linked_operation_ids_json) as string[])
      : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    error: row.error,
    steps,
  };
}

function mapStep(row: WorkflowStepRow): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepIndex: row.step_index,
    kind: row.kind,
    status: row.status,
    target: row.target,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : {},
    linkedOperationId: row.linked_operation_id,
    result: row.result_json ? (JSON.parse(row.result_json) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

export function insertWorkflow(
  db: Database.Database,
  workflow: Omit<Workflow, 'steps' | 'plan' | 'validation' | 'linkedOperationIds'> & {
    plan?: WorkflowPlan | null;
    validation?: WorkflowValidationResult | null;
    linkedOperationIds?: string[];
  },
): Workflow {
  db.prepare(`
    INSERT INTO workflows (
      id, project_id, type, status, user_request, plan_json, validation_json,
      planning_cycles, linked_operation_ids_json, error, created_at, updated_at, completed_at, cancelled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflow.id,
    workflow.projectId,
    workflow.type,
    workflow.status,
    workflow.userRequest,
    workflow.plan ? JSON.stringify(workflow.plan) : null,
    workflow.validation ? JSON.stringify(workflow.validation) : null,
    workflow.planningCycles,
    JSON.stringify(workflow.linkedOperationIds ?? []),
    workflow.error,
    workflow.createdAt,
    workflow.updatedAt,
    workflow.completedAt,
    workflow.cancelledAt,
  );
  return getWorkflowById(db, workflow.id)!;
}

export function updateWorkflow(
  db: Database.Database,
  id: string,
  patch: Partial<{
    status: WorkflowStatus;
    plan: WorkflowPlan | null;
    validation: WorkflowValidationResult | null;
    planningCycles: number;
    linkedOperationIds: string[];
    error: string | null;
    updatedAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  }>,
): void {
  const current = getWorkflowById(db, id);
  if (!current) return;

  const nextPlan = patch.plan !== undefined ? patch.plan : current.plan;
  const nextValidation = patch.validation !== undefined ? patch.validation : current.validation;

  db.prepare(`
    UPDATE workflows SET
      status = ?,
      plan_json = ?,
      validation_json = ?,
      planning_cycles = ?,
      linked_operation_ids_json = ?,
      error = ?,
      updated_at = ?,
      completed_at = ?,
      cancelled_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? current.status,
    nextPlan ? JSON.stringify(nextPlan) : null,
    nextValidation ? JSON.stringify(nextValidation) : null,
    patch.planningCycles ?? current.planningCycles,
    JSON.stringify(patch.linkedOperationIds ?? current.linkedOperationIds),
    patch.error !== undefined ? patch.error : current.error,
    patch.updatedAt ?? new Date().toISOString(),
    patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    patch.cancelledAt !== undefined ? patch.cancelledAt : current.cancelledAt,
    id,
  );
}

export function insertWorkflowStep(db: Database.Database, step: WorkflowStep): WorkflowStep {
  db.prepare(`
    INSERT INTO workflow_steps (
      id, workflow_id, step_index, kind, status, target, payload_json,
      linked_operation_id, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    step.id,
    step.workflowId,
    step.stepIndex,
    step.kind,
    step.status,
    step.target,
    JSON.stringify(step.payload),
    step.linkedOperationId,
    step.result ? JSON.stringify(step.result) : null,
    step.createdAt,
  );
  return step;
}

export function listWorkflowSteps(db: Database.Database, workflowId: string): WorkflowStep[] {
  const rows = db
    .prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_index ASC')
    .all(workflowId) as WorkflowStepRow[];
  return rows.map(mapStep);
}

export function getWorkflowById(db: Database.Database, id: string): Workflow | null {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined;
  if (!row) return null;
  return mapWorkflow(row, listWorkflowSteps(db, id));
}

export function listWorkflows(db: Database.Database, projectId?: number): Workflow[] {
  const rows = projectId
    ? (db.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as WorkflowRow[])
    : (db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all() as WorkflowRow[]);
  return rows.map((row) => mapWorkflow(row, listWorkflowSteps(db, row.id)));
}
