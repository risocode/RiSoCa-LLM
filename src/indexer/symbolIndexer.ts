import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type {
  ApiCallEntry,
  ExportEntry,
  RouteEntry,
  SchemaEntry,
  SymbolEntry,
} from '../types.js';
import { isSensitivePath } from '../security/pathGuard.js';
import { readFileSafe } from '../utils/fileUtils.js';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const ROUTE_PATTERNS: Array<{ regex: RegExp; framework: string; method?: string }> = [
  { regex: /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'Express' },
  { regex: /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'Express' },
  { regex: /fastify\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'Fastify' },
];

const API_CALL_PATTERNS: Array<{ regex: RegExp; kind: ApiCallEntry['kind'] }> = [
  { regex: /\bfetch\s*\(/g, kind: 'fetch' },
  { regex: /\baxios\.(get|post|put|delete|patch|request)\s*\(/g, kind: 'axios' },
  { regex: /\bhttp\.(get|post|put|delete|request)\s*\(/g, kind: 'http' },
];

function getSymbolKind(name: string, filePath: string, nodeKind: ts.SyntaxKind): SymbolEntry['kind'] {
  if (filePath.includes('component') || /^[A-Z]/.test(name)) {
    if (nodeKind === ts.SyntaxKind.FunctionDeclaration || nodeKind === ts.SyntaxKind.VariableStatement) {
      return 'component';
    }
  }
  if (nodeKind === ts.SyntaxKind.ClassDeclaration) return 'class';
  if (nodeKind === ts.SyntaxKind.InterfaceDeclaration) return 'interface';
  if (nodeKind === ts.SyntaxKind.TypeAliasDeclaration) return 'type';
  if (nodeKind === ts.SyntaxKind.FunctionDeclaration) return 'function';
  return 'variable';
}

function parseTypeScriptSymbols(root: string, relativePath: string, content: string): {
  symbols: SymbolEntry[];
  exports: ExportEntry[];
} {
  const symbols: SymbolEntry[] = [];
  const exports: ExportEntry[] = [];
  const ext = path.extname(relativePath);
  const scriptKind = ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const source = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, scriptKind);

  function visit(node: ts.Node): void {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        kind: getSymbolKind(node.name.text, relativePath, node.kind),
        file: relativePath,
        line,
      });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name: node.name.text, file: relativePath, line, isDefault: false });
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'class', file: relativePath, line });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name: node.name.text, file: relativePath, line, isDefault: false });
      }
    }

    if (ts.isInterfaceDeclaration(node)) {
      symbols.push({ name: node.name.text, kind: 'interface', file: relativePath, line });
    }

    if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({ name: node.name.text, kind: 'type', file: relativePath, line });
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          symbols.push({
            name,
            kind: getSymbolKind(name, relativePath, node.kind),
            file: relativePath,
            line,
          });
          if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
            exports.push({ name, file: relativePath, line, isDefault: false });
          }
        }
      }
    }

    if (node.kind === ts.SyntaxKind.ExportAssignment) {
      exports.push({ name: 'default', file: relativePath, line, isDefault: true });
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return { symbols, exports };
}

function parseJsRegexSymbols(relativePath: string, content: string): {
  symbols: SymbolEntry[];
  exports: ExportEntry[];
} {
  const symbols: SymbolEntry[] = [];
  const exports: ExportEntry[] = [];
  const lines = content.split('\n');

  const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  const classRegex = /(?:export\s+)?class\s+(\w+)/g;
  const exportRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;

  lines.forEach((line, idx) => {
    let match: RegExpExecArray | null;
    fnRegex.lastIndex = 0;
    while ((match = fnRegex.exec(line)) !== null) {
      symbols.push({ name: match[1], kind: 'function', file: relativePath, line: idx + 1 });
    }
    classRegex.lastIndex = 0;
    while ((match = classRegex.exec(line)) !== null) {
      symbols.push({ name: match[1], kind: 'class', file: relativePath, line: idx + 1 });
    }
    exportRegex.lastIndex = 0;
    while ((match = exportRegex.exec(line)) !== null) {
      exports.push({ name: match[1], file: relativePath, line: idx + 1, isDefault: false });
    }
  });

  return { symbols, exports };
}

function detectRoutes(relativePath: string, content: string): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const lines = content.split('\n');

  for (const { regex, framework } of ROUTE_PATTERNS) {
    lines.forEach((line, idx) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        routes.push({
          method: (match[1] ?? 'GET').toUpperCase(),
          path: match[2],
          file: relativePath,
          line: idx + 1,
          framework,
        });
      }
    });
  }

  const nextRouteRegex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)/g;
  lines.forEach((line, idx) => {
    nextRouteRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = nextRouteRegex.exec(line)) !== null) {
      routes.push({
        method: match[1],
        path: relativePath.replace(/\/route\.(ts|js)x?$/, '').replace(/^src\/app/, ''),
        file: relativePath,
        line: idx + 1,
        framework: 'Next.js',
      });
    }
  });

  return routes;
}

function detectApiCalls(relativePath: string, content: string): ApiCallEntry[] {
  const apiCalls: ApiCallEntry[] = [];
  const lines = content.split('\n');

  for (const { regex, kind } of API_CALL_PATTERNS) {
    lines.forEach((line, idx) => {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        apiCalls.push({
          kind,
          file: relativePath,
          line: idx + 1,
          snippet: line.trim().slice(0, 120),
        });
      }
    });
  }

  return apiCalls;
}

function detectSchemas(relativePath: string): SchemaEntry[] {
  const schemas: SchemaEntry[] = [];
  const base = path.basename(relativePath).toLowerCase();

  if (base.endsWith('.prisma')) {
    schemas.push({ kind: 'prisma', file: relativePath, name: path.basename(relativePath) });
  } else if (base.endsWith('.sql')) {
    schemas.push({ kind: 'sql', file: relativePath, name: path.basename(relativePath) });
  } else if (relativePath.includes('schema') && (base.endsWith('.ts') || base.endsWith('.js'))) {
    schemas.push({ kind: 'drizzle', file: relativePath, name: path.basename(relativePath) });
  }

  return schemas;
}

export interface SymbolIndexResult {
  symbols: SymbolEntry[];
  exports: ExportEntry[];
  routes: RouteEntry[];
  apiCalls: ApiCallEntry[];
  schemas: SchemaEntry[];
}

export function indexSymbols(rootPath: string, filePaths: string[]): SymbolIndexResult {
  const symbols: SymbolEntry[] = [];
  const exports: ExportEntry[] = [];
  const routes: RouteEntry[] = [];
  const apiCalls: ApiCallEntry[] = [];
  const schemas: SchemaEntry[] = [];

  for (const rel of filePaths) {
    if (isSensitivePath(rel)) continue;

    schemas.push(...detectSchemas(rel));

    const ext = path.extname(rel).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    const content = readFileSafe(rootPath, rel);
    if (!content) continue;

    if (ext === '.ts' || ext === '.tsx') {
      try {
        const parsed = parseTypeScriptSymbols(rootPath, rel, content);
        symbols.push(...parsed.symbols);
        exports.push(...parsed.exports);
      } catch {
        const parsed = parseJsRegexSymbols(rel, content);
        symbols.push(...parsed.symbols);
        exports.push(...parsed.exports);
      }
    } else {
      const parsed = parseJsRegexSymbols(rel, content);
      symbols.push(...parsed.symbols);
      exports.push(...parsed.exports);
    }

    routes.push(...detectRoutes(rel, content));
    apiCalls.push(...detectApiCalls(rel, content));
  }

  return { symbols, exports, routes, apiCalls, schemas };
}

export function readFileContentForIndex(root: string, relativePath: string): string | null {
  const fullPath = path.join(root, relativePath);
  if (isSensitivePath(relativePath) || !fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}
