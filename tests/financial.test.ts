import { describe, it, expect } from 'vitest';
import { computeLine, computeInvoiceTotals, deriveInvoiceStatus, buildStatement, StatementEntry } from '@main/domain/financial';
import { AppError } from '@shared/types';

describe('financial engine — line math', () => {
  it('computes line totals with discount and tax', () => {
    const l = computeLine({ qty: 2, unitPrice: 150000, discount: 5000, tax: 2500 });
    expect(l.subtotal).toBe(300000);
    expect(l.total).toBe(297500);
  });

  it('zero amounts work', () => {
    const l = computeLine({ qty: 1, unitPrice: 0 });
    expect(l.total).toBe(0);
  });

  it('discount cannot exceed the line subtotal', () => {
    expect(() => computeLine({ qty: 1, unitPrice: 1000, discount: 1001 })).toThrow(AppError);
  });

  it('rejects bad quantities and negatives', () => {
    expect(() => computeLine({ qty: 0, unitPrice: 100 })).toThrow(AppError);
    expect(() => computeLine({ qty: 1.5, unitPrice: 100 })).toThrow(AppError);
    expect(() => computeLine({ qty: 1, unitPrice: -100 })).toThrow(AppError);
  });
});

describe('financial engine — invoice totals (matrix)', () => {
  it('single line, no discount/tax', () => {
    const t = computeInvoiceTotals([{ qty: 1, unitPrice: 50000 }]);
    expect(t.total).toBe(50000);
  });

  it('multiple lines sum exactly', () => {
    const t = computeInvoiceTotals([{ qty: 2, unitPrice: 33333 }, { qty: 3, unitPrice: 11111 }]);
    expect(t.subtotal).toBe(99999);
    expect(t.total).toBe(99999);
  });

  it('invoice-level discount and tax', () => {
    const t = computeInvoiceTotals([{ qty: 1, unitPrice: 100000 }], 10000, 5000);
    expect(t.total).toBe(95000);
  });

  it('line + invoice discounts combined', () => {
    const t = computeInvoiceTotals([{ qty: 2, unitPrice: 30000, discount: 5000, tax: 1000 }], 2000, 0);
    // lines: 60000 - 5000 + 1000 = 56000; invoice: 56000 - 2000 = 54000
    expect(t.total).toBe(54000);
  });

  it('large values stay exact', () => {
    const t = computeInvoiceTotals([{ qty: 1000, unitPrice: 9999999 }]);
    expect(t.total).toBe(9999999000);
  });

  it('discount cannot exceed payable amount', () => {
    expect(() => computeInvoiceTotals([{ qty: 1, unitPrice: 1000 }], 1001)).toThrow(AppError);
  });

  it('empty invoice with discount/tax is invalid', () => {
    expect(() => computeInvoiceTotals([], 0, 100)).toThrow(AppError);
    expect(computeInvoiceTotals([]).total).toBe(0);
  });
});

describe('financial engine — status derivation', () => {
  it('derives statuses across payment states', () => {
    expect(deriveInvoiceStatus('issued', 1000, 0)).toBe('issued');
    expect(deriveInvoiceStatus('issued', 1000, 500)).toBe('partially_paid');
    expect(deriveInvoiceStatus('issued', 1000, 1000)).toBe('paid');
    expect(deriveInvoiceStatus('issued', 1000, 2000)).toBe('paid'); // overpaid
    expect(deriveInvoiceStatus('void', 1000, 0)).toBe('void');
    expect(deriveInvoiceStatus('draft', 1000, 0)).toBe('draft');
  });
});

describe('financial engine — statements', () => {
  const entries: StatementEntry[] = [
    { effectiveAt: '2026-01-05T10:00:00Z', seq: 1, kind: 'invoice', ref: 'INV-1', description: 'Invoice', debit: 100000, credit: 0 },
    { effectiveAt: '2026-01-10T10:00:00Z', seq: 2, kind: 'payment', ref: 'RCP-1', description: 'Payment', debit: 0, credit: 60000 },
    { effectiveAt: '2026-02-01T10:00:00Z', seq: 3, kind: 'invoice', ref: 'INV-2', description: 'Invoice', debit: 50000, credit: 0 },
    { effectiveAt: '2026-02-15T10:00:00Z', seq: 4, kind: 'adjustment', ref: 'ADJ-1', description: 'write off', debit: 0, credit: 10000 }
  ];

  it('opening balance folds entries before the period', () => {
    const st = buildStatement(entries, '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z');
    expect(st.openingBalance).toBe(0);
    expect(st.rows).toHaveLength(2);
    expect(st.closingBalance).toBe(40000);
  });

  it('opening balance accumulates prior periods; running balance is exact', () => {
    const st = buildStatement(entries, '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z');
    expect(st.openingBalance).toBe(40000);
    expect(st.rows[1].balance).toBe(80000);
    expect(st.closingBalance).toBe(80000);
    expect(st.totalDebits).toBe(50000);
    expect(st.totalCredits).toBe(10000);
  });

  it('deterministic ordering by (at, seq)', () => {
    const dup: StatementEntry = { effectiveAt: '2026-01-05T10:00:00Z', seq: 0, kind: 'payment', ref: 'RCP-0', description: 'earlier same-instant payment', debit: 0, credit: 25000 };
    const st = buildStatement([...entries, dup], '2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z');
    expect(st.rows[0].ref).toBe('RCP-0');
    expect(st.rows[1].ref).toBe('INV-1');
    expect(st.closingBalance).toBe(55000);
  });
});
