import crypto from 'node:crypto';
import { buildProjectContext } from '../context/contextBuilder.js';
import { buildQuestionAwareContext } from '../context/promptContext.js';
import { analyzeStructure } from '../analyzer/structuralAnalyzer.js';
import { ensureProjectId } from '../database/fileOperations.js';
import {
  getWorkflowById,
  insertWorkflow,
  insertWorkflowStep,
  listWorkflows,
  updateWorkflow,
} from '../database/workflowOperations.js';
import { getDatabase } from '../database/db.js';
import { loadLatestScan, loadProjectMap, saveScanResult } from '../memory/projectMemory.js';
import { scanProject } from '../scanner/projectScanner.js';
import { appendAuditEvent } from '../security/auditLog.js';
import { validateScanPath, loadConfig } from '../security/pathGuard.js';
import { editFileTool } from '../tools/editFileTool.js';
import { runCommandTool } from '../tools/runCommandTool.js';
import { formatApproveCommand } from '../utils/operationUx.js';
import { defaultPlanGenerator } from './workflowPlanner.js';
import {
  getAllowedValidationCommands,
  normalizeWorkflowPlanValidation,
  validateWorkflowValidationCommand,
} from './validationCommands.js';
import { normalizeWorkflowPlanEdits } from './planEditMerger.js';
import { normalizeWorkflowPlanEditStrategies } from './editStrategy.js';
import type {
  PlanGenerator,
  Workflow,
  WorkflowLimits,
  WorkflowPlan,
  WorkflowStartResult,
  WorkflowStepKind,
  WorkflowType,
} from './workflowTypes.js';
import { DEFAULT_WORKFLOW_LIMITS } from './workflowTypes.js';

export interface StartWorkflowOptions {
  projectPath: string;
  type: WorkflowType;
  userRequest: string;
  planGenerator?: PlanGenerator;
  fetchImpl?: typeof fetch;
  limits?: WorkflowLimits;
}

function getLimits(): WorkflowLimits {
  return DEFAULT_WORKFLOW_LIMITS;
}

function buildAnalysisSummary(structure: ReturnType<typeof analyzeStructure>, scan: { risks: string[] }): string {
  return [
    `Circular imports: ${structure.circularImports.length}`,
    `Orphan files: ${structure.orphanFiles.length}`,
    `Unresolved imports: ${structure.unresolvedImports.length}`,
    `Top risks: ${scan.risks.slice(0, 3).join('; ') || 'none'}`,
  ].join('\n');
}

export function validateWorkflowPlan(
  plan: WorkflowPlan,
  projectRoot: string,
  limits: WorkflowLimits = getLimits(),
): string | null {
  const totalSteps = plan.edits.length + plan.validationCommands.length;
  if (totalSteps === 0) return 'Plan has no proposed steps';
  if (totalSteps > limits.maxSteps) return `Plan exceeds max steps (${limits.maxSteps})`;

  const fileCounts = new Map<string, number>();
  for (const edit of plan.edits) {
    if (!edit.file || !edit.search) return 'Edit missing file or search text';
    const count = (fileCounts.get(edit.file) ?? 0) + 1;
    fileCounts.set(edit.file, count);
    if (count > limits.maxEditsPerFile) {
      return `Plan repeats edits for ${edit.file} (max ${limits.maxEditsPerFile} per cycle)`;
    }
  }

  for (const cmd of plan.validationCommands) {
    const error = validateWorkflowValidationCommand(cmd, projectRoot);
    if (error) return error;
  }

  return null;
}

async function loadOrScan(projectPath: string) {
  let scan = loadLatestScan(projectPath);
  let map = loadProjectMap(projectPath);
  if (!scan || !map) {
    const result = await scanProject(projectPath);
    scan = result.scan;
    map = result.projectMap;
    saveScanResult(scan, map);
  }
  return { scan, map };
}

function stepKindForCommand(command: string, projectRoot: string): WorkflowStepKind {
  return getAllowedValidationCommands(projectRoot).has(command) ? 'validation' : 'command';
}

export async function startWorkflow(options: StartWorkflowOptions): Promise<WorkflowStartResult> {
  const limits = options.limits ?? getLimits();
  const validation = validateScanPath(options.projectPath);
  if (!validation.valid) return { success: false, error: validation.error ?? 'Invalid project path' };

  const db = getDatabase();
  const projectId = ensureProjectId(db, validation.absolutePath);
  const workflowId = crypto.randomUUID();
  const now = new Date().toISOString();

  const workflow = insertWorkflow(db, {
    id: workflowId,
    projectId,
    type: options.type,
    status: 'created',
    userRequest: options.userRequest,
    planningCycles: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
    error: null,
  });

  appendAuditEvent({
    event: 'workflow_created',
    message: `${options.type} workflow created`,
    operationId: workflowId,
  });

  try {
    const { scan, map } = await loadOrScan(validation.absolutePath);
    const structure = analyzeStructure(map);
    const context = buildProjectContext(scan, map, structure.circularImports.flat());
    const aiConfig = loadConfig().ai;
    const packed = buildQuestionAwareContext(
      `${options.type}: ${options.userRequest}`,
      scan,
      map,
      context,
      structure,
      aiConfig,
    );

    const planGenerator = options.planGenerator ?? defaultPlanGenerator;
    const rawPlan = await planGenerator({
      type: options.type,
      userRequest: options.userRequest,
      projectContext: packed.context,
      analysisSummary: buildAnalysisSummary(structure, scan),
    });
    let plan = normalizeWorkflowPlanValidation(rawPlan, options.projectPath);
    const strategyResult = normalizeWorkflowPlanEditStrategies(plan, validation.absolutePath);
    if (strategyResult.strategyError) {
      updateWorkflow(db, workflowId, {
        status: 'failed',
        error: strategyResult.strategyError,
        updatedAt: new Date().toISOString(),
      });
      appendAuditEvent({
        event: 'workflow_failed',
        operationId: workflowId,
        message: strategyResult.strategyError,
      });
      return {
        success: false,
        error: strategyResult.strategyError,
        workflow: getWorkflowById(db, workflowId)!,
      };
    }
    plan = strategyResult.plan;

    const mergeResult = normalizeWorkflowPlanEdits(plan, validation.absolutePath);
    if (mergeResult.mergeError) {
      updateWorkflow(db, workflowId, {
        status: 'failed',
        error: mergeResult.mergeError,
        updatedAt: new Date().toISOString(),
      });
      appendAuditEvent({ event: 'workflow_failed', operationId: workflowId, message: mergeResult.mergeError });
      return { success: false, error: mergeResult.mergeError, workflow: getWorkflowById(db, workflowId)! };
    }
    plan = mergeResult.plan;

    const planError = validateWorkflowPlan(plan, options.projectPath, limits);
    if (planError) {
      updateWorkflow(db, workflowId, {
        status: 'failed',
        error: planError,
        updatedAt: new Date().toISOString(),
      });
      appendAuditEvent({ event: 'workflow_failed', operationId: workflowId, message: planError });
      return { success: false, error: planError, workflow: getWorkflowById(db, workflowId)! };
    }

    updateWorkflow(db, workflowId, {
      status: 'planned',
      plan,
      planningCycles: 1,
      updatedAt: new Date().toISOString(),
    });

    appendAuditEvent({
      event: 'workflow_planned',
      operationId: workflowId,
      message: plan.diagnosis,
    });

    const linkedOperationIds: string[] = [];
    let stepIndex = 0;

    for (const edit of plan.edits) {
      const result = editFileTool(validation.absolutePath, edit.file, edit.search, edit.replace, {
        editStrategy: edit.strategy ?? 'exact',
        sectionHeading: edit.sectionHeading,
        fallbackNote: edit.warning,
      });
      if (!result.success || !result.operationId) {
        updateWorkflow(db, workflowId, {
          status: 'failed',
          error: result.error ?? `Failed to propose edit for ${edit.file}`,
          updatedAt: new Date().toISOString(),
        });
        return { success: false, error: result.error, workflow: getWorkflowById(db, workflowId)! };
      }

      linkedOperationIds.push(result.operationId);
      insertWorkflowStep(db, {
        id: crypto.randomUUID(),
        workflowId,
        stepIndex: stepIndex++,
        kind: 'edit_file',
        status: 'pending_approval',
        target: edit.file,
        payload: {
          search: edit.search,
          replace: edit.replace,
          summary: edit.summary,
          strategy: edit.strategy ?? 'exact',
          warning: edit.warning,
        },
        linkedOperationId: result.operationId,
        result: edit.warning ? { warning: edit.warning } : null,
        createdAt: new Date().toISOString(),
      });

      appendAuditEvent({
        event: 'workflow_step_linked',
        operationId: workflowId,
        targetPath: edit.file,
        message: edit.warning ?? `Linked edit operation ${result.operationId}`,
      });
    }

    const validationCommands: string[] = [];
    for (const command of plan.validationCommands) {
      const cmdResult = runCommandTool(validation.absolutePath, command);
      if (!cmdResult.success || !cmdResult.operationId) {
        updateWorkflow(db, workflowId, {
          status: 'failed',
          error: cmdResult.error ?? `Failed to propose command: ${command}`,
          updatedAt: new Date().toISOString(),
        });
        return { success: false, error: cmdResult.error, workflow: getWorkflowById(db, workflowId)! };
      }

      linkedOperationIds.push(cmdResult.operationId);
      validationCommands.push(command);
      insertWorkflowStep(db, {
        id: crypto.randomUUID(),
        workflowId,
        stepIndex: stepIndex++,
        kind: stepKindForCommand(command, options.projectPath),
        status: 'pending_approval',
        target: command,
        payload: { command },
        linkedOperationId: cmdResult.operationId,
        result: null,
        createdAt: new Date().toISOString(),
      });

      appendAuditEvent({
        event: 'workflow_step_linked',
        operationId: workflowId,
        command,
        message: `Linked command operation ${cmdResult.operationId}`,
      });
    }

    updateWorkflow(db, workflowId, {
      status: 'awaiting_approval',
      linkedOperationIds,
      validation: {
        commands: validationCommands,
        status: validationCommands.length > 0 ? 'pending_approval' : 'skipped',
        message: 'Validation commands require approval before execution',
      },
      updatedAt: new Date().toISOString(),
    });

    appendAuditEvent({
      event: 'workflow_awaiting_approval',
      operationId: workflowId,
      message: `${linkedOperationIds.length} pending operation(s)`,
    });

    return { success: true, workflow: getWorkflowById(db, workflowId)! };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workflow planning failed';
    updateWorkflow(db, workflowId, {
      status: 'failed',
      error: message,
      updatedAt: new Date().toISOString(),
    });
    appendAuditEvent({ event: 'workflow_failed', operationId: workflowId, message });
    return { success: false, error: message, workflow: getWorkflowById(db, workflowId)! };
  }
}

export function cancelWorkflow(workflowId: string): WorkflowStartResult {
  const db = getDatabase();
  const workflow = getWorkflowById(db, workflowId);
  if (!workflow) return { success: false, error: 'Workflow not found' };
  if (workflow.status === 'completed' || workflow.status === 'cancelled') {
    return { success: false, error: `Workflow is ${workflow.status}` };
  }

  updateWorkflow(db, workflowId, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  appendAuditEvent({
    event: 'workflow_cancelled',
    operationId: workflowId,
    message: 'Workflow cancelled by user',
  });

  return { success: true, workflow: getWorkflowById(db, workflowId)! };
}

export function getWorkflowDetails(workflowId: string): Workflow | null {
  return getWorkflowById(getDatabase(), workflowId);
}

export function listProjectWorkflows(projectPath?: string): Workflow[] {
  const db = getDatabase();
  if (!projectPath) return listWorkflows(db);
  const validation = validateScanPath(projectPath);
  if (!validation.valid) return [];
  const projectId = ensureProjectId(db, validation.absolutePath);
  return listWorkflows(db, projectId);
}

export function formatWorkflowSummary(workflow: Workflow): string {
  const lines = [
    `Workflow: ${workflow.id}`,
    `Type:     ${workflow.type}`,
    `Status:   ${workflow.status}`,
    `Request:  ${workflow.userRequest}`,
    `Created:  ${workflow.createdAt}`,
  ];

  if (workflow.plan) {
    lines.push('', 'Diagnosis:', workflow.plan.diagnosis);
    if (workflow.plan.notes) lines.push('Notes:', workflow.plan.notes);
  }

  if (workflow.error) lines.push('', `Error: ${workflow.error}`);

  if (workflow.steps.length > 0) {
    lines.push('', 'Steps:');
    for (const step of workflow.steps) {
      lines.push(
        `  ${step.stepIndex + 1}. [${step.kind}] ${step.target} (${step.status})${
          step.linkedOperationId ? ` -> ${step.linkedOperationId}` : ''
        }`,
      );
      if (step.linkedOperationId) {
        lines.push(`     Approve: ${formatApproveCommand(step.linkedOperationId)}`);
      }
    }
  }

  if (workflow.status === 'awaiting_approval') {
    lines.push('', 'Next: approve each pending operation, then run validation commands.');
    lines.push('Use: npm run pending');
  }

  return lines.join('\n');
}

export async function runFixWorkflow(projectPath: string, issue: string, options?: Omit<StartWorkflowOptions, 'projectPath' | 'type' | 'userRequest'>) {
  return startWorkflow({ projectPath, type: 'fix', userRequest: issue, ...options });
}

export async function runRefactorWorkflow(
  projectPath: string,
  goal: string,
  options?: Omit<StartWorkflowOptions, 'projectPath' | 'type' | 'userRequest'>,
) {
  return startWorkflow({ projectPath, type: 'refactor', userRequest: goal, ...options });
}
