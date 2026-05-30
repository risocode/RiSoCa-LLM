import type Database from 'better-sqlite3';
import type { HealthReport, ProjectMap, ScanResult } from '../types.js';
import { getDatabase } from '../database/db.js';
import { writeJson } from '../utils/fileUtils.js';
import { getDbPath, getProjectMapPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

export function saveScanResult(scan: ScanResult, projectMap: ProjectMap): number {
  const db = getDatabase();
  const now = scan.scannedAt;

  const upsertProject = db.prepare(`
    INSERT INTO projects (root_path, name, fingerprint, last_scanned_at)
    VALUES (@root_path, @name, @fingerprint, @last_scanned_at)
    ON CONFLICT(root_path) DO UPDATE SET
      name = excluded.name,
      fingerprint = excluded.fingerprint,
      last_scanned_at = excluded.last_scanned_at
  `);

  upsertProject.run({
    root_path: scan.rootPath,
    name: scan.name,
    fingerprint: scan.fingerprint,
    last_scanned_at: now,
  });

  const projectRow = db
    .prepare('SELECT id FROM projects WHERE root_path = ?')
    .get(scan.rootPath) as { id: number };
  const projectId = projectRow.id;

  clearProjectIndex(db, projectId);

  db.prepare(`
    INSERT INTO project_scans (project_id, summary_json, stack_json, health_score, complexity_score, risks_json, scanned_at)
    VALUES (@project_id, @summary_json, @stack_json, @health_score, @complexity_score, @risks_json, @scanned_at)
  `).run({
    project_id: projectId,
    summary_json: JSON.stringify({ summary: scan.summary, improvements: scan.improvements, frameworks: scan.frameworks }),
    stack_json: JSON.stringify(scan.stack),
    health_score: scan.healthScore,
    complexity_score: scan.complexityScore,
    risks_json: JSON.stringify(scan.risks),
    scanned_at: now,
  });

  const insertFile = db.prepare(`
    INSERT INTO indexed_files (project_id, path, language, size_bytes, role, hash)
    VALUES (@project_id, @path, @language, @size_bytes, @role, @hash)
  `);

  const insertSymbol = db.prepare(`
    INSERT INTO symbols (project_id, file_path, name, kind, line)
    VALUES (@project_id, @file_path, @name, @kind, @line)
  `);

  const insertEdge = db.prepare(`
    INSERT INTO import_edges (project_id, from_path, to_path, spec, resolved)
    VALUES (@project_id, @from_path, @to_path, @spec, @resolved)
  `);

  const insertMemory = db.prepare(`
    INSERT INTO project_memory (project_id, key, value_json, updated_at)
    VALUES (@project_id, @key, @value_json, @updated_at)
  `);

  const fileTx = db.transaction(() => {
    for (const file of projectMap.files) {
      insertFile.run({
        project_id: projectId,
        path: file.path,
        language: file.language,
        size_bytes: file.size,
        role: file.role,
        hash: file.hash,
      });
    }

    for (const symbol of projectMap.symbols) {
      insertSymbol.run({
        project_id: projectId,
        file_path: symbol.file,
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
      });
    }

    for (const edge of projectMap.imports) {
      insertEdge.run({
        project_id: projectId,
        from_path: edge.from,
        to_path: edge.to,
        spec: edge.spec,
        resolved: edge.resolved ? 1 : 0,
      });
    }

    insertMemory.run({
      project_id: projectId,
      key: 'project_map',
      value_json: JSON.stringify(projectMap),
      updated_at: now,
    });
  });

  fileTx();

  const mapPath = getProjectMapPath();
  writeJson(mapPath, projectMap);
  logger.info(`Saved project map to ${mapPath}`);

  return projectId;
}

function clearProjectIndex(db: Database.Database, projectId: number): void {
  db.prepare('DELETE FROM indexed_files WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM symbols WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM import_edges WHERE project_id = ?').run(projectId);
  db.prepare("DELETE FROM project_memory WHERE project_id = ? AND key = 'project_map'").run(projectId);
}

export function loadProjectMap(rootPath: string): ProjectMap | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM projects WHERE root_path = ?')
    .get(rootPath) as { id: number } | undefined;
  if (!row) return null;

  const memory = db
    .prepare("SELECT value_json FROM project_memory WHERE project_id = ? AND key = 'project_map' ORDER BY id DESC LIMIT 1")
    .get(row.id) as { value_json: string } | undefined;

  if (!memory) return null;
  return JSON.parse(memory.value_json) as ProjectMap;
}

export function loadLatestScan(rootPath: string): ScanResult | null {
  const db = getDatabase();
  const project = db
    .prepare('SELECT id, root_path, name, fingerprint, last_scanned_at FROM projects WHERE root_path = ?')
    .get(rootPath) as {
    id: number;
    root_path: string;
    name: string;
    fingerprint: string;
    last_scanned_at: string;
  } | undefined;

  if (!project) return null;

  const scanRow = db
    .prepare('SELECT * FROM project_scans WHERE project_id = ? ORDER BY id DESC LIMIT 1')
    .get(project.id) as {
    summary_json: string;
    stack_json: string;
    health_score: number;
    complexity_score: number;
    risks_json: string;
    scanned_at: string;
  } | undefined;

  if (!scanRow) return null;

  const summaryData = JSON.parse(scanRow.summary_json) as {
    summary: string;
    improvements: string[];
    frameworks: ScanResult['frameworks'];
  };

  const fileCount = (
    db.prepare('SELECT COUNT(*) as count FROM indexed_files WHERE project_id = ?').get(project.id) as {
      count: number;
    }
  ).count;

  return {
    rootPath: project.root_path,
    name: project.name,
    scannedAt: scanRow.scanned_at,
    fingerprint: project.fingerprint,
    fileCount,
    skippedCount: 0,
    stack: JSON.parse(scanRow.stack_json),
    frameworks: summaryData.frameworks,
    healthScore: scanRow.health_score,
    complexityScore: scanRow.complexity_score,
    risks: JSON.parse(scanRow.risks_json),
    improvements: summaryData.improvements,
    summary: summaryData.summary,
  };
}

export function buildHealthReport(scan: ScanResult): HealthReport {
  return {
    projectName: scan.name,
    rootPath: scan.rootPath,
    indexedFiles: scan.fileCount,
    skippedFiles: scan.skippedCount,
    languages: scan.stack.languages,
    framework: scan.frameworks.primary,
    healthScore: scan.healthScore,
    complexityScore: scan.complexityScore,
    risks: scan.risks,
    outputs: {
      db: getDbPath(),
      projectMap: getProjectMapPath(),
    },
  };
}

export function printHealthReport(report: HealthReport): void {
  console.log('');
  console.log('RiSoCa Scan Report');
  console.log('──────────────────');
  console.log(`Project:     ${report.projectName}`);
  console.log(`Path:        ${report.rootPath}`);
  console.log(`Files:       ${report.indexedFiles} indexed (${report.skippedFiles} skipped)`);
  console.log(`Languages:   ${report.languages.join(', ') || 'unknown'}`);
  console.log(`Framework:   ${report.framework ?? 'none detected'}`);
  console.log(`Health:      ${report.healthScore}/100`);
  console.log(`Complexity:  ${report.complexityScore}/100`);
  console.log('');
  console.log('Top risks:');
  if (report.risks.length === 0) {
    console.log('  - None detected');
  } else {
    for (const risk of report.risks.slice(0, 5)) {
      console.log(`  - ${risk}`);
    }
  }
  console.log('');
  console.log('Outputs:');
  console.log(`  ${report.outputs.db}`);
  console.log(`  ${report.outputs.projectMap}`);
  console.log('');
}
