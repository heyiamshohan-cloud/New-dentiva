import type Database from 'better-sqlite3';
import { AppError, AppointmentStatus, ERR, Page } from '@shared/types';
import { nowUtc, isValidIso } from '../domain/datetime';
import { AuditService } from './audit';
import { NumberingService, NUMBER_KEYS } from './counters';

export interface AppointmentRow {
  id: number;
  number: string;
  patientId: number;
  patientCode: string;
  patientName: string;
  dentistId: number | null;
  dentistName: string;
  chair: string;
  room: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string;
  convertedVisitId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentInput {
  patientId: number;
  dentistId?: number | null;
  chair?: string;
  room?: string;
  startAt: string;
  durationMinutes: number;
  notes?: string;
}

const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'arrived', 'in_progress'];

/** All stored appointment timestamps use second-precision UTC ISO. */
function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
const VALID_STATUSES: AppointmentStatus[] = [...ACTIVE_STATUSES, 'completed', 'cancelled', 'no_show'];

function map(r: Record<string, unknown>): AppointmentRow {
  return {
    id: r.id as number,
    number: r.number as string,
    patientId: r.patient_id as number,
    patientCode: (r.p_code as string) ?? '',
    patientName: (r.p_name as string) ?? '',
    dentistId: (r.dentist_id as number) ?? null,
    dentistName: (r.d_name as string) ?? '',
    chair: (r.chair as string) ?? '',
    room: (r.room as string) ?? '',
    startAt: r.start_at as string,
    endAt: r.end_at as string,
    status: r.status as AppointmentStatus,
    notes: (r.notes as string) ?? '',
    convertedVisitId: (r.converted_visit_id as number) ?? null,
    createdBy: (r.created_by as string) ?? '',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

const SELECT = `
SELECT a.*, p.code p_code, p.full_name p_name, d.name d_name
FROM appointments a
JOIN patients p ON p.id = a.patient_id
LEFT JOIN dentists d ON d.id = a.dentist_id`;

function validate(input: { startAt: string; durationMinutes: number }): void {
  if (!isValidIso(input.startAt)) throw new AppError(ERR.VALIDATION, 'Appointment start time is not a valid date/time.');
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 8 * 60) {
    throw new AppError(ERR.VALIDATION, 'Appointment duration must be between 5 minutes and 8 hours.');
  }
  if (new Date(input.startAt).getTime() < Date.now() - 10 * 365 * 24 * 3600e3) {
    throw new AppError(ERR.VALIDATION, 'Appointment time is unreasonably far in the past.');
  }
}

export class AppointmentService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private numbering: NumberingService
  ) {}

  get(id: number): AppointmentRow {
    const r = this.db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Appointment not found.');
    return map(r);
  }

  /**
   * Resource-aware conflict detection: two active appointments conflict when
   * their time ranges overlap and they share the same dentist, chair or room.
   */
  findConflicts(startAt: string, endAt: string, dentistId: number | null, chair: string, room: string, excludeId?: number): AppointmentRow[] {
    const rows = this.db
      .prepare(
        `${SELECT}
         WHERE a.status IN ('scheduled','confirmed','arrived','in_progress')
           AND a.start_at < ? AND a.end_at > ?
           AND (? IS NULL OR a.id <> ?)`
      )
      .all(endAt, startAt, excludeId ?? null, excludeId ?? null) as Record<string, unknown>[];
    return rows
      .map(map)
      .filter((a) => {
        if (dentistId != null && a.dentistId === dentistId) return true;
        if (chair && a.chair && a.chair.toLowerCase() === chair.toLowerCase()) return true;
        if (room && a.room && a.room.toLowerCase() === room.toLowerCase()) return true;
        return false;
      });
  }

  create(actor: string, input: AppointmentInput, opts: { allowConflict?: boolean } = {}): AppointmentRow {
    validate(input);
    const startAt = isoSeconds(new Date(input.startAt).getTime());
    const endAt = isoSeconds(new Date(input.startAt).getTime() + input.durationMinutes * 60000);
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ? AND archived = 0').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist or is archived.');
    const conflicts = this.findConflicts(startAt, endAt, input.dentistId ?? null, input.chair ?? '', input.room ?? '');
    if (conflicts.length > 0 && !opts.allowConflict) {
      throw new AppError(ERR.CONFLICT, 'This time conflicts with an existing appointment for the same dentist, chair or room.', {
        conflicts: conflicts.map((c) => ({ id: c.id, number: c.number, startAt: c.startAt, patientName: c.patientName }))
      });
    }
    const tx = this.db.transaction(() => {
      const number = this.numbering.next(NUMBER_KEYS.appointment.key, NUMBER_KEYS.appointment.prefix);
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO appointments (number, patient_id, dentist_id, chair, room, start_at, end_at, status, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`
        )
        .run(number, input.patientId, input.dentistId ?? null, input.chair ?? '', input.room ?? '', startAt, endAt, input.notes ?? '', actor, now, now);
      this.audit.record(actor, 'appointment.create', 'appointments', Number(res.lastInsertRowid), { number });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  /** Reschedule (or change dentist/chair/room/duration/notes) with conflict detection. */
  update(actor: string, id: number, patch: Partial<AppointmentInput>, opts: { allowConflict?: boolean } = {}): AppointmentRow {
    const cur = this.get(id);
    if (cur.status === 'completed' || cur.status === 'cancelled' || cur.status === 'no_show') {
      throw new AppError(ERR.CONFLICT, `A ${cur.status.replace('_', '-')} appointment cannot be edited. Create a new appointment instead.`);
    }
    const startAt = isoSeconds(new Date(patch.startAt ?? cur.startAt).getTime());
    const duration = patch.durationMinutes ?? Math.round((new Date(cur.endAt).getTime() - new Date(cur.startAt).getTime()) / 60000);
    validate({ startAt, durationMinutes: duration });
    const endAt = isoSeconds(new Date(startAt).getTime() + duration * 60000);
    const dentistId = patch.dentistId !== undefined ? patch.dentistId : cur.dentistId;
    const chair = patch.chair ?? cur.chair;
    const room = patch.room ?? cur.room;
    const conflicts = this.findConflicts(startAt, endAt, dentistId, chair, room, id);
    if (conflicts.length > 0 && !opts.allowConflict) {
      throw new AppError(ERR.CONFLICT, 'This change conflicts with an existing appointment for the same dentist, chair or room.', {
        conflicts: conflicts.map((c) => ({ id: c.id, number: c.number, startAt: c.startAt, patientName: c.patientName }))
      });
    }
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE appointments SET patient_id=?, dentist_id=?, chair=?, room=?, start_at=?, end_at=?, notes=?, updated_at=? WHERE id=?')
        .run(patch.patientId ?? cur.patientId, dentistId, chair, room, startAt, endAt, patch.notes ?? cur.notes, nowUtc(), id);
      this.audit.record(actor, 'appointment.update', 'appointments', id, { number: cur.number });
    });
    tx.immediate();
    return this.get(id);
  }

  setStatus(actor: string, id: number, status: AppointmentStatus): AppointmentRow {
    if (!VALID_STATUSES.includes(status)) throw new AppError(ERR.VALIDATION, 'Invalid appointment status.');
    const cur = this.get(id);
    const terminal: AppointmentStatus[] = ['completed', 'cancelled', 'no_show'];
    if (terminal.includes(cur.status) && cur.status !== status) {
      throw new AppError(ERR.CONFLICT, `A ${cur.status.replace('_', '-')} appointment cannot be changed to another status.`);
    }
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(status, nowUtc(), id);
      this.audit.record(actor, `appointment.${status}`, 'appointments', id, { number: cur.number });
    });
    tx.immediate();
    return this.get(id);
  }

  markConverted(actor: string, id: number, visitId: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE appointments SET converted_visit_id = ?, status = 'completed', updated_at = ? WHERE id = ?")
        .run(visitId, nowUtc(), id);
      this.audit.record(actor, 'appointment.convert_to_visit', 'appointments', id, { visitId });
    });
    tx.immediate();
  }

  listRange(fromIso: string, toIso: string, opts: { dentistId?: number; status?: AppointmentStatus; page?: number; pageSize?: number } = {}): Page<AppointmentRow> {
    const where = ['a.start_at < ?', 'a.end_at > ?'];
    const args: unknown[] = [toIso, fromIso];
    if (opts.dentistId != null) { where.push('a.dentist_id = ?'); args.push(opts.dentistId); }
    if (opts.status) { where.push('a.status = ?'); args.push(opts.status); }
    const w = `WHERE ${where.join(' AND ')}`;
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM appointments a ${w}`).get(...args) as { c: number }).c;
    const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 500);
    const page = Math.max(opts.page ?? 1, 1);
    const rows = this.db
      .prepare(`${SELECT} ${w} ORDER BY a.start_at ASC, a.id ASC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { rows: rows.map(map), total, page, pageSize };
  }

  listForPatient(patientId: number, page = 1, pageSize = 50): Page<AppointmentRow> {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM appointments WHERE patient_id = ?').get(patientId) as { c: number }).c;
    const rows = this.db
      .prepare(`${SELECT} WHERE a.patient_id = ? ORDER BY a.start_at DESC, a.id DESC LIMIT ? OFFSET ?`)
      .all(patientId, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { rows: rows.map(map), total, page, pageSize };
  }
}
