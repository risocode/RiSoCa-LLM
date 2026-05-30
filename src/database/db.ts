import Database from 'better-sqlite3';
import { ensureDir } from '../utils/fileUtils.js';
import { getDataDir, getDbPath } from '../utils/paths.js';
import { initializeSchema } from './schema.js';

let dbInstance: Database.Database | null = null;

export function setDatabaseInstance(db: Database.Database | null): void {
  dbInstance = db;
}

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  ensureDir(getDataDir());
  const dbPath = getDbPath();
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  initializeSchema(dbInstance);
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
}
