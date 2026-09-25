import type Database from 'better-sqlite3';
import { AppError, ERR, Paisa } from '@shared/types';
import { parsePositiveMoney } from '../domain/money';
import { nowUtc, isValidIso, isValidLocalDate } from '../domain/datetime';
import { AuditService } from './audit';

export interface ExpenseRow {
  id: number;
  category: string;
  description: string;
  amount: Paisa;
  method: string;
  reference: string;
  spentAt: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Accounting/financial area — revenue, payments, expenses, refunds,
 * adjustments and financial summaries. Physically and logically separate
 * from clinical documents.
 */
export class AccountingService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  addExpense(actor: string, input: { category?: string; description?: string; amount: string | number; method?: string; reference?: string; spentAt?: string }): ExpenseRow {
    const amount = parsePositiveMoney(input.amount, 'expense amount');
    if (input.spentAt && !isValidLocalDate(input.spentAt) && !isValidIso(input.spentAt)) {
      throw new AppError(ERR.VALIDATION, 'Expense date is invalid.');
    }
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO expenses (category, description, amount_paisa, method, reference, spent_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.category ?? '', input.description ?? '', amount, input.method ?? 'Cash', input.reference ?? '', input.spentAt ?? now, actor, now);
      this.audit.record(actor, 'expense.create', 'expenses', Number(res.lastInsertRowid), { amount });
      return Number(res.lastInsertRowid);
    });
    const id = tx.immediate();
    return this.listExpenses({}).rows.find((e) => e.id === id)!;
  }

  listExpenses(q: { from?: string; to?: string; category?: string; page?: number; pageSize?: number }): { rows: ExpenseRow[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.from) { where.push('spent_at >= ?'); args.push(q.from); }
    if (q.to) { where.push('spent_at <= ?'); args.push(q.to); }
    if (q.category) { where.push('category = ?'); args.push(q.category); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM expenses ${w}`).get(...args) as { c: number }).c;
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const rows = this.db
      .prepare(`SELECT * FROM expenses ${w} ORDER BY spent_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return {
      rows: rows.map((r) => ({
        id: r.id as number,
        category: (r.category as string) ?? '',
        description: (r.description as string) ?? '',
        amount: r.amount_paisa as number,
        method: (r.method as string) ?? '',
        reference: (r.reference as string) ?? '',
        spentAt: r.spent_at as string,
        createdBy: (r.created_by as string) ?? '',
        createdAt: r.created_at as string
      })),
      total
    };
  }

  /** Financial summary for a UTC ISO range. */
  summary(fromIso: string, toIso: string): {
    revenueBilled: Paisa;
    paymentsReceived: Paisa;
    refundsAndCredits: Paisa;
    expenses: Paisa;
    netCash: Paisa;
    outstandingDue: Paisa;
    invoicesIssued: number;
    paymentsCount: number;
  } {
    const one = (sql: string, ...args: unknown[]) => (this.db.prepare(sql).get(...args) as { s: number }).s;
    const revenueBilled = one("SELECT COALESCE(SUM(total_paisa),0) s FROM invoices WHERE status='issued' AND issued_at >= ? AND issued_at <= ?", fromIso, toIso);
    const paymentsReceived = one('SELECT COALESCE(SUM(amount_paisa),0) s FROM payments WHERE void = 0 AND paid_at >= ? AND paid_at <= ?', fromIso, toIso);
    const refundsAndCredits = one("SELECT COALESCE(SUM(amount_paisa),0) s FROM adjustments WHERE amount_paisa < 0 AND effective_at >= ? AND effective_at <= ?", fromIso, toIso);
    const expenses = one('SELECT COALESCE(SUM(amount_paisa),0) s FROM expenses WHERE spent_at >= ? AND spent_at <= ?', fromIso, toIso);
    const invoicesIssued = one("SELECT COUNT(*) s FROM invoices WHERE status='issued' AND issued_at >= ? AND issued_at <= ?", fromIso, toIso);
    const paymentsCount = one('SELECT COUNT(*) s FROM payments WHERE void = 0 AND paid_at >= ? AND paid_at <= ?', fromIso, toIso);
    const outstanding = one(
      `SELECT COALESCE((SELECT SUM(total_paisa) FROM invoices WHERE status='issued'),0)
              - COALESCE((SELECT SUM(amount_paisa) FROM payments WHERE void=0),0)
              + COALESCE((SELECT SUM(amount_paisa) FROM adjustments),0) s`
    );
    return {
      revenueBilled,
      paymentsReceived,
      refundsAndCredits,
      expenses,
      netCash: paymentsReceived - expenses,
      outstandingDue: outstanding,
      invoicesIssued,
      paymentsCount
    };
  }
}
