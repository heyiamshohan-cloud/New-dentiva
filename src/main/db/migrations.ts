import type Database from 'better-sqlite3';
import { MIGRATION_001_INITIAL } from './migrations/001_initial';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered schema migrations. Migrations must be append-only: never edit a
 * released migration; add a new one. Each runs in its own transaction so an
 * interrupted migration can never leave a partially applied schema.
 */
const MIGRATIONS: Migration[] = [{ version: 1, name: 'initial', sql: MIGRATION_001_INITIAL }];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this application supports (${SCHEMA_VERSION}). Update Dentiva Pro.`
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      db.exec(m.sql);
      // user_version cannot be parameterised; version is a compile-time constant.
      db.pragma(`user_version = ${m.version}`);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    });
    apply();
  }
}
