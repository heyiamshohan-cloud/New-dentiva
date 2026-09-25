import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx, seedBasic } from './helpers';
import { AppError, ERR } from '@shared/types';

/**
 * Financial test matrix across the persistence layer: zero/decimal/large,
 * multiple items, discount/tax, partial/multiple/over/under payments,
 * refunds/adjustments, void/cancellation — reconciled through statements.
 */
describe('billing & payments', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('creates invoices with snapshotted prices and exact totals', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', {
      patientId,
      items: [
        { description: 'Scaling & Polishing', qty: 1, unitPrice: '1500.00' },
        { description: 'Composite Filling', qty: 2, unitPrice: '1200.50', discount: '100.50' },
        { description: 'X-Ray', qty: 1, unitPrice: '0' }
      ],
      discount: '0',
      tax: '250'
    });
    expect(inv.number).toBe('INV-000001');
    expect(inv.subtotal).toBe(150000 + 240100);
    expect(inv.total).toBe(150000 + 240100 - 10050 + 0 + 25000);
    expect(inv.computed.status).toBe('issued');
    expect(inv.computed.totalDue).toBe(inv.total);
  });

  it('payments: partial → multiple → overpayment; statuses reconcile', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'RCT', qty: 1, unitPrice: '5000' }] });

    const p1 = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '2000', method: 'Cash' });
    expect(p1.payment.receiptNo).toBe('RCP-000001');
    expect(p1.remainingDue).toBe(300000);
    expect(ctx.services.billing.getInvoice(inv.id).computed.status).toBe('partially_paid');

    const p2 = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '2999.99', method: 'bKash' });
    expect(p2.remainingDue).toBe(1);
    expect(ctx.services.billing.getInvoice(inv.id).computed.status).toBe('partially_paid');

    const p3 = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '0.10', method: 'Nagad' });
    expect(p3.remainingDue).toBe(-9); // 9 poisha credit (overpaid)
    const finalInv = ctx.services.billing.getInvoice(inv.id);
    expect(finalInv.computed.status).toBe('paid');

    const fin = ctx.services.billing.patientFinancials(patientId);
    expect(fin.totalBilled).toBe(500000);
    expect(fin.totalPaid).toBe(500009);
    expect(fin.totalDue).toBe(-9);
  });

  it('duplicate submissions are idempotent via clientRef', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Extraction', qty: 1, unitPrice: '800' }] });
    const a = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '800', method: 'Cash', clientRef: 'uuid-123' });
    const b = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '800', method: 'Cash', clientRef: 'uuid-123' });
    expect(b.duplicate).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(ctx.services.billing.listPayments({ patientId }).total).toBe(1);
  });

  it('rejects zero/negative payments and unknown methods', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'X', qty: 1, unitPrice: '100' }] });
    expect(() => ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '0', method: 'Cash' })).toThrow(AppError);
    expect(() => ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '-5', method: 'Cash' })).toThrow(AppError);
    expect(() => ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '5', method: 'GoldBars' })).toThrow(/not configured/);
  });

  it('void invoice requires zero active payments; void payment preserves history', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Braces', qty: 1, unitPrice: '10000' }] });
    const pay = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '5000', method: 'Card' });

    try {
      ctx.services.billing.voidInvoice('t', inv.id, 'mistake');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.CONFLICT);
    }

    ctx.services.billing.voidPayment('t', pay.payment.id, 'entered twice by mistake');
    const voided = ctx.services.billing.getPayment(pay.payment.id);
    expect(voided.void).toBe(true);
    expect(voided.voidReason).toContain('mistake');
    // Voided payment no longer counts.
    expect(ctx.services.billing.getInvoice(inv.id).computed.totalPaid).toBe(0);

    ctx.services.billing.voidInvoice('t', inv.id, 'wrong patient billed');
    const v = ctx.services.billing.getInvoice(inv.id);
    expect(v.computed.status).toBe('void');
    expect(v.computed.totalDue).toBe(0);

    // Payments against void invoices are refused.
    expect(() => ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '1', method: 'Cash' })).toThrow(/void/);
  });

  it('statement reconciles invoices, payments and adjustments exactly', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv1 = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'A', qty: 1, unitPrice: '1000' }] });
    ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv1.id, amount: '400', method: 'Cash' });
    ctx.services.billing.recordAdjustment('t', { patientId, amount: '-100', kind: 'write_off', reason: 'goodwill' });

    const st = ctx.services.statements.statement(patientId, '1900-01-01', '9999-12-31');
    expect(st.openingBalance).toBe(0);
    expect(st.rows).toHaveLength(3);
    expect(st.closingBalance).toBe(100000 - 40000 - 10000); // billed - paid - writeoff
    expect(st.totalDebits).toBe(100000);
    expect(st.totalCredits).toBe(50000);

    // Reconcile against patientFinancials.
    const fin = ctx.services.billing.patientFinancials(patientId);
    expect(fin.totalDue).toBe(st.closingBalance);
  });

  it('diagnostics confirm invoice totals remain consistent', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'A', qty: 2, unitPrice: '750.25', discount: '0.25', tax: '1' }], discount: '5', tax: '2.50' });
    const diag = ctx.services.diagnostics.run();
    expect(diag.issues.filter((i) => i.area === 'billing')).toHaveLength(0);
    expect(diag.ok).toBe(true);
  });
});
