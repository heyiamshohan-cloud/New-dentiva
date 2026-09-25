import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { makeCtx } from './helpers';
import { runMigrations, SCHEMA_VERSION } from '@main/db/migrations';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import { openDatabase } from '@main/db/database';

describe('schema & migrations', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('migrates a fresh database to the current version', () => {
    const { ctx, cleanup } = makeCtx();
    cleanups.push(cleanup);
    const version = ctx.db.pragma('user_version', { simple: true }) as number;
    expect(version).toBe(SCHEMA_VERSION);
    const tables = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    for (const t of ['patients', 'invoices', 'payments', 'prescriptions', 'audit_log', 'counters', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('running migrations twice is a no-op', () => {
    const { ctx, cleanup } = makeCtx();
    cleanups.push(cleanup);
    runMigrations(ctx.db);
    expect(ctx.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('persists data across close/reopen (WAL checkpoints)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-persist-'));
    const h1 = openDatabase(dir);
    h1.db.prepare("INSERT INTO users (username, display_name, role, password_hash, created_at, updated_at) VALUES ('a','A','administrator','x','2026-01-01','2026-01-01')").run();
    h1.db.close();
    const h2 = openDatabase(dir);
    const n = (h2.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
    expect(n).toBe(1);
    h2.db.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  });

  it('enforces foreign keys', () => {
    const { ctx, cleanup } = makeCtx();
    cleanups.push(cleanup);
    expect(() => ctx.db.prepare("INSERT INTO visits (number, patient_id, visit_at, created_at, updated_at) VALUES ('V', 9999, '2026-01-01', '2026-01-01', '2026-01-01')").run()).toThrow();
  });

  it('enforces unique patient codes', () => {
    const { ctx, cleanup } = makeCtx();
    cleanups.push(cleanup);
    ctx.services.patients.create('t', { fullName: 'A B' });
    expect(() =>
      ctx.db.prepare("INSERT INTO patients (code, full_name, created_at, updated_at) VALUES ('PT-000001','X','2026','2026')").run()
    ).toThrow(/UNIQUE/);
  });
});
