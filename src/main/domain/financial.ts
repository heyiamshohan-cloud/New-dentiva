import { AppError, ERR, InvoiceStatus, Paisa } from '@shared/types';

/**
 * Financial engine — pure functions over integer paisa. No floats, ever.
 * Tested against the full financial matrix (spec: Financial Engine /
 * Financial Test Matrix).
 */

export interface LineInput {
  qty: number;
  unitPrice: Paisa; // paisa per unit
  discount?: Paisa; // line discount (paisa)
  tax?: Paisa; // line tax (paisa)
}

export interface LineComputed extends LineInput {
  subtotal: Paisa; // qty * unitPrice
  total: Paisa; // subtotal - discount + tax
}

export function computeLine(line: LineInput): LineComputed {
  const discount = line.discount ?? 0;
  const tax = line.tax ?? 0;
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1e6) {
    throw new AppError(ERR.VALIDATION, 'Line quantity must be a positive integer.');
  }
  for (const [v, name] of [[line.unitPrice, 'unit price'], [discount, 'line discount'], [tax, 'line tax']] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new AppError(ERR.VALIDATION, `Line ${name} must be a non-negative amount.`);
  }
  const subtotal = line.unitPrice * line.qty;
  if (discount > subtotal) throw new AppError(ERR.VALIDATION, 'A line discount cannot exceed the line subtotal.');
  const total = subtotal - discount + tax;
  return { ...line, discount, tax, subtotal, total };
}

export interface InvoiceTotals {
  subtotal: Paisa; // Σ qty*unit
  lineDiscounts: Paisa;
  lineTaxes: Paisa;
  discount: Paisa; // invoice-level
  tax: Paisa; // invoice-level
  total: Paisa;
}

export function computeInvoiceTotals(lines: LineInput[], discount: Paisa = 0, tax: Paisa = 0): InvoiceTotals {
  if (!Number.isSafeInteger(discount) || discount < 0) throw new AppError(ERR.VALIDATION, 'Invoice discount must be a non-negative amount.');
  if (!Number.isSafeInteger(tax) || tax < 0) throw new AppError(ERR.VALIDATION, 'Invoice tax must be a non-negative amount.');
  if (lines.length === 0) {
    if (discount > 0 || tax > 0) throw new AppError(ERR.VALIDATION, 'An invoice with no lines cannot carry a discount or tax.');
    return { subtotal: 0, lineDiscounts: 0, lineTaxes: 0, discount: 0, tax: 0, total: 0 };
  }
  const computed = lines.map(computeLine);
  const subtotal = computed.reduce((a, l) => a + l.subtotal, 0);
  const lineDiscounts = computed.reduce((a, l) => a + (l.discount ?? 0), 0);
  const lineTaxes = computed.reduce((a, l) => a + (l.tax ?? 0), 0);
  const baseAfterLines = subtotal - lineDiscounts + lineTaxes;
  if (discount > baseAfterLines) throw new AppError(ERR.VALIDATION, 'The invoice discount cannot exceed the payable amount.');
  const total = baseAfterLines - discount + tax;
  if (total < 0) throw new AppError(ERR.VALIDATION, 'Invoice total cannot be negative.');
  return { subtotal, lineDiscounts, lineTaxes, discount, tax, total };
}

export function deriveInvoiceStatus(base: 'draft' | 'issued' | 'void', total: Paisa, paid: Paisa): InvoiceStatus {
  if (base === 'void') return 'void';
  if (base === 'draft') return 'draft';
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'issued';
}

export type StatementEntryKind = 'invoice' | 'payment' | 'adjustment';

export interface StatementEntry {
  effectiveAt: string; // ISO; ordering key alongside seq
  seq: number; // tie-breaker: creation order
  kind: StatementEntryKind;
  ref: string; // invoice number / receipt number / adjustment id
  description: string;
  debit: Paisa; // increases balance (invoices, debit adjustments)
  credit: Paisa; // decreases balance (payments, credit adjustments)
}

export interface StatementRowOut extends StatementEntry {
  balance: Paisa;
}

export interface StatementOut {
  openingBalance: Paisa;
  rows: StatementRowOut[];
  closingBalance: Paisa;
  totalDebits: Paisa;
  totalCredits: Paisa;
}

/** Signed value of an entry: invoices +total, payments -amount, adjustments by sign. */
export function entrySigned(e: StatementEntry): Paisa {
  return e.debit - e.credit;
}

/**
 * Build a statement over [fromIso, toIso]. Entries before `fromIso` fold into
 * the opening balance. Sorted deterministically by (effectiveAt, seq).
 */
export function buildStatement(entries: StatementEntry[], fromIso: string, toIso: string): StatementOut {
  const before = entries.filter((e) => e.effectiveAt < fromIso);
  const inside = entries.filter((e) => e.effectiveAt >= fromIso && e.effectiveAt <= toIso);
  const openingBalance = before.reduce((a, e) => a + entrySigned(e), 0);
  inside.sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : a.seq - b.seq));
  let balance = openingBalance;
  let totalDebits = 0;
  let totalCredits = 0;
  const rows: StatementRowOut[] = inside.map((e) => {
    balance += entrySigned(e);
    totalDebits += e.debit;
    totalCredits += e.credit;
    return { ...e, balance };
  });
  return { openingBalance, rows, closingBalance: balance, totalDebits, totalCredits };
}
