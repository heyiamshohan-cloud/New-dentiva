import type Database from 'better-sqlite3';
import { AppError, ERR, QueueStatus } from '@shared/types';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface QueueEntryRow {
  id: number;
  day: string;
  serial: number;
  patientId: number;
  patientCode: string;
  patientName: string;
  dentistId: number | null;
  dentistName: string;
  room: string;
  chair: string;
  appointmentId: number | null;
  status: QueueStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function map(r: Record<string, unknown>): QueueEntryRow {
  return {
    id: r.id as number,
    day: r.day as string,
    serial: r.serial as number,
    patientId: r.patient_id as number,
    patientCode: (r.p_code as string) ?? '',
    patientName: (r.p_name as string) ?? '',
    dentistId: (r.dentist_id as number) ?? null,
    dentistName: (r.d_name as string) ?? '',
    room: (r.room as string) ?? '',
    chair: (r.chair as string) ?? '',
    appointmentId: (r.appointment_id as number) ?? null,
    status: r.status as QueueStatus,
    notes: (r.notes as string) ?? '',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

const SELECT = `
SELECT q.*, p.code p_code, p.full_name p_name, d.name d_name
FROM queue_entries q
JOIN patients p ON p.id = q.patient_id
LEFT JOIN dentists d ON d.id = q.dentist_id`;

/** Daily serial / clinical queue. Serials are unique per clinic-local day. */
export class QueueService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  listDay(day: string): QueueEntryRow[] {
    const rows = this.db.prepare(`${SELECT} WHERE q.day = ? ORDER BY q.serial ASC`).all(day) as Record<string, unknown>[];
    return rows.map(map);
  }

  get(id: number): QueueEntryRow {
    const r = this.db.prepare(`${SELECT} WHERE q.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Queue entry not found.');
    return map(r);
  }

  /** Add patient to today's queue; serial assigned transactionally. */
  add(actor: string, input: { day: string; patientId: number; dentistId?: number | null; room?: string; chair?: string; appointmentId?: number | null; notes?: string }): QueueEntryRow {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new AppError(ERR.VALIDATION, 'Queue day must be YYYY-MM-DD.');
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ? AND archived = 0').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist or is archived.');
    const tx = this.db.transaction(() => {
      const nextSerial = ((this.db.prepare('SELECT COALESCE(MAX(serial),0) m FROM queue_entries WHERE day = ?').get(input.day) as { m: number }).m) + 1;
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO queue_entries (day, serial, patient_id, dentist_id, room, chair, appointment_id, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`
        )
        .run(input.day, nextSerial, input.patientId, input.dentistId ?? null, input.room ?? '', input.chair ?? '', input.appointmentId ?? null, input.notes ?? '', now, now);
      this.audit.record(actor, 'queue.add', 'queue_entries', Number(res.lastInsertRowid), { day: input.day, serial: nextSerial });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  setStatus(actor: string, id: number, status: QueueStatus): QueueEntryRow {
    const valid: QueueStatus[] = ['waiting', 'called', 'in_progress', 'completed', 'skipped', 'cancelled'];
    if (!valid.includes(status)) throw new AppError(ERR.VALIDATION, 'Invalid queue status.');
    const cur = this.get(id);
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE queue_entries SET status = ?, updated_at = ? WHERE id = ?').run(status, nowUtc(), id);
      this.audit.record(actor, `queue.${status}`, 'queue_entries', id, { day: cur.day, serial: cur.serial });
    });
    tx.immediate();
    return this.get(id);
  }
}
