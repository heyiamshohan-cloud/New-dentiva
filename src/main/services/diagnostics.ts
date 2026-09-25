import type Database from 'better-sqlite3';
import { integrityCheck, foreignKeyCheck } from '../db/database';
import { AttachmentService } from './attachments';

export interface DiagnosticIssue {
  area: string;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Data-integrity diagnostics: engine integrity, foreign keys, duplicate
 * identifiers, unbalanced financial records, orphans, broken attachments.
 */
export class DiagnosticsService {
  constructor(private db: Database.Database, private attachments: AttachmentService) {}

  run(): { ok: boolean; issues: DiagnosticIssue[]; checkedAt: string } {
    const issues: DiagnosticIssue[] = [];
    const add = (area: string, severity: 'error' | 'warning', message: string) => issues.push({ area, severity, message });

    const ic = integrityCheck(this.db);
    if (!ic.ok) add('database', 'error', `SQLite integrity_check: ${ic.details.join('; ')}`);

    const fk = foreignKeyCheck(this.db);
    for (const v of fk.slice(0, 50)) add('foreign keys', 'error', `FK violation: ${v.table} row ${v.rowid} → ${v.parent}`);
    if (fk.length > 50) add('foreign keys', 'error', `${fk.length - 50} further FK violations not listed.`);

    const dupCodes = this.db
      .prepare('SELECT code, COUNT(*) c FROM patients GROUP BY code HAVING c > 1')
      .all() as Array<{ code: string; c: number }>;
    for (const d of dupCodes) add('patients', 'error', `Duplicate Patient Code ${d.code} (${d.c} records).`);

    const dupInv = this.db.prepare('SELECT number, COUNT(*) c FROM invoices GROUP BY number HAVING c > 1').all() as Array<{ number: string; c: number }>;
    for (const d of dupInv) add('billing', 'error', `Duplicate invoice number ${d.number}.`);

    const dupRcp = this.db.prepare('SELECT receipt_no, COUNT(*) c FROM payments GROUP BY receipt_no HAVING c > 1').all() as Array<{ receipt_no: string; c: number }>;
    for (const d of dupRcp) add('billing', 'error', `Duplicate receipt number ${d.receipt_no}.`);

    // Invoice totals must equal the sum of line totals adjusted by invoice discount/tax.
    const badTotals = this.db
      .prepare(
        `SELECT i.id, i.number, i.total_paisa,
                COALESCE(SUM(it.line_total_paisa),0) - i.discount_paisa + i.tax_paisa expected
         FROM invoices i LEFT JOIN invoice_items it ON it.invoice_id = i.id
         GROUP BY i.id HAVING expected <> i.total_paisa`
      )
      .all() as Array<{ id: number; number: string }>;
    for (const b of badTotals) add('billing', 'error', `Invoice ${b.number} total does not reconcile with its line items.`);

    // Payments referencing issued invoices must not point at void invoices.
    const payVoid = this.db
      .prepare("SELECT y.id, y.receipt_no FROM payments y JOIN invoices i ON i.id = y.invoice_id WHERE i.status = 'void' AND y.void = 0")
      .all() as Array<{ id: number; receipt_no: string }>;
    for (const p of payVoid) add('billing', 'warning', `Payment ${p.receipt_no} is active against a void invoice.`);

    // Orphans (belt-and-braces; FKs already restrict these).
    const orphanRx = (this.db.prepare('SELECT COUNT(*) c FROM prescription_items pi LEFT JOIN prescriptions r ON r.id = pi.prescription_id WHERE r.id IS NULL').get() as { c: number }).c;
    if (orphanRx) add('prescriptions', 'error', `${orphanRx} prescription item(s) without a parent prescription.`);
    const orphanItems = (this.db.prepare('SELECT COUNT(*) c FROM inventory_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_items x WHERE x.id = i.id)').get() as { c: number }).c;
    void orphanItems;

    // Inventory quantities must equal movement sums.
    const badStock = this.db
      .prepare(
        `SELECT i.id, i.sku, i.quantity, COALESCE(SUM(m.qty),0) movement_sum
         FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id = i.id
         GROUP BY i.id HAVING i.quantity <> movement_sum`
      )
      .all() as Array<{ id: number; sku: string; quantity: number; movement_sum: number }>;
    for (const s of badStock) add('inventory', 'error', `Item ${s.sku} balance ${s.quantity} ≠ movement total ${s.movement_sum}.`);

    const att = this.attachments.verifyAll();
    for (const p of att.problems) add('attachments', 'error', p);

    return { ok: !issues.some((i) => i.severity === 'error'), issues, checkedAt: new Date().toISOString() };
  }
}
