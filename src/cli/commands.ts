import { Command } from 'commander';
import { validateScanPath } from '../security/pathGuard.js';
import { scanProject } from '../scanner/projectScanner.js';
import { buildProjectContext } from '../context/contextBuilder.js';
import { analyzeStructure, formatCycle } from '../analyzer/structuralAnalyzer.js';
import {
  buildHealthReport,
  loadLatestScan,
  loadProjectMap,
  printHealthReport,
  saveScanResult,
} from '../memory/projectMemory.js';
import { startSession } from '../memory/sessionMemory.js';
import { logger } from '../utils/logger.js';
import { writeFileTool } from '../tools/writeFileTool.js';
import { editFileTool } from '../tools/editFileTool.js';
import { deleteFileTool } from '../tools/deleteFileTool.js';
import { listSnapshotsTool, restoreSnapshotTool } from '../tools/restoreSnapshotTool.js';
import {
  formatOperationPreview,
  getPendingOperations,
} from '../security/approval.js';
import {
  formatOperationPreviewDetail,
  previewOperationById,
} from '../security/operationPreview.js';
import {
  approveAnyOperation,
  getPendingCommandOperations,
  rejectAnyOperation,
} from '../security/commandApproval.js';
import { runCommandTool } from '../tools/runCommandTool.js';
import { gitDiffTool, gitStatusTool } from '../tools/gitReadTool.js';
import {
  formatPendingOperationsList,
  formatPendingOperationNotice,
} from '../utils/operationUx.js';
import { doctorExitCode, formatDoctorReport, runDoctorChecks, buildDoctorVerboseInfo } from '../doctor/doctorService.js';
import { getProjectRoot } from '../utils/paths.js';
import {
  cancelWorkflow,
  formatWorkflowSummary,
  getWorkflowDetails,
  listProjectWorkflows,
  runFixWorkflow,
  runRefactorWorkflow,
} from '../workflows/workflowEngine.js';
import { formatAgentMetrics, runAgentQuery } from '../agent/queryEngine.js';

function printList(label: string, items: string[], empty = 'none'): void {
  console.log(`${label}:`);
  if (items.length === 0) {
    console.log(`  - ${empty}`);
    return;
  }
  for (const item of items.slice(0, 8)) console.log(`  - ${item}`);
  if (items.length > 8) console.log(`  - ... +${items.length - 8} more`);
}

async function runScan(projectPath: string): Promise<void> {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }

  logger.info(`Scanning ${validation.absolutePath}...`);
  const { scan, projectMap } = await scanProject(validation.absolutePath);
  const projectId = saveScanResult(scan, projectMap);
  startSession('scan', projectId, { rootPath: scan.rootPath });

  printHealthReport(buildHealthReport(scan));
}

async function runAnalyze(projectPath: string): Promise<void> {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }

  let scan = loadLatestScan(validation.absolutePath);
  let projectMap = loadProjectMap(validation.absolutePath);

  if (!scan || !projectMap) {
    logger.info('No cached scan found — running full scan first...');
    const result = await scanProject(validation.absolutePath);
    scan = result.scan;
    projectMap = result.projectMap;
    const projectId = saveScanResult(scan, projectMap);
    startSession('analyze', projectId, { rootPath: scan.rootPath, rescan: true });
  } else {
    startSession('analyze', null, { rootPath: scan.rootPath, rescan: false });
  }

  const structure = analyzeStructure(projectMap);
  const context = buildProjectContext(scan, projectMap, structure.circularImports.flat());
  const allRisks = [...new Set([...scan.risks, ...structure.structuralRisks])];
  const actions = [...new Set([...scan.improvements, ...structure.recommendedActions])];

  console.log('');
  console.log('RiSoCa Analyze Report');
  console.log('─────────────────────');
  console.log(`Project:     ${context.projectName}`);
  console.log(`Path:        ${context.rootPath}`);
  console.log(`Scanned:     ${context.scannedAt}`);
  console.log(`Summary:     ${context.summary}`);
  console.log(`Health:      ${context.healthScore}/100 | Complexity: ${context.complexityScore}/100`);
  console.log('');
  console.log('Stack / Framework:');
  console.log(`  Languages: ${context.stack.languages.join(', ') || 'unknown'}`);
  console.log(`  Package:   ${context.stack.packageManager ?? 'none'}`);
  console.log(`  Framework: ${context.frameworks.primary ?? 'none'}`);
  console.log(`  Runtimes:  ${context.stack.runtimes.join(', ') || 'none'}`);
  console.log('');
  console.log('Key files:');
  printList('Important', context.importantFiles);
  printList('Entry points', context.entryPoints);
  printList('Config', context.configFiles);
  printList('Schemas', context.schemaFiles);
  console.log('');
  console.log('Surface:');
  printList(
    'Routes',
    structure.routeSummary.map((r) => `${r.method} ${r.path} (${r.file}:${r.line})`),
  );
  printList(
    'API calls',
    structure.apiSurface.map((a) => `${a.kind} ${a.file}:${a.line}`),
  );
  console.log('');
  console.log('Graph stats:');
  console.log(`  Files: ${context.stats.fileCount} | Symbols: ${context.stats.symbolCount}`);
  console.log(`  Imports: ${projectMap.imports.length} | Resolved: ${projectMap.imports.filter((e) => e.resolved).length}`);
  console.log(`  Depth: ${structure.graphDepth}`);
  if (structure.highFanIn.length > 0) {
    console.log(`  Top fan-in: ${structure.highFanIn.map((m) => `${m.file}(${m.fanIn})`).join(', ')}`);
  }
  if (structure.highFanOut.length > 0) {
    console.log(`  Top fan-out: ${structure.highFanOut.map((m) => `${m.file}(${m.fanOut})`).join(', ')}`);
  }
  console.log('');
  console.log('Structural issues:');
  printList(
    'Circular imports',
    structure.circularImports.map(formatCycle),
  );
  printList('Orphan files', structure.orphanFiles);
  printList(
    'Unresolved imports',
    structure.unresolvedImports.map((e) => `${e.from} -> ${e.spec}`),
  );
  if (structure.largeFiles.length > 0) {
    printList('Large files', structure.largeFiles.map((f) => `${f.path} (${f.lineCount} lines)`));
  }
  if (structure.deadModules.length > 0) {
    printList('Dead modules', structure.deadModules);
  }
  console.log('');
  printList('Top risks', allRisks);
  printList('Recommended next actions', actions);
  console.log('');
}

function runWrite(projectPath: string, targetPath: string, content: string): void {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = writeFileTool(validation.absolutePath, targetPath, content);
  if (!result.success) {
    logger.error(result.error ?? 'Write failed');
    process.exitCode = 1;
    return;
  }
  console.log(
    formatPendingOperationNotice({
      operationId: result.operationId!,
      operationType: 'write_file',
      target: targetPath,
      preview: result.preview ?? '',
    }),
  );
}

function runEdit(projectPath: string, targetPath: string, search: string, replace: string): void {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = editFileTool(validation.absolutePath, targetPath, search, replace);
  if (!result.success) {
    logger.error(result.error ?? 'Edit failed');
    process.exitCode = 1;
    return;
  }
  console.log(
    formatPendingOperationNotice({
      operationId: result.operationId!,
      operationType: 'edit_file',
      target: targetPath,
      preview: result.preview ?? '',
    }),
  );
}

function runDelete(projectPath: string, targetPath: string): void {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = deleteFileTool(validation.absolutePath, targetPath);
  if (!result.success) {
    logger.error(result.error ?? 'Delete failed');
    process.exitCode = 1;
    return;
  }
  console.log(
    formatPendingOperationNotice({
      operationId: result.operationId!,
      operationType: 'delete_file',
      target: targetPath,
      preview: result.preview ?? '',
    }),
  );
}

async function runApprove(operationId: string): Promise<void> {
  const result = await approveAnyOperation(operationId);
  if (!result.success) {
    logger.error(result.error ?? 'Approve failed');
    process.exitCode = 1;
    return;
  }
  console.log(result.kind === 'command' ? 'Command executed.' : 'Operation executed.');
  if (result.kind === 'file' && 'operation' in result && result.operation) {
    console.log(formatOperationPreview(result.operation));
  }
  if (result.output) {
    console.log('────────────────────────────────────────');
    console.log(result.output);
  }
}

function runReject(operationId: string): void {
  const result = rejectAnyOperation(operationId);
  if (!result.success) {
    logger.error(result.error ?? 'Reject failed');
    process.exitCode = 1;
    return;
  }
  console.log(result.kind === 'command' ? 'Command rejected.' : 'Operation rejected.');
}

function runSnapshots(projectPath: string): void {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const snapshots = listSnapshotsTool(validation.absolutePath);
  if (snapshots.length === 0) {
    console.log('No snapshots found.');
    return;
  }
  for (const snap of snapshots) {
    console.log(`${snap.id}  ${snap.originalPath}  ${snap.createdAt}`);
  }
}

function runRestore(snapshotId: string): void {
  const result = restoreSnapshotTool(snapshotId);
  if (!result.success) {
    logger.error(result.error ?? 'Restore failed');
    process.exitCode = 1;
    return;
  }
  console.log(`Restored snapshot ${snapshotId}`);
}

function runPending(): void {
  console.log(formatPendingOperationsList(getPendingOperations(), getPendingCommandOperations()));
}

function runPreviewOperation(operationId: string): void {
  const result = previewOperationById(operationId);
  if (!result.success) {
    logger.error(result.error ?? 'Preview failed');
    process.exitCode = 1;
    return;
  }
  console.log(formatOperationPreviewDetail(result.preview));
}

function runCmd(projectPath: string, command: string): void {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = runCommandTool(validation.absolutePath, command);
  if (!result.success) {
    logger.error(result.error ?? 'Command planning failed');
    process.exitCode = 1;
    return;
  }
  console.log(
    formatPendingOperationNotice({
      operationId: result.operationId!,
      operationType: 'terminal',
      target: command,
      preview: result.preview ?? '',
    }),
  );
}

async function runGitStatus(projectPath: string): Promise<void> {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = await gitStatusTool(validation.absolutePath);
  if (!result.success) {
    logger.error(result.error ?? 'Git status failed');
    process.exitCode = 1;
    return;
  }
  console.log(result.output ?? '');
}

async function runGitDiff(projectPath: string): Promise<void> {
  const validation = validateScanPath(projectPath);
  if (!validation.valid) {
    logger.error(validation.error ?? 'Invalid path');
    process.exitCode = 1;
    return;
  }
  const result = await gitDiffTool(validation.absolutePath);
  if (!result.success) {
    logger.error(result.error ?? 'Git diff failed');
    process.exitCode = 1;
    return;
  }
  console.log(result.output ?? '');
}

async function runDoctor(projectPath?: string, verbose = false): Promise<void> {
  const checks = await runDoctorChecks({ projectPath: projectPath ?? getProjectRoot() });
  const verboseInfo = verbose ? await buildDoctorVerboseInfo() : undefined;
  console.log(formatDoctorReport(checks, verboseInfo));
  process.exitCode = doctorExitCode(checks);
}

async function runLocalStatus(projectPath: string): Promise<void> {
  console.log('=== Git Status ===');
  await runGitStatus(projectPath);
  console.log('\n=== Pending Operations ===');
  runPending();
}

async function runProjectQuery(projectPath: string, question: string): Promise<void> {
  logger.info('Running evidence-based query with tool loop...');
  const result = await runAgentQuery({ projectPath, question });
  if (!result.success || !result.answer) {
    console.error(result.error ?? 'Query failed');
    process.exitCode = 1;
    return;
  }

  console.log('');
  if (result.metrics) {
    console.log(formatAgentMetrics(result.metrics));
    console.log('────────────────────────────────────────');
  }
  console.log(result.answer);
  console.log('');
}

async function runAgent(projectPath: string, question: string): Promise<void> {
  await runProjectQuery(projectPath, question);
}

async function runAsk(projectPath: string, question: string): Promise<void> {
  await runProjectQuery(projectPath, question);
}

async function runFix(projectPath: string, issue: string): Promise<void> {
  logger.info('Starting fix workflow...');
  const result = await runFixWorkflow(projectPath, issue);
  if (!result.workflow) {
    logger.error(result.error ?? 'Fix workflow failed');
    process.exitCode = 1;
    return;
  }
  console.log(formatWorkflowSummary(result.workflow));
  if (!result.success) process.exitCode = 1;
}

async function runRefactor(projectPath: string, goal: string): Promise<void> {
  logger.info('Starting refactor workflow...');
  const result = await runRefactorWorkflow(projectPath, goal);
  if (!result.workflow) {
    logger.error(result.error ?? 'Refactor workflow failed');
    process.exitCode = 1;
    return;
  }
  console.log(formatWorkflowSummary(result.workflow));
  if (!result.success) process.exitCode = 1;
}

function runWorkflows(projectPath?: string): void {
  const workflows = listProjectWorkflows(projectPath);
  if (workflows.length === 0) {
    console.log('No workflows found.');
    return;
  }
  for (const wf of workflows) {
    console.log(`${wf.id}  ${wf.type}  ${wf.status}  ${wf.userRequest.slice(0, 60)}`);
  }
}

function runWorkflowDetail(workflowId: string): void {
  const workflow = getWorkflowDetails(workflowId);
  if (!workflow) {
    logger.error('Workflow not found');
    process.exitCode = 1;
    return;
  }
  console.log(formatWorkflowSummary(workflow));
}

function runCancelWorkflow(workflowId: string): void {
  const result = cancelWorkflow(workflowId);
  if (!result.success || !result.workflow) {
    logger.error(result.error ?? 'Cancel failed');
    process.exitCode = 1;
    return;
  }
  console.log(`Workflow cancelled: ${workflowId}`);
  console.log(formatWorkflowSummary(result.workflow));
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('risoca')
    .description('RiSoCa AI Agent — scan, index, store, report')
    .version('0.1.0');

  program
    .command('scan')
    .description('Scan and index a project')
    .argument('<path>', 'Path to project directory')
    .action(async (projectPath: string) => {
      await runScan(projectPath);
    });

  program
    .command('analyze')
    .description('Analyze a project (uses cached scan or re-scans)')
    .argument('<path>', 'Path to project directory')
    .action(async (projectPath: string) => {
      await runAnalyze(projectPath);
    });

  program
    .command('write')
    .description('Create pending write operation')
    .argument('<path>', 'Project directory')
    .argument('<target>', 'Relative file path')
    .argument('<content>', 'File content')
    .action((projectPath: string, target: string, content: string) => {
      runWrite(projectPath, target, content);
    });

  program
    .command('edit')
    .description('Create pending edit operation')
    .argument('<path>', 'Project directory')
    .argument('<target>', 'Relative file path')
    .argument('<search>', 'Search string')
    .argument('<replace>', 'Replace string')
    .action((projectPath: string, target: string, search: string, replace: string) => {
      runEdit(projectPath, target, search, replace);
    });

  program
    .command('delete')
    .description('Create pending delete operation')
    .argument('<path>', 'Project directory')
    .argument('<target>', 'Relative file path')
    .action((projectPath: string, target: string) => {
      runDelete(projectPath, target);
    });

  program
    .command('approve')
    .description('Approve and execute pending operation')
    .argument('<operationId>', 'Operation ID')
    .action(async (operationId: string) => {
      await runApprove(operationId);
    });

  program
    .command('reject')
    .description('Reject pending operation')
    .argument('<operationId>', 'Operation ID')
    .action((operationId: string) => {
      runReject(operationId);
    });

  program
    .command('snapshots')
    .description('List snapshots for a project')
    .argument('<path>', 'Project directory')
    .action((projectPath: string) => {
      runSnapshots(projectPath);
    });

  program
    .command('restore')
    .description('Restore file from snapshot')
    .argument('<snapshotId>', 'Snapshot ID')
    .action((snapshotId: string) => {
      runRestore(snapshotId);
    });

  program
    .command('pending')
    .description('List pending file and command operations')
    .action(() => {
      runPending();
    });

  program
    .command('preview-operation')
    .description('Show before/after preview and unified diff for a pending file operation')
    .argument('<operationId>', 'Operation ID')
    .action((operationId: string) => {
      runPreviewOperation(operationId);
    });

  program
    .command('doctor')
    .description('Check local runtime health (Node, SQLite, Ollama, git)')
    .argument('[path]', 'Project directory to inspect', '.')
    .option('--verbose', 'Show detailed diagnostics')
    .action(async (projectPath: string, options: { verbose?: boolean }) => {
      await runDoctor(projectPath, options.verbose === true);
    });

  program
    .command('local-status')
    .description('Show git status and pending operations')
    .argument('[path]', 'Project directory', '.')
    .action(async (projectPath: string) => {
      await runLocalStatus(projectPath);
    });

  program
    .command('cmd')
    .description('Create pending terminal command (requires approval)')
    .argument('<path>', 'Project directory')
    .argument('<command...>', 'Command to plan')
    .action((projectPath: string, commandParts: string[]) => {
      runCmd(projectPath, commandParts.join(' '));
    });

  program
    .command('git-status')
    .description('Run read-only git status')
    .argument('<path>', 'Project directory')
    .action(async (projectPath: string) => {
      await runGitStatus(projectPath);
    });

  program
    .command('git-diff')
    .description('Run read-only git diff')
    .argument('<path>', 'Project directory')
    .action(async (projectPath: string) => {
      await runGitDiff(projectPath);
    });

  program
    .command('agent')
    .description('Evidence-based agent query with tool loop (read-only auto-run)')
    .argument('<path>', 'Project directory')
    .argument('<question...>', 'Question for the agent')
    .action(async (projectPath: string, questionParts: string[]) => {
      await runAgent(projectPath, questionParts.join(' '));
    });

  program
    .command('ask')
    .description('Ask a question about a project (evidence-based tool loop)')
    .argument('<path>', 'Project directory')
    .argument('<question...>', 'Question to ask')
    .action(async (projectPath: string, questionParts: string[]) => {
      await runAsk(projectPath, questionParts.join(' '));
    });

  program
    .command('fix')
    .description('Plan a fix workflow with approval-gated operations')
    .argument('<path>', 'Project directory')
    .argument('<issue...>', 'Issue description')
    .action(async (projectPath: string, issueParts: string[]) => {
      await runFix(projectPath, issueParts.join(' '));
    });

  program
    .command('refactor')
    .description('Plan a refactor workflow with approval-gated operations')
    .argument('<path>', 'Project directory')
    .argument('<goal...>', 'Refactor goal')
    .action(async (projectPath: string, goalParts: string[]) => {
      await runRefactor(projectPath, goalParts.join(' '));
    });

  program
    .command('workflows')
    .description('List workflows')
    .argument('[path]', 'Optional project directory filter')
    .action((projectPath?: string) => {
      runWorkflows(projectPath);
    });

  program
    .command('workflow')
    .description('Show workflow details')
    .argument('<workflowId>', 'Workflow ID')
    .action((workflowId: string) => {
      runWorkflowDetail(workflowId);
    });

  program
    .command('cancel-workflow')
    .description('Cancel a workflow')
    .argument('<workflowId>', 'Workflow ID')
    .action((workflowId: string) => {
      runCancelWorkflow(workflowId);
    });

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
