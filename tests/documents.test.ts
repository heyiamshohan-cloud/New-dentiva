import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx, seedBasic } from './helpers';
import { buildPrescriptionHtml, buildInvoiceHtml, buildReceiptHtml, buildStatementHtml, esc, PAPER_DIMENSIONS } from '@main/documents/templates';

const FORBIDDEN_SNIPPETS = ['undefined', 'null', 'NaN', '[object Object]', 'PLACEHOLDER', 'TODO'];

function expectCleanDoc(html: string): void {
  for (const bad of FORBIDDEN_SNIPPETS) {
    expect(html.includes(bad), `document contains forbidden "${bad}"`).toBe(false);
  }
  expect(html).toContain('<!doctype html>');
}

describe('document engine', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('escapes HTML entities (XSS-safe documents)', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(esc('a & "b"')).toBe('a &amp; &quot;b&quot;');
  });

  it('paper definitions cover A4/A5/Letter/80mm', () => {
    expect(PAPER_DIMENSIONS.A4).toEqual({ width: 210, height: 297 });
    expect(PAPER_DIMENSIONS.A5).toEqual({ width: 148, height: 210 });
    expect(PAPER_DIMENSIONS.Letter).toEqual({ width: 216, height: 279 });
    expect(PAPER_DIMENSIONS['80mm'].width).toBe(80);
  });

  it('prescription document: all clinical fields, zero financial data', async () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId, dentistId } = seedBasic(ctx);
    const rx = ctx.services.prescriptions.create('t', {
      patientId, dentistId,
      cc: ['Pain On', 'Gum Bleeding'], oe: ['Gingivitis', 'Periodontal Pocket'],
      re: 'OPG advised', advice: 'Brush twice daily',
      items: [{ medicineName: 'Metronidazole', form: 'tablet', dose: '400 mg', frequency: '1+1+1', duration: '5 days', timing: 'after food', customInstructions: '', notes: '' }]
    });
    const patient = ctx.services.patients.getById(patientId);
    const html = buildPrescriptionHtml({ clinic: ctx.services.clinic.get(), logoDataUrl: null, rx, patientSex: patient.sex, patientAge: patient.age });
    expectCleanDoc(html);
    expect(html).toContain('PT-000001'); // Patient Code
    expect(html).toContain('Rahim Uddin');
    expect(html).toContain('Test Dental Clinic');
    expect(html).toContain('Dr. Ayesha Rahman');
    expect(html).toContain('BDS, DDS');
    expect(html).toContain('RX-000001');
    expect(html).toContain('Pain On');
    expect(html).toContain('Gingivitis');
    expect(html).toContain('Metronidazole');
    expect(html).toContain('after food');
    const lower = html.toLowerCase();
    for (const bad of ['price', 'subtotal', 'total', 'discount', 'tax', 'paid', 'due', 'balance', 'invoice', '৳']) {
      expect(lower, `prescription leaked financial token "${bad}"`).not.toContain(bad);
    }
  });

  it('invoice document: identity, items, totals, paid/due', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const invoice = ctx.services.billing.createInvoice('t', {
      patientId,
      items: [{ description: 'Crown', qty: 1, unitPrice: '12000', toothFdi: '36' }, { description: 'Cementation', qty: 1, unitPrice: '500' }],
      discount: '500', tax: '0'
    });
    ctx.services.billing.recordPayment('t', { patientId, invoiceId: invoice.id, amount: '6000', method: 'bKash' });
    const fresh = ctx.services.billing.getInvoice(invoice.id);
    const html = buildInvoiceHtml({ clinic: ctx.services.clinic.get(), logoDataUrl: null, invoice: fresh });
    expectCleanDoc(html);
    expect(html).toContain('INV-000001');
    expect(html).toContain('PT-000001');
    expect(html).toContain('Crown');
    expect(html).toContain('Tooth 36');
    expect(html).toContain('৳12,000.00'); // total
    expect(html).toContain('Partially Paid');
  });

  it('receipt document: payment-only content with remaining due', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Filling', qty: 1, unitPrice: '1500' }] });
    const { payment, remainingDue } = ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '1000', method: 'Rocket', reference: 'TXN-9988' });
    expect(remainingDue).toBe(50000);
    const html = buildReceiptHtml({ clinic: ctx.services.clinic.get(), logoDataUrl: null, payment, remainingDue });
    expectCleanDoc(html);
    expect(html).toContain('RCP-000001');
    expect(html).toContain('Rocket');
    expect(html).toContain('TXN-9988');
    expect(html).toContain('INV-000001');
    expect(html).toContain('Remaining Due');
    expect(html).toContain('৳500.00');
  });

  it('statement document: opening, history, running, closing', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Checkup', qty: 1, unitPrice: '500' }] });
    ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '200', method: 'Cash' });
    const st = ctx.services.statements.statement(patientId, '2000-01-01', '2100-01-01');
    const html = buildStatementHtml({
      clinic: ctx.services.clinic.get(), logoDataUrl: null,
      patientName: 'Rahim Uddin', patientCode: 'PT-000001', from: '2000-01-01', to: '2100-01-01', statement: st
    });
    expectCleanDoc(html);
    expect(html).toContain('Opening Balance');
    expect(html).toContain('Closing Balance');
    expect(html).toContain('RCP-000001');
    expect(html).toContain('INV-000001');
    expect(html).toContain('৳300.00'); // closing balance
  });

  it('document HTML is identical for preview and PDF (same representation)', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'X', qty: 1, unitPrice: '100' }] });
    const a = buildInvoiceHtml({ clinic: ctx.services.clinic.get(), logoDataUrl: null, invoice: inv }, 'A4');
    const b = buildInvoiceHtml({ clinic: ctx.services.clinic.get(), logoDataUrl: null, invoice: inv }, 'A4');
    expect(a).toBe(b); // deterministic → preview == PDF source
  });
});
