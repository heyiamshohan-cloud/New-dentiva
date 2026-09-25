import type Database from 'better-sqlite3';
import { AppError, ERR } from '@shared/types';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface StaffRow {
  id: number;
  name: string;
  phone: string;
  email: string;
  roleLabel: string;
  professionalInfo: string;
  notes: string;
  active: boolean;
}

export interface StaffInput {
  name: string;
  phone?: string;
  email?: string;
  roleLabel?: string;
  professionalInfo?: string;
  notes?: string;
  active?: boolean;
}

function map(r: Record<string, unknown>): StaffRow {
  return {
    id: r.id as number,
    name: r.name as string,
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    roleLabel: (r.role_label as string) ?? '',
    professionalInfo: (r.professional_info as string) ?? '',
    notes: (r.notes as string) ?? '',
    active: !!r.active
  };
}

export class StaffService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  list(includeInactive = false): StaffRow[] {
    const sql = includeInactive ? 'SELECT * FROM staff ORDER BY name' : 'SELECT * FROM staff WHERE active = 1 ORDER BY name';
    return (this.db.prepare(sql).all() as Record<string, unknown>[]).map(map);
  }

  get(id: number): StaffRow {
    const r = this.db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Staff member not found.');
    return map(r);
  }

  create(actor: string, input: StaffInput): StaffRow {
    if (!input.name?.trim()) throw new AppError(ERR.VALIDATION, 'Staff name is required.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO staff (name, phone, email, role_label, professional_info, notes, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name.trim(),
          input.phone ?? '',
          input.email ?? '',
          input.roleLabel ?? '',
          input.professionalInfo ?? '',
          input.notes ?? '',
          (input.active ?? true) ? 1 : 0,
          now,
          now
        );
      this.audit.record(actor, 'staff.create', 'staff', Number(res.lastInsertRowid), { name: input.name.trim() });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  update(actor: string, id: number, patch: Partial<StaffInput>): StaffRow {
    const cur = this.get(id);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE staff SET name = ?, phone = ?, email = ?, role_label = ?, professional_info = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          (patch.name ?? cur.name).trim(),
          patch.phone ?? cur.phone,
          patch.email ?? cur.email,
          patch.roleLabel ?? cur.roleLabel,
          patch.professionalInfo ?? cur.professionalInfo,
          patch.notes ?? cur.notes,
          (patch.active ?? cur.active) ? 1 : 0,
          nowUtc(),
          id
        );
      this.audit.record(actor, 'staff.update', 'staff', id, patch as Record<string, unknown>);
    });
    tx.immediate();
    return this.get(id);
  }
}

/** Default clinic payment methods (Bangladesh market defaults). Configurable afterwards. */
export const DEFAULT_PAYMENT_METHODS = ['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay'];

export class PaymentMethodService {
  constructor(private db: Database.Database) {}

  seedDefaults(): void {
    const tx = this.db.transaction(() => {
      DEFAULT_PAYMENT_METHODS.forEach((name, i) => {
        this.db
          .prepare('INSERT OR IGNORE INTO payment_methods (name, built_in, active, sort_order) VALUES (?, 1, 1, ?)')
          .run(name, i + 1);
      });
    });
    tx.immediate();
  }

  list(activeOnly = false): Array<{ id: number; name: string; active: boolean; builtIn: boolean }> {
    const sql = activeOnly
      ? 'SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort_order, name'
      : 'SELECT * FROM payment_methods ORDER BY sort_order, name';
    return (this.db.prepare(sql).all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      name: r.name as string,
      active: !!r.active,
      builtIn: !!r.built_in
    }));
  }

  add(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError(ERR.VALIDATION, 'Payment method name is required.');
    this.db.prepare('INSERT INTO payment_methods (name, built_in, active, sort_order) VALUES (?, 0, 1, 100)').run(trimmed);
  }

  setActive(id: number, active: boolean): void {
    this.db.prepare('UPDATE payment_methods SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
}
