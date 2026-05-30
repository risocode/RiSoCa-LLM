import fs from 'node:fs';
import type { AuditEvent } from '../types.js';
import { assertAgentDataPath } from './pathGuard.js';
import { getAuditLogPath } from '../utils/paths.js';

export function appendAuditEvent(event: Omit<AuditEvent, 'timestamp'>): void {
  const logPath = getAuditLogPath();
  assertAgentDataPath(logPath);
  const entry: AuditEvent = { timestamp: new Date().toISOString(), ...event };
  const dir = logPath.replace(/[^/\\]+$/, '');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

export function readAuditEvents(limit = 100): AuditEvent[] {
  const logPath = getAuditLogPath();
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line) as AuditEvent);
}

export function clearAuditLogForTests(): void {
  const logPath = getAuditLogPath();
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
}
