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
  skippedCount: number;
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
