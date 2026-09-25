import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations';

export interface DbHandle {
  db: Database.Database;
  path: string;
}

export const DB_FILE_NAME = 'dentiva.db';

/**
 * Open (and migrate) the Dentiva database at the given directory.
 * The directory is created if missing. WAL + foreign keys + busy timeout
 * are enforced for crash safety and integrity (spec: Database Integrity,
 * Crash Recovery).
 */
export function openDatabase(dir: string): DbHandle {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, DB_FILE_NAME);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return { db, path: dbPath };
}

/** Run fn inside an IMMEDIATE transaction; rolls back on any throw. */
export function transact<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}

/** Verify the database passes SQLite's built-in integrity check. */
export function integrityCheck(db: Database.Database): { ok: boolean; details: string[] } {
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  const details = rows.map((r) => r.integrity_check);
  return { ok: details.length === 1 && details[0] === 'ok', details };
}

export function foreignKeyCheck(db: Database.Database): Array<{ table: string; rowid: number; parent: string; fkid: number }> {
  return db.prepare('PRAGMA foreign_key_check').all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
}
