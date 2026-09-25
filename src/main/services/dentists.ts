import type Database from 'better-sqlite3';
import { AppError, ERR } from '@shared/types';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface DentistRow {
  id: number;
  userId: number | null;
  name: string;
  credentials: string;
  designation: string;
  registrationNo: string;
  phone: string;
  email: string;
  active: boolean;
}

function map(r: Record<string, unknown>): DentistRow {
  return {
    id: r.id as number,
    userId: (r.user_id as number) ?? null,
    name: r.name as string,
    credentials: (r.credentials as string) ?? '',
    designation: (r.designation as string) ?? '',
    registrationNo: (r.registration_no as string) ?? '',
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    active: !!r.active
  };
}

export interface DentistInput {
  name: string;
  credentials?: string;
  designation?: string;
  registrationNo?: string;
  phone?: string;
  email?: string;
  userId?: number | null;
  active?: boolean;
}

export class DentistService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  list(includeInactive = false): DentistRow[] {
    const sql = includeInactive ? 'SELECT * FROM dentists ORDER BY name' : 'SELECT * FROM dentists WHERE active = 1 ORDER BY name';
    return (this.db.prepare(sql).all() as Record<string, unknown>[]).map(map);
  }

  get(id: number): DentistRow {
    const r = this.db.prepare('SELECT * FROM dentists WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Dentist not found.');
    return map(r);
  }

  create(actor: string, input: DentistInput): DentistRow {
    if (!input.name?.trim()) throw new AppError(ERR.VALIDATION, 'Dentist name is required.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO dentists (user_id, name, credentials, designation, registration_no, phone, email, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.userId ?? null,
          input.name.trim(),
          input.credentials ?? '',
          input.designation ?? '',
          input.registrationNo ?? '',
          input.phone ?? '',
          input.email ?? '',
          (input.active ?? true) ? 1 : 0,
          now,
          now
        );
      this.audit.record(actor, 'dentist.create', 'dentists', Number(res.lastInsertRowid), { name: input.name.trim() });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  update(actor: string, id: number, patch: Partial<DentistInput>): DentistRow {
    const cur = this.get(id);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE dentists SET user_id = ?, name = ?, credentials = ?, designation = ?, registration_no = ?,
           phone = ?, email = ?, active = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          patch.userId !== undefined ? patch.userId : cur.userId,
          (patch.name ?? cur.name).trim(),
          patch.credentials ?? cur.credentials,
          patch.designation ?? cur.designation,
          patch.registrationNo ?? cur.registrationNo,
          patch.phone ?? cur.phone,
          patch.email ?? cur.email,
          (patch.active ?? cur.active) ? 1 : 0,
          nowUtc(),
          id
        );
      this.audit.record(actor, 'dentist.update', 'dentists', id, patch as Record<string, unknown>);
    });
    tx.immediate();
    return this.get(id);
  }
}
