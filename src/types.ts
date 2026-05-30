export interface FileEntry {
  path: string;
  language: string;
  size: number;
  role: string;
  hash: string;
  lineCount: number;
}

export interface SymbolEntry {
  name: string;
  kind: 'function' | 'class' | 'component' | 'interface' | 'type' | 'variable';
  file: string;
  line: number;
}

export interface ImportEdge {
  from: string;
  to: string;
  spec: string;
  resolved: boolean;
}

export interface ExportEntry {
  name: string;
  file: string;
  line: number;
  isDefault: boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  file: string;
  line: number;
  framework: string;
}

export interface ApiCallEntry {
  kind: 'fetch' | 'axios' | 'http';
  file: string;
  line: number;
  snippet: string;
}

export interface SchemaEntry {
  kind: 'prisma' | 'sql' | 'drizzle' | 'other';
  file: string;
  name: string;
}

export interface DependencyEntry {
  name: string;
  version: string;
  kind: 'npm' | 'python' | 'other';
  dev: boolean;
}

export interface ProjectMapStats {
  fileCount: number;
  symbolCount: number;
  routeCount: number;
  depth: number;
}

export interface ProjectMap {
  rootPath: string;
  scannedAt: string;
  files: FileEntry[];
  symbols: SymbolEntry[];
  imports: ImportEdge[];
  exports: ExportEntry[];
  routes: RouteEntry[];
  apiCalls: ApiCallEntry[];
  schemas: SchemaEntry[];
  dependencies: DependencyEntry[];
  graph: { nodes: string[]; edges: ImportEdge[] };
  stats: ProjectMapStats;
}

export interface StackInfo {
  languages: string[];
  packageManager: string | null;
  runtimes: string[];
  hasDocker: boolean;
  hasCi: boolean;
  ciPaths: string[];
  entryPoints: string[];
}

export interface FrameworkInfo {
  frameworks: string[];
  primary: string | null;
}

export interface ScanResult {
  rootPath: string;
  name: string;
  scannedAt: string;
  fingerprint: string;
  fileCount: number;
  skippedCount: number;
  stack: StackInfo;
  frameworks: FrameworkInfo;
  healthScore: number;
  complexityScore: number;
  risks: string[];
  improvements: string[];
  summary: string;
}

export interface HealthReport {
  projectName: string;
  rootPath: string;
  indexedFiles: number;
  skippedFiles: number;
  languages: string[];
  framework: string | null;
  healthScore: number;
  complexityScore: number;
  risks: string[];
  outputs: { db: string; projectMap: string };
}

export interface ProjectContext {
  projectName: string;
  rootPath: string;
  scannedAt: string;
  summary: string;
  stack: StackInfo;
  frameworks: FrameworkInfo;
  healthScore: number;
  complexityScore: number;
  importantFiles: string[];
  entryPoints: string[];
  routeFiles: string[];
  configFiles: string[];
  schemaFiles: string[];
  highRiskFiles: string[];
  stats: ProjectMapStats;
}

export interface GraphNodeMetric {
  file: string;
  fanIn: number;
  fanOut: number;
}

export interface StructuralAnalysis {
  circularImports: string[][];
  orphanFiles: string[];
  unresolvedImports: ImportEdge[];
  largeFiles: FileEntry[];
  highFanIn: GraphNodeMetric[];
  highFanOut: GraphNodeMetric[];
  deadModules: string[];
  routeSummary: RouteEntry[];
  apiSurface: ApiCallEntry[];
  graphDepth: number;
  duplicateRoles: Array<{ role: string; count: number; files: string[] }>;
  recommendedActions: string[];
  structuralRisks: string[];
}

export type FileOperationType = 'write_file' | 'edit_file' | 'delete_file';

export type FileOperationStatus = 'pending' | 'executed' | 'rejected';

export type EditStrategy = 'exact' | 'append_section' | 'replace_section' | 'replace_file';

export interface FileOperationPayload {
  content?: string;
  search?: string;
  replace?: string;
  editStrategy?: EditStrategy;
  sectionHeading?: string;
  fallbackNote?: string;
  userRequestedText?: string;
}

export interface FileOperationPreview {
  summary: string;
  exists: boolean;
  beforeSnippet?: string;
  afterSnippet?: string;
  diffLines?: string[];
}

export interface FileOperation {
  id: string;
  projectId: number;
  operationType: FileOperationType;
  targetPath: string;
  payload: FileOperationPayload;
  status: FileOperationStatus;
  preview: FileOperationPreview;
  snapshotId: string | null;
  createdAt: string;
  approvedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
}

export interface FileSnapshot {
  id: string;
  projectId: number;
  originalPath: string;
  snapshotPath: string;
  operationId: string | null;
  hash: string;
  createdAt: string;
}

export interface AuditEvent {
  timestamp: string;
  event: string;
  operationId?: string;
  snapshotId?: string;
  targetPath?: string;
  operationType?: FileOperationType | CommandCategory;
  status?: string;
  message?: string;
  command?: string;
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  workflowId?: string;
}

export type CommandCategory = 'terminal' | 'git_read' | 'git_write';

export type CommandOperationStatus = 'pending' | 'executed' | 'rejected';

export interface CommandOperationPreview {
  summary: string;
  command: string;
  category: CommandCategory;
  requiresApproval: boolean;
  modifiesFiles: boolean;
}

export interface CommandOperationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CommandOperation {
  id: string;
  projectId: number;
  command: string;
  category: CommandCategory;
  status: CommandOperationStatus;
  preview: CommandOperationPreview;
  result: CommandOperationResult | null;
  snapshotId: string | null;
  requiresApproval: boolean;
  createdAt: string;
  approvedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
}

export interface CommandSnapshot {
  id: string;
  projectId: number;
  operationId: string;
  beforeDiff: string;
  afterDiff: string | null;
  createdAt: string;
}
