import type Database from 'better-sqlite3';
import { AppError, ERR, Paisa, TreatmentPlanStatus } from '@shared/types';
import { parseNonNegativeMoney } from '../domain/money';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface PlanItemRow {
  id: number;
  treatmentId: number | null;
  label: string;
  toothFdi: string;
  qty: number;
  unitPrice: Paisa;
  sortOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completedAt: string | null;
}

export interface PlanRow {
  id: number;
  patientId: number;
  title: string;
  diagnosis: string;
  status: TreatmentPlanStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: PlanItemRow[];
  estimatedTotal: Paisa;
}

export interface PlanItemInput {
  treatmentId?: number | null;
  customName?: string;
  toothFdi?: string;
  qty?: number;
  unitPrice: string | number;
  sortOrder?: number;
}

export interface PlanInput {
  patientId: number;
  title?: string;
  diagnosis?: string;
  notes?: string;
  items?: PlanItemInput[];
}

const VALID_STATUS: TreatmentPlanStatus[] = ['draft', 'proposed', 'accepted', 'in_progress', 'completed', 'cancelled'];

function loadItems(db: Database.Database, planId: number): PlanItemRow[] {
  const rows = db
    .prepare(
      `SELECT i.*, COALESCE(t.name, i.custom_name) label
       FROM treatment_plan_items i LEFT JOIN treatments t ON t.id = i.treatment_id
       WHERE i.plan_id = ? ORDER BY i.sort_order ASC, i.id ASC`
    )
    .all(planId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    treatmentId: (r.treatment_id as number) ?? null,
    label: (r.label as string) ?? '',
    toothFdi: (r.tooth_fdi as string) ?? '',
    qty: r.qty as number,
    unitPrice: r.unit_price_paisa as number,
    sortOrder: r.sort_order as number,
    status: r.status as PlanItemRow['status'],
    completedAt: (r.completed_at as string) ?? null
  }));
}

export class PlanService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  get(id: number): PlanRow {
    const r = this.db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Treatment plan not found.');
    const items = loadItems(this.db, id);
    return {
      id: r.id as number,
      patientId: r.patient_id as number,
      title: (r.title as string) ?? '',
      diagnosis: (r.diagnosis as string) ?? '',
      status: r.status as TreatmentPlanStatus,
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      items,
      estimatedTotal: items.filter((i) => i.status !== 'skipped').reduce((a, i) => a + i.unitPrice * i.qty, 0)
    };
  }

  listForPatient(patientId: number): PlanRow[] {
    const rows = this.db.prepare('SELECT id FROM treatment_plans WHERE patient_id = ? ORDER BY id DESC').all(patientId) as Array<{ id: number }>;
    return rows.map((r) => this.get(r.id));
  }

  private replaceItems(planId: number, items: PlanItemInput[]): void {
    this.db.prepare('DELETE FROM treatment_plan_items WHERE plan_id = ?').run(planId);
    const stmt = this.db.prepare(
      `INSERT INTO treatment_plan_items (plan_id, treatment_id, custom_name, tooth_fdi, qty, unit_price_paisa, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    );
    items.forEach((item, i) => {
      const qty = item.qty ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new AppError(ERR.VALIDATION, 'Plan item quantity must be 1–999.');
      const price = parseNonNegativeMoney(item.unitPrice, 'item price');
      let label = (item.customName ?? '').trim();
      if (item.treatmentId != null) {
        const t = this.db.prepare('SELECT name FROM treatments WHERE id = ?').get(item.treatmentId) as { name: string } | undefined;
        if (!t) throw new AppError(ERR.VALIDATION, `Treatment ${item.treatmentId} does not exist.`);
        if (!label) label = t.name;
      }
      if (!label) throw new AppError(ERR.VALIDATION, `Plan item ${i + 1} needs a treatment or a custom name.`);
      stmt.run(planId, item.treatmentId ?? null, label, item.toothFdi ?? '', qty, price, item.sortOrder ?? i + 1);
    });
  }

  create(actor: string, input: PlanInput): PlanRow {
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO treatment_plans (patient_id, title, diagnosis, status, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`
        )
        .run(input.patientId, input.title ?? '', input.diagnosis ?? '', input.notes ?? '', actor, now, now);
      const id = Number(res.lastInsertRowid);
      this.replaceItems(id, input.items ?? []);
      this.audit.record(actor, 'plan.create', 'treatment_plans', id, {});
      return id;
    });
    return this.get(tx.immediate());
  }

  update(actor: string, id: number, patch: Partial<PlanInput>): PlanRow {
    const cur = this.get(id);
    if (cur.status === 'completed' || cur.status === 'cancelled') {
      throw new AppError(ERR.CONFLICT, `A ${cur.status} treatment plan can no longer be edited.`);
    }
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE treatment_plans SET title=?, diagnosis=?, notes=?, updated_at=? WHERE id=?')
        .run(patch.title ?? cur.title, patch.diagnosis ?? cur.diagnosis, patch.notes ?? cur.notes, nowUtc(), id);
      if (patch.items) this.replaceItems(id, patch.items);
      this.audit.record(actor, 'plan.update', 'treatment_plans', id, {});
    });
    tx.immediate();
    return this.get(id);
  }

  setStatus(actor: string, id: number, status: TreatmentPlanStatus): PlanRow {
    if (!VALID_STATUS.includes(status)) throw new AppError(ERR.VALIDATION, 'Invalid plan status.');
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE treatment_plans SET status=?, updated_at=? WHERE id=?').run(status, nowUtc(), id);
      this.audit.record(actor, `plan.${status}`, 'treatment_plans', id, {});
    });
    tx.immediate();
    return this.get(id);
  }

  setItemStatus(actor: string, itemId: number, status: PlanItemRow['status']): PlanRow {
    const item = this.db.prepare('SELECT plan_id FROM treatment_plan_items WHERE id = ?').get(itemId) as { plan_id: number } | undefined;
    if (!item) throw new AppError(ERR.NOT_FOUND, 'Plan item not found.');
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE treatment_plan_items SET status=?, completed_at=? WHERE id=?')
        .run(status, status === 'completed' ? nowUtc() : null, itemId);
      this.audit.record(actor, `plan.item.${status}`, 'treatment_plan_items', itemId, { planId: item.plan_id });
    });
    tx.immediate();
    return this.get(item.plan_id);
  }
}
