import { getDatabase } from '../database/db.js';

export interface SessionRecord {
  id: number;
  projectId: number | null;
  startedAt: string;
  command: string;
  metadata: Record<string, unknown>;
}

export function startSession(
  command: string,
  projectId: number | null,
  metadata: Record<string, unknown> = {},
): SessionRecord {
  const db = getDatabase();
  const startedAt = new Date().toISOString();

  const result = db
    .prepare(
      'INSERT INTO sessions (project_id, started_at, command, metadata_json) VALUES (?, ?, ?, ?)',
    )
    .run(projectId, startedAt, command, JSON.stringify(metadata));

  return {
    id: Number(result.lastInsertRowid),
    projectId,
    startedAt,
    command,
    metadata,
  };
}
