import { Command } from 'commander';
import { validateScanPath } from '../security/pathGuard.js';
import { scanProject } from '../scanner/projectScanner.js';
import {
  buildHealthReport,
  loadLatestScan,
  loadProjectMap,
  printHealthReport,
  saveScanResult,
} from '../memory/projectMemory.js';
import { startSession } from '../memory/sessionMemory.js';
import { searchFilesTool } from '../tools/searchFilesTool.js';
import { renderAnalyzePrompt } from '../prompts/analyzePrompt.js';
import { logger } from '../utils/logger.js';

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

  const report = buildHealthReport(scan);
  printHealthReport(report);
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

  console.log('');
  console.log('RiSoCa Analyze Report');
  console.log('─────────────────────');
  console.log(`Project:     ${scan.name}`);
  console.log(`Path:        ${scan.rootPath}`);
  console.log(`Scanned:     ${scan.scannedAt}`);
  console.log(`Health:      ${scan.healthScore}/100`);
  console.log(`Complexity:  ${scan.complexityScore}/100`);
  console.log('');
  console.log('Stack:');
  console.log(`  Languages:       ${scan.stack.languages.join(', ') || 'unknown'}`);
  console.log(`  Package manager: ${scan.stack.packageManager ?? 'none'}`);
  console.log(`  Runtimes:        ${scan.stack.runtimes.join(', ') || 'none'}`);
  console.log(`  Docker:          ${scan.stack.hasDocker ? 'yes' : 'no'}`);
  console.log(`  CI/CD:           ${scan.stack.hasCi ? scan.stack.ciPaths.join(', ') : 'none'}`);
  console.log(`  Entry points:    ${scan.stack.entryPoints.join(', ') || 'none detected'}`);
  console.log('');
  console.log('Frameworks:');
  console.log(`  Detected: ${scan.frameworks.frameworks.join(', ') || 'none'}`);
  console.log(`  Primary:  ${scan.frameworks.primary ?? 'none'}`);
  console.log('');
  console.log('Index stats:');
  console.log(`  Files:    ${projectMap.stats.fileCount}`);
  console.log(`  Symbols:  ${projectMap.stats.symbolCount}`);
  console.log(`  Routes:   ${projectMap.stats.routeCount}`);
  console.log(`  Imports:  ${projectMap.imports.length} edges`);
  console.log(`  Depth:    ${projectMap.stats.depth}`);
  console.log('');
  console.log('Risks:');
  for (const risk of scan.risks) console.log(`  - ${risk}`);
  console.log('');
  console.log('Improvements:');
  for (const item of scan.improvements) console.log(`  - ${item}`);
  console.log('');

  const topFiles = projectMap.files
    .filter((f) => f.role !== 'other')
    .slice(0, 10)
    .map((f) => `${f.path} (${f.role})`)
    .join('\n');

  const resolvedImports = projectMap.imports.filter((e) => e.resolved).length;
  const promptPreview = renderAnalyzePrompt({
    fileCount: String(projectMap.stats.fileCount),
    symbolCount: String(projectMap.stats.symbolCount),
    routeCount: String(projectMap.stats.routeCount),
    depth: String(projectMap.stats.depth),
    topFiles: topFiles || 'none',
    importSummary: `${resolvedImports}/${projectMap.imports.length} resolved import edges`,
  });

  console.log('Prompt preview (Phase 4 LLM):');
  console.log(promptPreview.slice(0, 400) + (promptPreview.length > 400 ? '...' : ''));
  console.log('');

  if (process.env.RISOCA_SEARCH) {
    const search = searchFilesTool(scan.rootPath, projectMap.files, process.env.RISOCA_SEARCH, 5);
    console.log(`Search "${search.query}" (${search.total} matches):`);
    for (const match of search.matches) {
      console.log(`  ${match.file}:${match.line}  ${match.content.slice(0, 80)}`);
    }
  }
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

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
