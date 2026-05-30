import path from 'node:path';

export function normalizePath(input: string): string {
  return path.normalize(input).replace(/\\/g, '/');
}

export function resolveAbsolute(input: string): string {
  return path.resolve(input);
}

export function isSubPath(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function toRelative(root: string, filePath: string): string {
  return normalizePath(path.relative(root, filePath));
}

export function getProjectRoot(): string {
  return path.resolve(import.meta.dirname, '../..');
}

export function getDataDir(): string {
  return path.join(getProjectRoot(), 'data');
}

export function getConfigPath(): string {
  return path.join(getProjectRoot(), 'config', 'default.json');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'risoca.db');
}

export function getProjectMapPath(): string {
  return path.join(getDataDir(), 'project-map.json');
}

export function getSnapshotsDir(): string {
  return path.join(getDataDir(), 'snapshots');
}

export function getAuditLogPath(): string {
  return path.join(getDataDir(), 'audit.log.jsonl');
}

export function resolveProjectFile(root: string, relativePath: string): string {
  return path.resolve(root, relativePath);
}
