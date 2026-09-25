import type Database from 'better-sqlite3';
import { AppError, ERR, FinancialSummary, InvoiceComputed, InvoiceStatus, Paisa, Page } from '@shared/types';
import { computeInvoiceTotals, deriveInvoiceStatus, LineInput } from '../domain/financial';
import { parseMoney, parsePositiveMoney } from '../domain/money';
import { nowUtc, isValidIso } from '../domain/datetime';
import { AuditService } from './audit';
import { NumberingService, NUMBER_KEYS } from './counters';

export interface InvoiceItemRow {
  id?: number;
  treatmentId: number | null;
  description: string;
  toothFdi: string;
  qty: number;
  unitPrice: Paisa;
  discount: Paisa;
  tax: Paisa;
  lineTotal: Paisa;
  sortOrder: number;
}

export interface InvoiceRow {
  id: number;
  number: string;
  patientId: number;
  patientCode: string;
  patientName: string;
  dentistId: number | null;
  dentistName: string;
  visitId: number | null;
  treatmentPlanId: number | null;
  issuedAt: string;
  baseStatus: 'draft' | 'issued' | 'void';
  computed: InvoiceComputed;
  subtotal: Paisa;
  discount: Paisa;
  tax: Paisa;
  total: Paisa;
  notes: string;
  createdBy: string;
  createdAt: string;
  items: InvoiceItemRow[];
}

export interface InvoiceInput {
  patientId: number;
  dentistId?: number | null;
  visitId?: number | null;
  treatmentPlanId?: number | null;
  issuedAt?: string;
  discount?: string | number; // money
  tax?: string | number; // money
  notes?: string;
  saveAsDraft?: boolean;
  items: Array<{
    treatmentId?: number | null;
    description: string;
    toothFdi?: string;
    qty?: number;
    unitPrice: string | number;
    discount?: string | number;
    tax?: string | number;
  }>;
}

export interface PaymentRow {
  id: number;
  receiptNo: string;
  patientId: number;
  patientCode: string;
  patientName: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  amount: Paisa;
  method: string;
  reference: string;
  receivedBy: string;
  notes: string;
  paidAt: string;
  void: boolean;
  voidedBy: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
}

const INV_SELECT = `
SELECT i.*, p.code p_code, p.full_name p_name, d.name d_name
FROM invoices i
JOIN patients p ON p.id = i.patient_id
LEFT JOIN dentists d ON d.id = i.dentist_id`;

const PAY_SELECT = `
SELECT y.*, p.code p_code, p.full_name p_name, i.number inv_no
FROM payments y
JOIN patients p ON p.id = y.patient_id
LEFT JOIN invoices i ON i.id = y.invoice_id`;

function moneyOrZero(v: string | number | undefined, field: string): Paisa {
  if (v === undefined || v === '' || v === null) return 0;
  const out = parseMoney(v, field);
  if (out < 0) throw new AppError(ERR.VALIDATION, `${field} cannot be negative.`);
  return out;
}

export class BillingService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private numbering: NumberingService
  ) {}

  // ---------------------------------------------------------------- invoices

  private loadInvoiceItems(invoiceId: number): InvoiceItemRow[] {
    const rows = this.db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC')
      .all(invoiceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      treatmentId: (r.treatment_id as number) ?? null,
      description: r.description as string,
      toothFdi: (r.tooth_fdi as string) ?? '',
      qty: r.qty as number,
      unitPrice: r.unit_price_paisa as number,
      discount: r.discount_paisa as number,
      tax: r.tax_paisa as number,
      lineTotal: r.line_total_paisa as number,
      sortOrder: r.sort_order as number
    }));
  }

  /** Amount paid against a specific invoice (non-void payments). */
  paidForInvoice(invoiceId: number): Paisa {
    return (
      (this.db.prepare('SELECT COALESCE(SUM(amount_paisa),0) s FROM payments WHERE invoice_id = ? AND void = 0').get(invoiceId) as { s: number }).s
    );
  }

  private mapInvoice(r: Record<string, unknown>): InvoiceRow {
    const total = r.total_paisa as number;
    const paid = this.paidForInvoice(r.id as number);
    const baseStatus = r.status as 'draft' | 'issued' | 'void';
    return {
      id: r.id as number,
      number: r.number as string,
      patientId: r.patient_id as number,
      patientCode: (r.p_code as string) ?? '',
      patientName: (r.p_name as string) ?? '',
      dentistId: (r.dentist_id as number) ?? null,
      dentistName: (r.d_name as string) ?? '',
      visitId: (r.visit_id as number) ?? null,
      treatmentPlanId: (r.treatment_plan_id as number) ?? null,
      issuedAt: r.issued_at as string,
      baseStatus,
      computed: {
        status: deriveInvoiceStatus(baseStatus, total, paid),
        totalBilled: baseStatus === 'void' ? 0 : total,
        totalPaid: paid,
        totalDue: baseStatus === 'void' ? 0 : total - paid
      },
      subtotal: r.subtotal_paisa as number,
      discount: r.discount_paisa as number,
      tax: r.tax_paisa as number,
      total,
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string,
      items: this.loadInvoiceItems(r.id as number)
    };
  }

  getInvoice(id: number): InvoiceRow {
    const r = this.db.prepare(`${INV_SELECT} WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Invoice not found.');
    return this.mapInvoice(r);
  }

  /**
   * Create an invoice with all of its line items in one transaction.
   * Prices are snapshotted onto the lines so later catalog changes never
   * rewrite billing history. A treatment plan never auto-invoices — this
   * method is only invoked by an explicit user action.
   */
  createInvoice(actor: string, input: InvoiceInput): InvoiceRow {
    if (!input.items || input.items.length === 0) throw new AppError(ERR.VALIDATION, 'An invoice needs at least one line item.');
    if (input.issuedAt && !isValidIso(input.issuedAt)) throw new AppError(ERR.VALIDATION, 'Invoice date is invalid.');
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    input.items.forEach((it, i) => {
      if (!it.description?.trim()) throw new AppError(ERR.VALIDATION, `Line ${i + 1} needs a description.`);
    });
    const lineInputs: LineInput[] = input.items.map((it) => ({
      qty: it.qty ?? 1,
      unitPrice: moneyOrZero(it.unitPrice, 'unit price'),
      discount: moneyOrZero(it.discount, 'line discount'),
      tax: moneyOrZero(it.tax, 'line tax')
    }));
    const discount = moneyOrZero(input.discount, 'discount');
    const tax = moneyOrZero(input.tax, 'tax');
    const totals = computeInvoiceTotals(lineInputs, discount, tax);
    const tx = this.db.transaction(() => {
      const number = this.numbering.next(NUMBER_KEYS.invoice.key, NUMBER_KEYS.invoice.prefix);
      const now = nowUtc();
      const status = input.saveAsDraft ? 'draft' : 'issued';
      const res = this.db
        .prepare(
          `INSERT INTO invoices (number, patient_id, dentist_id, visit_id, treatment_plan_id, issued_at, status,
             subtotal_paisa, discount_paisa, tax_paisa, total_paisa, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(number, input.patientId, input.dentistId ?? null, input.visitId ?? null, input.treatmentPlanId ?? null, input.issuedAt ?? now, status, totals.subtotal, totals.discount, totals.tax, totals.total, input.notes ?? '', actor, now, now);
      const id = Number(res.lastInsertRowid);
      const stmt = this.db.prepare(
        `INSERT INTO invoice_items (invoice_id, treatment_id, description, tooth_fdi, qty, unit_price_paisa, discount_paisa, tax_paisa, line_total_paisa, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      input.items.forEach((it, i) => {
        const lineTotal = lineInputs[i].unitPrice * lineInputs[i].qty - (lineInputs[i].discount ?? 0) + (lineInputs[i].tax ?? 0);
        stmt.run(
          id,
          it.treatmentId ?? null,
          it.description.trim(),
          it.toothFdi ?? '',
          lineInputs[i].qty,
          lineInputs[i].unitPrice,
          lineInputs[i].discount ?? 0,
          lineInputs[i].tax ?? 0,
          lineTotal,
          i + 1
        );
      });
      this.audit.record(actor, input.saveAsDraft ? 'invoice.create_draft' : 'invoice.create', 'invoices', id, { number, total: totals.total });
      return id;
    });
    return this.getInvoice(tx.immediate());
  }

  /** Void is a reversal state, never a delete — financial history is preserved. */
  voidInvoice(actor: string, id: number, reason: string): InvoiceRow {
    const cur = this.getInvoice(id);
    if (cur.baseStatus === 'void') throw new AppError(ERR.CONFLICT, 'This invoice is already void.');
    if (cur.baseStatus === 'draft') throw new AppError(ERR.CONFLICT, 'Draft invoices cannot be voided; discard them instead.');
    if (cur.computed.totalPaid > 0) {
      throw new AppError(ERR.CONFLICT, 'This invoice has recorded payments. Void those payments first, then void the invoice.');
    }
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?").run(nowUtc(), id);
      this.audit.record(actor, 'invoice.void', 'invoices', id, { number: cur.number, reason });
    });
    tx.immediate();
    return this.getInvoice(id);
  }

  issueDraft(actor: string, id: number): InvoiceRow {
    const cur = this.getInvoice(id);
    if (cur.baseStatus !== 'draft') throw new AppError(ERR.CONFLICT, 'Only a draft invoice can be issued.');
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE invoices SET status = 'issued', issued_at = ?, updated_at = ? WHERE id = ?").run(nowUtc(), nowUtc(), id);
      this.audit.record(actor, 'invoice.issue', 'invoices', id, { number: cur.number });
    });
    tx.immediate();
    return this.getInvoice(id);
  }

  listInvoices(q: { patientId?: number; status?: InvoiceStatus; search?: string; from?: string; to?: string; page?: number; pageSize?: number }): Page<InvoiceRow> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.patientId != null) { where.push('i.patient_id = ?'); args.push(q.patientId); }
    if (q.from) { where.push('i.issued_at >= ?'); args.push(q.from); }
    if (q.to) { where.push('i.issued_at <= ?'); args.push(q.to); }
    if (q.search?.trim()) {
      const like = `%${q.search.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      where.push("(i.number LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE)");
      args.push(like, like, like);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    let rows = this.db.prepare(`${INV_SELECT} ${w} ORDER BY i.issued_at DESC, i.id DESC`).all(...args) as Record<string, unknown>[];
    let mapped = rows.map((r) => this.mapInvoice(r));
    if (q.status) mapped = mapped.filter((m) => m.computed.status === q.status);
    const total = mapped.length;
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    return { rows: mapped.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
  }

  // ---------------------------------------------------------------- payments

  private mapPayment(r: Record<string, unknown>): PaymentRow {
    return {
      id: r.id as number,
      receiptNo: r.receipt_no as string,
      patientId: r.patient_id as number,
      patientCode: (r.p_code as string) ?? '',
      patientName: (r.p_name as string) ?? '',
      invoiceId: (r.invoice_id as number) ?? null,
      invoiceNumber: (r.inv_no as string) ?? null,
      amount: r.amount_paisa as number,
      method: r.method as string,
      reference: (r.reference as string) ?? '',
      receivedBy: (r.received_by as string) ?? '',
      notes: (r.notes as string) ?? '',
      paidAt: r.paid_at as string,
      void: !!r.void,
      voidedBy: (r.voided_by as string) ?? '',
      voidedAt: (r.voided_at as string) ?? null,
      voidReason: (r.void_reason as string) ?? '',
      createdAt: r.created_at as string
    };
  }

  getPayment(id: number): PaymentRow {
    const r = this.db.prepare(`${PAY_SELECT} WHERE y.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Payment not found.');
    return this.mapPayment(r);
  }

  /**
   * Record a payment as a separate, persisted transaction and return the
   * receipt view. `clientRef` provides idempotency: a double-click, retry or
   * renderer timeout with the same ref returns the original payment instead
   * of duplicating it.
   */
  recordPayment(
    actor: string,
    input: { patientId: number; invoiceId?: number | null; amount: string | number; method: string; reference?: string; notes?: string; paidAt?: string; clientRef?: string }
  ): { payment: PaymentRow; remainingDue: Paisa; duplicate: boolean } {
    const amount = parsePositiveMoney(input.amount, 'payment amount');
    if (!input.method?.trim()) throw new AppError(ERR.VALIDATION, 'A payment method is required.');
    if (input.paidAt && !isValidIso(input.paidAt)) throw new AppError(ERR.VALIDATION, 'Payment date is invalid.');
    const method = (this.db.prepare('SELECT name FROM payment_methods WHERE name = ? COLLATE NOCASE AND active = 1').get(input.method.trim()) as { name: string } | undefined)?.name;
    if (!method) throw new AppError(ERR.VALIDATION, `Payment method "${input.method}" is not configured or is inactive.`);

    if (input.clientRef) {
      const existing = this.db.prepare('SELECT id, receipt_no FROM payments WHERE client_ref = ?').get(input.clientRef) as { id: number } | undefined;
      if (existing) {
        const payment = this.getPayment(existing.id);
        return { payment, remainingDue: this.remainingDueAfter(payment.invoiceId, payment.patientId), duplicate: true };
      }
    }

    let invoice: InvoiceRow | null = null;
    if (input.invoiceId != null) {
      invoice = this.getInvoice(input.invoiceId);
      if (invoice.patientId !== input.patientId) throw new AppError(ERR.VALIDATION, 'The invoice belongs to a different patient.');
      if (invoice.baseStatus === 'void') throw new AppError(ERR.CONFLICT, 'Payments cannot be recorded against a void invoice.');
      if (invoice.baseStatus === 'draft') throw new AppError(ERR.CONFLICT, 'Issue the invoice before recording a payment against it.');
    }
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');

    // Overpayment is allowed and surfaces as a credit balance on the statement
    // (spec: overpayment must be testable), so no cap is enforced here — the
    // UI warns but lets the clinic decide.

    const tx = this.db.transaction(() => {
      const receiptNo = this.numbering.next(NUMBER_KEYS.receipt.key, NUMBER_KEYS.receipt.prefix);
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO payments (receipt_no, patient_id, invoice_id, amount_paisa, method, reference, received_by, notes, paid_at, client_ref, void, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(receiptNo, input.patientId, input.invoiceId ?? null, amount, method, input.reference ?? '', actor, input.notes ?? '', input.paidAt ?? now, input.clientRef ?? null, now);
      this.audit.record(actor, 'payment.create', 'payments', Number(res.lastInsertRowid), { receiptNo, amount });
      return Number(res.lastInsertRowid);
    });
    const id = tx.immediate();
    const payment = this.getPayment(id);
    // A receipt exists only after successful persistence of the payment.
    return { payment, remainingDue: this.remainingDueAfter(payment.invoiceId, payment.patientId), duplicate: false };
  }

  private remainingDueAfter(invoiceId: number | null, patientId: number): Paisa {
    if (invoiceId != null) return this.getInvoice(invoiceId).computed.totalDue;
    return this.patientFinancials(patientId).totalDue;
  }

  /** Void (reverse) a payment. The original row is preserved for audit. */
  voidPayment(actor: string, id: number, reason: string): PaymentRow {
    const cur = this.getPayment(id);
    if (cur.void) throw new AppError(ERR.CONFLICT, 'This payment is already void.');
    if (!reason.trim()) throw new AppError(ERR.VALIDATION, 'A void reason is required.');
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE payments SET void = 1, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?').run(actor, nowUtc(), reason, id);
      this.audit.record(actor, 'payment.void', 'payments', id, { receiptNo: cur.receiptNo, reason });
    });
    tx.immediate();
    return this.getPayment(id);
  }

  listPayments(q: { patientId?: number; invoiceId?: number; method?: string; search?: string; from?: string; to?: string; includeVoid?: boolean; page?: number; pageSize?: number }): Page<PaymentRow> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.patientId != null) { where.push('y.patient_id = ?'); args.push(q.patientId); }
    if (q.invoiceId != null) { where.push('y.invoice_id = ?'); args.push(q.invoiceId); }
    if (q.method) { where.push('y.method = ?'); args.push(q.method); }
    if (q.search?.trim()) {
      const kw = `%${q.search.trim()}%`;
      where.push('(y.receipt_no LIKE ? OR y.reference LIKE ? OR p.full_name LIKE ? OR p.code LIKE ?)');
      args.push(kw, kw, kw, kw);
    }
    if (q.from) { where.push('y.paid_at >= ?'); args.push(q.from); }
    if (q.to) { where.push('y.paid_at <= ?'); args.push(q.to); }
    if (!q.includeVoid) where.push('y.void = 0');
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM payments y ${w}`).get(...args) as { c: number }).c;
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const rows = this.db
      .prepare(`${PAY_SELECT} ${w} ORDER BY y.paid_at DESC, y.id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { rows: rows.map((r) => this.mapPayment(r)), total, page, pageSize };
  }

  // -------------------------------------------------------------- adjustments

  recordAdjustment(actor: string, input: { patientId: number; invoiceId?: number | null; amount: string | number; kind: 'refund' | 'write_off' | 'discount_correction' | 'rounding' | 'manual_credit' | 'manual_debit'; reason: string; effectiveAt?: string }): number {
    const amount = (() => {
      const v = parseMoney(input.amount, 'adjustment amount');
      if (v === 0) throw new AppError(ERR.VALIDATION, 'Adjustment amount cannot be zero.');
      return v;
    })();
    const kinds = ['refund', 'write_off', 'discount_correction', 'rounding', 'manual_credit', 'manual_debit'];
    if (!kinds.includes(input.kind)) throw new AppError(ERR.VALIDATION, 'Invalid adjustment kind.');
    if (!input.reason?.trim()) throw new AppError(ERR.VALIDATION, 'An adjustment reason is required.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO adjustments (patient_id, invoice_id, amount_paisa, kind, reason, effective_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.patientId, input.invoiceId ?? null, amount, input.kind, input.reason, input.effectiveAt ?? now, actor, now);
      this.audit.record(actor, `adjustment.${input.kind}`, 'adjustments', Number(res.lastInsertRowid), { amount });
      return Number(res.lastInsertRowid);
    });
    return tx.immediate();
  }

  // ------------------------------------------------------------ patient totals

  /** Lifetime financial summary — always derived live from persisted records. */
  patientFinancials(patientId: number): FinancialSummary {
    const billed = (
      this.db.prepare("SELECT COALESCE(SUM(total_paisa),0) s FROM invoices WHERE patient_id = ? AND status = 'issued'").get(patientId) as { s: number }
    ).s;
    const paid = (
      this.db.prepare('SELECT COALESCE(SUM(amount_paisa),0) s FROM payments WHERE patient_id = ? AND void = 0').get(patientId) as { s: number }
    ).s;
    const adj = (
      this.db.prepare('SELECT COALESCE(SUM(amount_paisa),0) s FROM adjustments WHERE patient_id = ?').get(patientId) as { s: number }
    ).s;
    return { totalBilled: billed, totalPaid: paid, totalDue: billed - paid + adj };
  }
}
