import type Database from 'better-sqlite3';

/**
 * Race-safe, human-readable document numbering (Patient Code, invoice,
 * receipt, prescription, appointment, visit numbers). The counters table is
 * incremented inside the same transaction as the record insert, so numbers
 * are unique and never reused — even after a crash mid-transaction.
 * Numbering keys and padding are stable for long-term use.
 */
export class NumberingService {
  constructor(private db: Database.Database) {}

  /** Must be called inside a transaction. Returns e.g. "PT-000001". */
  next(key: string, prefix: string, pad = 6): string {
    this.db
      .prepare('INSERT INTO counters (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING')
      .run(key);
    this.db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);
    const row = this.db.prepare('SELECT value FROM counters WHERE key = ?').get(key) as { value: number };
    return `${prefix}-${String(row.value).padStart(pad, '0')}`;
  }

  peek(key: string): number {
    const row = this.db.prepare('SELECT value FROM counters WHERE key = ?').get(key) as { value: number } | undefined;
    return row?.value ?? 0;
  }
}

export const NUMBER_KEYS = {
  patient: { key: 'patient', prefix: 'PT' },
  invoice: { key: 'invoice', prefix: 'INV' },
  receipt: { key: 'receipt', prefix: 'RCP' },
  prescription: { key: 'prescription', prefix: 'RX' },
  appointment: { key: 'appointment', prefix: 'APT' },
  visit: { key: 'visit', prefix: 'VST' }
} as const;
