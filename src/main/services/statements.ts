import type Database from 'better-sqlite3';
import { LocalDate } from '@shared/types';
import { buildStatement, StatementEntry, StatementOut } from '../domain/financial';
import { isValidLocalDate } from '../domain/datetime';
import { AppError, ERR } from '@shared/types';

/**
 * Patient statement: opening balance, invoices (debit), payments (credit),
 * refunds/adjustments, running balance, closing balance — reconciled against
 * the persisted financial records at read time.
 */
export class StatementService {
  constructor(private db: Database.Database) {}

  private entriesForPatient(patientId: number): StatementEntry[] {
    const entries: StatementEntry[] = [];
    const invoices = this.db
      .prepare("SELECT id, number, issued_at, total_paisa, notes FROM invoices WHERE patient_id = ? AND status = 'issued'")
      .all(patientId) as Array<{ id: number; number: string; issued_at: string; total_paisa: number; notes: string }>;
    for (const inv of invoices) {
      entries.push({
        effectiveAt: inv.issued_at,
        seq: inv.id * 10 + 1,
        kind: 'invoice',
        ref: inv.number,
        description: inv.notes ? `Invoice — ${inv.notes}` : 'Invoice',
        debit: inv.total_paisa,
        credit: 0
      });
    }
    const payments = this.db
      .prepare('SELECT id, receipt_no, paid_at, amount_paisa, method, void, voided_at, void_reason FROM payments WHERE patient_id = ?')
      .all(patientId) as Array<{ id: number; receipt_no: string; paid_at: string; amount_paisa: number; method: string; void: number; voided_at: string | null; void_reason: string }>;
    for (const pay of payments) {
      entries.push({
        effectiveAt: pay.paid_at,
        seq: pay.id * 10 + 2,
        kind: 'payment',
        ref: pay.receipt_no,
        description: pay.void ? `Payment (${pay.method}) — VOIDED: ${pay.void_reason}` : `Payment received (${pay.method})`,
        // Voided payments show as zero-effect strike lines to preserve audit history.
        debit: 0,
        credit: pay.void ? 0 : pay.amount_paisa
      });
    }
    const adjustments = this.db
      .prepare('SELECT id, effective_at, amount_paisa, kind, reason FROM adjustments WHERE patient_id = ?')
      .all(patientId) as Array<{ id: number; effective_at: string; amount_paisa: number; kind: string; reason: string }>;
    for (const adj of adjustments) {
      const positive = adj.amount_paisa > 0;
      entries.push({
        effectiveAt: adj.effective_at,
        seq: adj.id * 10 + 3,
        kind: 'adjustment',
        ref: `ADJ-${adj.id}`,
        description: `${adj.kind.replace(/_/g, ' ')} — ${adj.reason}`,
        debit: positive ? adj.amount_paisa : 0,
        credit: positive ? 0 : -adj.amount_paisa
      });
    }
    return entries;
  }

  statement(patientId: number, from: LocalDate, to: LocalDate): StatementOut {
    if (!isValidLocalDate(from) || !isValidLocalDate(to)) throw new AppError(ERR.VALIDATION, 'Statement dates must be YYYY-MM-DD.');
    if (from > to) throw new AppError(ERR.VALIDATION, 'Statement start date must not be after the end date.');
    const entries = this.entriesForPatient(patientId);
    return buildStatement(entries, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
  }

  lifetime(patientId: number): StatementOut {
    return this.statement(patientId, '1900-01-01', '9999-12-31');
  }
}
