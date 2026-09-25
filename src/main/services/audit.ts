import type Database from 'better-sqlite3';
import { nowUtc } from '../domain/datetime';

/**
 * Append-only audit log for significant events (spec: Audit Log).
 * The log records timestamp, actor, action, entity, entity id and metadata.
 */
export class AuditService {
  constructor(private db: Database.Database) {
    this.stmt = db.prepare(
      'INSERT INTO audit_log (at, actor, action, entity, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)'
    );
  }
  private stmt: Database.Statement;

  record(actor: string, action: string, entity: string, entityId: string | number = '', metadata: Record<string, unknown> = {}): void {
    // Metadata must never contain credentials or secrets.
    const safe = JSON.stringify(metadata, (k, v) => (/password|secret|token|hash/i.test(k) ? '[redacted]' : v));
    this.stmt.run(nowUtc(), actor, action, entity, String(entityId), safe);
  }

  list(opts: { limit?: number; offset?: number; entity?: string; actor?: string; from?: string; to?: string }): { rows: unknown[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.entity) { where.push('entity = ?'); args.push(opts.entity); }
    if (opts.actor) { where.push('actor = ?'); args.push(opts.actor); }
    if (opts.from) { where.push('at >= ?'); args.push(opts.from); }
    if (opts.to) { where.push('at <= ?'); args.push(opts.to); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM audit_log ${w}`).get(...args) as { c: number }).c;
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    return { rows: rows as unknown[], total };
  }
}
