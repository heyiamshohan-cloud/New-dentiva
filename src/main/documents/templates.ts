/**
 * Document engine — pure HTML building. The SAME representation feeds the
 * on-screen print preview and the PDF generator, guaranteeing preview ↔ PDF
 * parity (spec: Document Engine / Prescription Preview). Templates contain
 * no placeholders: every value is interpolated and escaped.
 */
import type { ClinicProfile } from '@shared/types';
import { formatPaisa } from '../domain/money';
import type { PrescriptionRow } from '../services/prescriptions';
import type { InvoiceRow, PaymentRow } from '../services/billing';
import type { StatementOut } from '../domain/financial';

export type PaperSize = 'A4' | 'A5' | 'Letter' | '80mm';

const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 216, height: 279 },
  '80mm': { width: 80, height: 297 }
};

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseCss(size: PaperSize, opts: { financial?: boolean } = {}): string {
  const { financial = true } = opts;
  const p = PAPER_MM[size];
  const narrow = size === '80mm';
  const financialCss = financial
    ? `
    .totals { margin-left: auto; width: ${narrow ? '100%' : '260px'}; margin-top: 6px; }
    .totals td { border: none; padding: 2.5px 6px; }
    .totals .grand td { border-top: 1.5px solid #0e5f8a; font-weight: 700; font-size: ${narrow ? '11px' : '12.5px'}; }
    .badge.paid { color: #157347; border-color: #157347; }
    .badge.due { color: #b02a37; border-color: #b02a37; }
    .badge.partial { color: #9a6a00; border-color: #9a6a00; }`
    : '';
  return `
    @page { size: ${p.width}mm ${p.height}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      color: #1d2733; background: #fff;
      font-size: ${narrow ? '10px' : '11.5px'}; line-height: 1.45;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet { width: ${p.width}mm; min-height: ${p.height}mm; padding: ${narrow ? '5mm 4mm' : '14mm 16mm'}; margin: 0 auto; }
    .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0e5f8a; padding-bottom: 8px; margin-bottom: 12px; }
    .brand { display: flex; gap: 10px; align-items: center; }
    .brand img { height: ${narrow ? '26px' : '44px'}; width: auto; }
    .clinic-name { font-size: ${narrow ? '13px' : '18px'}; font-weight: 700; color: #0e5f8a; }
    .clinic-meta { font-size: ${narrow ? '9px' : '10px'}; color: #55616e; }
    .doc-title { text-align: right; }
    .doc-title h2 { font-size: ${narrow ? '12px' : '15px'}; letter-spacing: 0.08em; text-transform: uppercase; color: #1d2733; }
    .doc-title .num { font-size: ${narrow ? '9px' : '10.5px'}; color: #55616e; }
    .patient-strip { display: flex; flex-wrap: wrap; gap: 4px 18px; background: #f2f6f9; border: 1px solid #d9e2ea; border-radius: 4px; padding: 7px 10px; margin-bottom: 12px; }
    .patient-strip .cell { font-size: ${narrow ? '9px' : '10.5px'}; }
    .patient-strip .lbl { color: #6b7885; margin-right: 4px; }
    .patient-strip .val { font-weight: 600; }
    .section { margin-bottom: 10px; }
    .section h3 { font-size: ${narrow ? '10px' : '11px'}; text-transform: uppercase; letter-spacing: 0.06em; color: #0e5f8a; border-bottom: 1px solid #d9e2ea; padding-bottom: 2px; margin-bottom: 5px; }
    .kv { font-size: ${narrow ? '9.5px' : '11px'}; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { border: 1px solid #b9c8d4; border-radius: 3px; padding: 1px 7px; font-size: ${narrow ? '9px' : '10px'}; background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: ${narrow ? '9px' : '10px'}; text-transform: uppercase; letter-spacing: 0.05em; color: #55616e; border-bottom: 1.5px solid #9db2c1; padding: 4px 6px; }
    td { border-bottom: 1px solid #e3eaf0; padding: 4px 6px; vertical-align: top; font-size: ${narrow ? '9.5px' : '11px'}; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .rx-symbol { font-size: ${narrow ? '16px' : '24px'}; font-weight: 700; color: #0e5f8a; font-family: Georgia, 'Times New Roman', serif; }
    .med { margin-bottom: 8px; page-break-inside: avoid; }
    .med-name { font-weight: 700; font-size: ${narrow ? '10.5px' : '12px'}; }
    .med-detail { color: #333f4b; font-size: ${narrow ? '9.5px' : '11px'}; }
    .footer { margin-top: 18px; }
    .signature { display: flex; justify-content: flex-end; margin-top: ${narrow ? '16px' : '40px'}; }
    .signature .box { text-align: center; min-width: 180px; }
    .signature .line { border-top: 1px solid #1d2733; margin-bottom: 3px; }
    .signature .who { font-size: ${narrow ? '9px' : '10.5px'}; color: #333f4b; }
    .doc-footer { margin-top: 14px; border-top: 1px solid #d9e2ea; padding-top: 6px; font-size: ${narrow ? '8.5px' : '9.5px'}; color: #6b7885; }
    .badge { display: inline-block; border: 1px solid; border-radius: 3px; padding: 0 6px; font-size: ${narrow ? '9px' : '10px'}; font-weight: 700; text-transform: uppercase; }
    .badge.void { color: #6b7885; border-color: #6b7885; }
    .center { text-align: center; }
    .muted { color: #6b7885; }
    .bold { font-weight: 700; }
    @media print { .sheet { margin: 0; } }
    ${financialCss}
  `;
}

function docShell(size: PaperSize, title: string, body: string, opts: { financial?: boolean } = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${baseCss(size, opts)}</style></head><body><div class="sheet">${body}</div></body></html>`;
}

function header(clinic: ClinicProfile, docTitle: string, number: string, dateIso: string, logoDataUrl: string | null): string {
  return `
  <div class="doc-header">
    <div class="brand">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}
      <div>
        <div class="clinic-name">${esc(clinic.name)}</div>
        <div class="clinic-meta">
          ${esc(clinic.address)}${clinic.address ? '<br>' : ''}
          ${clinic.phone ? `Phone: ${esc(clinic.phone)}` : ''}${clinic.email ? ` · ${esc(clinic.email)}` : ''}${clinic.website ? `<br>${esc(clinic.website)}` : ''}
          ${clinic.registrationNo ? `<br>Reg No: ${esc(clinic.registrationNo)}` : ''}
        </div>
      </div>
    </div>
    <div class="doc-title">
      <h2>${esc(docTitle)}</h2>
      <div class="num">No: ${esc(number)}</div>
      <div class="num">Date: ${esc(dateIso.slice(0, 10))}</div>
    </div>
  </div>`;
}

function fmtLocal(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------- prescription

export interface PrescriptionDocInput {
  clinic: ClinicProfile;
  logoDataUrl: string | null;
  rx: PrescriptionRow;
  patientSex: string;
  patientAge: number | null;
}

/** Clinical document ONLY — zero financial fields (spec: Financial Separation). */
export function buildPrescriptionHtml(input: PrescriptionDocInput, size: PaperSize = 'A4'): string {
  const { clinic, rx, logoDataUrl } = input;
  const meds = rx.items
    .map((m, i) => {
      const line1 = [m.form !== 'custom' ? m.form : '', m.medicineName].filter(Boolean).join(' ').trim();
      const line2 = [
        m.dose ? `Dose: ${m.dose}` : '',
        m.frequency ? `Frequency: ${m.frequency}` : '',
        m.duration ? `Duration: ${m.duration}` : '',
        m.timing ? `Timing: ${m.timing}` : ''
      ].filter(Boolean).join(' · ');
      const line3 = [m.customInstructions, m.notes ? `Note: ${m.notes}` : ''].filter(Boolean).join(' — ');
      return `<div class="med"><div class="med-name">${i + 1}. ${esc(line1)}</div>
        ${line2 ? `<div class="med-detail">${esc(line2)}</div>` : ''}
        ${line3 ? `<div class="med-detail muted">${esc(line3)}</div>` : ''}</div>`;
    })
    .join('');
  const body = `
    ${header(clinic, 'Prescription', rx.number, rx.prescribedAt, logoDataUrl)}
    <div class="patient-strip">
      <span class="cell"><span class="lbl">Patient</span><span class="val">${esc(rx.patientName)}</span></span>
      <span class="cell"><span class="lbl">Patient Code</span><span class="val">${esc(rx.patientCode)}</span></span>
      <span class="cell"><span class="lbl">Sex</span><span class="val">${esc(input.patientSex)}</span></span>
      <span class="cell"><span class="lbl">Age</span><span class="val">${input.patientAge != null ? `${input.patientAge} yrs` : '—'}</span></span>
    </div>
    ${rx.cc.length ? `<div class="section"><h3>C/C — Chief Complaint</h3><div class="chips">${rx.cc.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>` : ''}
    ${rx.oe.length ? `<div class="section"><h3>O/E — On Examination</h3><div class="chips">${rx.oe.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>` : ''}
    ${rx.re ? `<div class="section"><h3>R/E</h3><div class="kv">${esc(rx.re)}</div></div>` : ''}
    <div class="section"><div class="rx-symbol">R<sub>x</sub></div>${meds}</div>
    ${rx.advice ? `<div class="section"><h3>Advice</h3><div class="kv">${esc(rx.advice)}</div></div>` : ''}
    <div class="signature"><div class="box"><div class="line"></div>
      <div class="who">${esc(rx.dentistName || 'Dentist')}${rx.dentistCredentials ? `<br>${esc(rx.dentistCredentials)}` : ''}</div>
    </div></div>
    ${clinic.documentFooterNote ? `<div class="doc-footer">${esc(clinic.documentFooterNote)}</div>` : ''}
  `;
  // Clinical documents get a stylesheet with zero financial vocabulary
  // (spec: Prescription Financial Separation — defense in depth).
  return docShell(size, `Prescription ${rx.number}`, body, { financial: false });
}

// ------------------------------------------------------------------- invoice

export interface InvoiceDocInput {
  clinic: ClinicProfile;
  logoDataUrl: string | null;
  invoice: InvoiceRow;
}

export function buildInvoiceHtml(input: InvoiceDocInput, size: PaperSize = 'A4'): string {
  const { clinic, invoice: inv, logoDataUrl } = input;
  const sym = clinic.currencySymbol;
  const itemRows = inv.items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.description)}${it.toothFdi ? `<div class="muted">Tooth ${esc(it.toothFdi)}</div>` : ''}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${esc(formatPaisa(it.unitPrice, sym))}</td>
        <td class="num">${it.discount ? esc(formatPaisa(-it.discount, sym)) : '—'}</td>
        <td class="num">${it.tax ? esc(formatPaisa(it.tax, sym)) : '—'}</td>
        <td class="num">${esc(formatPaisa(it.lineTotal, sym))}</td>
      </tr>`
    )
    .join('');
  const st = inv.computed.status;
  const badge =
    st === 'paid' ? '<span class="badge paid">Paid</span>' :
    st === 'partially_paid' ? '<span class="badge partial">Partially Paid</span>' :
    st === 'void' ? '<span class="badge void">Void</span>' :
    '<span class="badge due">Due</span>';
  const body = `
    ${header(clinic, 'Invoice', inv.number, inv.issuedAt, logoDataUrl)}
    <div class="patient-strip">
      <span class="cell"><span class="lbl">Patient</span><span class="val">${esc(inv.patientName)}</span></span>
      <span class="cell"><span class="lbl">Patient Code</span><span class="val">${esc(inv.patientCode)}</span></span>
      ${inv.dentistName ? `<span class="cell"><span class="lbl">Dentist</span><span class="val">${esc(inv.dentistName)}</span></span>` : ''}
      <span class="cell">${badge}</span>
    </div>
    <table>
      <thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Discount</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table class="totals"><tbody>
      <tr><td>Subtotal</td><td class="num">${esc(formatPaisa(inv.subtotal + inv.items.reduce((a, i) => a + i.discount, 0), sym))}</td></tr>
      <tr><td>Discount</td><td class="num">${esc(formatPaisa(-inv.discount - inv.items.reduce((a, i) => a + i.discount, 0), sym))}</td></tr>
      <tr><td>Tax</td><td class="num">${esc(formatPaisa(inv.tax + inv.items.reduce((a, i) => a + i.tax, 0), sym))}</td></tr>
      <tr class="grand"><td>Total</td><td class="num">${esc(formatPaisa(inv.total, sym))}</td></tr>
      <tr><td>Paid</td><td class="num">${esc(formatPaisa(inv.computed.totalPaid, sym))}</td></tr>
      <tr><td class="bold">Due</td><td class="num bold">${esc(formatPaisa(inv.computed.totalDue, sym))}</td></tr>
    </tbody></table>
    ${inv.notes ? `<div class="section" style="margin-top:10px"><h3>Notes</h3><div class="kv">${esc(inv.notes)}</div></div>` : ''}
    ${clinic.documentFooterNote ? `<div class="doc-footer">${esc(clinic.documentFooterNote)}</div>` : ''}
  `;
  return docShell(size, `Invoice ${inv.number}`, body);
}

// ------------------------------------------------------------------- receipt

export interface ReceiptDocInput {
  clinic: ClinicProfile;
  logoDataUrl: string | null;
  payment: PaymentRow;
  remainingDue: number;
}

export function buildReceiptHtml(input: ReceiptDocInput, size: PaperSize = '80mm'): string {
  const { clinic, payment: pay, remainingDue, logoDataUrl } = input;
  const sym = clinic.currencySymbol;
  const body = `
    ${header(clinic, 'Payment Receipt', pay.receiptNo, pay.paidAt, logoDataUrl)}
    <div class="patient-strip">
      <span class="cell"><span class="lbl">Patient</span><span class="val">${esc(pay.patientName)}</span></span>
      <span class="cell"><span class="lbl">Patient Code</span><span class="val">${esc(pay.patientCode)}</span></span>
      ${pay.invoiceNumber ? `<span class="cell"><span class="lbl">Invoice</span><span class="val">${esc(pay.invoiceNumber)}</span></span>` : ''}
    </div>
    <table><tbody>
      <tr><td>Amount Received</td><td class="num bold">${esc(formatPaisa(pay.amount, sym))}</td></tr>
      <tr><td>Method</td><td class="num">${esc(pay.method)}</td></tr>
      ${pay.reference ? `<tr><td>Reference</td><td class="num">${esc(pay.reference)}</td></tr>` : ''}
      <tr><td>Received By</td><td class="num">${esc(pay.receivedBy)}</td></tr>
      <tr><td>Date</td><td class="num">${esc(fmtLocal(pay.paidAt))}</td></tr>
      <tr><td class="bold">Remaining Due</td><td class="num bold">${esc(formatPaisa(remainingDue, sym))}</td></tr>
    </tbody></table>
    ${pay.notes ? `<div class="section" style="margin-top:8px"><h3>Notes</h3><div class="kv">${esc(pay.notes)}</div></div>` : ''}
    ${pay.void ? '<div class="center" style="margin-top:8px"><span class="badge void">VOID</span></div>' : ''}
    <div class="doc-footer center">Thank you for your payment.${clinic.documentFooterNote ? `<br>${esc(clinic.documentFooterNote)}` : ''}</div>
  `;
  return docShell(size, `Receipt ${pay.receiptNo}`, body);
}

// ----------------------------------------------------------------- statement

export interface StatementDocInput {
  clinic: ClinicProfile;
  logoDataUrl: string | null;
  patientName: string;
  patientCode: string;
  from: string;
  to: string;
  statement: StatementOut;
}

export function buildStatementHtml(input: StatementDocInput, size: PaperSize = 'A4'): string {
  const { clinic, logoDataUrl, statement: st } = input;
  const sym = clinic.currencySymbol;
  const rows = st.rows
    .map((r) => {
      const desc = esc(r.description);
      const kindLabel = r.kind === 'invoice' ? 'Invoice' : r.kind === 'payment' ? 'Payment' : 'Adjustment';
      return `<tr>
        <td>${esc(r.effectiveAt.slice(0, 10))}</td>
        <td>${kindLabel}</td>
        <td>${esc(r.ref)}</td>
        <td>${desc}</td>
        <td class="num">${r.debit ? esc(formatPaisa(r.debit, sym)) : ''}</td>
        <td class="num">${r.credit ? esc(formatPaisa(r.credit, sym)) : ''}</td>
        <td class="num">${esc(formatPaisa(r.balance, sym))}</td>
      </tr>`;
    })
    .join('');
  const body = `
    ${header(clinic, 'Patient Statement', `${input.from} → ${input.to}`, new Date().toISOString(), logoDataUrl)}
    <div class="patient-strip">
      <span class="cell"><span class="lbl">Patient</span><span class="val">${esc(input.patientName)}</span></span>
      <span class="cell"><span class="lbl">Patient Code</span><span class="val">${esc(input.patientCode)}</span></span>
      <span class="cell"><span class="lbl">Period</span><span class="val">${esc(input.from)} → ${esc(input.to)}</span></span>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>
        <tr><td colspan="6" class="bold">Opening Balance</td><td class="num bold">${esc(formatPaisa(st.openingBalance, sym))}</td></tr>
        ${rows}
        <tr><td colspan="4" class="bold">Totals</td><td class="num bold">${esc(formatPaisa(st.totalDebits, sym))}</td><td class="num bold">${esc(formatPaisa(st.totalCredits, sym))}</td><td class="num"></td></tr>
        <tr><td colspan="6" class="bold">Closing Balance</td><td class="num bold">${esc(formatPaisa(st.closingBalance, sym))}</td></tr>
      </tbody>
    </table>
    ${clinic.documentFooterNote ? `<div class="doc-footer">${esc(clinic.documentFooterNote)}</div>` : ''}
  `;
  return docShell(size, `Statement ${input.patientCode} ${input.from} ${input.to}`, body);
}

export const PAPER_DIMENSIONS = PAPER_MM;
