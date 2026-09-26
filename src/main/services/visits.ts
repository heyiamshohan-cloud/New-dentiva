import type Database from 'better-sqlite3';
import { AppError, ERR, Page } from '@shared/types';
import { nowUtc, isValidIso, isValidLocalDate } from '../domain/datetime';
import { AuditService } from './audit';
import { NumberingService, NUMBER_KEYS } from './counters';

export interface VisitRow {
  id: number;
  number: string;
  patientId: number;
  patientCode: string;
  patientName: string;
  dentistId: number | null;
  dentistName: string;
  appointmentId: number | null;
  visitAt: string;
  chiefComplaint: string;
  reason: string;
  symptoms: string;
  examination: string;
  diagnosis: string;
  treatmentPlanText: string;
  treatmentPerformed: string;
  toothNumbers: number[];
  procedures: string;
  anesthesia: string;
  medicationsText: string;
  advice: string;
  referral: string;
  followUpDate: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisitInput {
  patientId: number;
  dentistId?: number | null;
  appointmentId?: number | null;
  visitAt?: string;
  chiefComplaint?: string;
  reason?: string;
  symptoms?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlanText?: string;
  treatmentPerformed?: string;
  toothNumbers?: number[];
  procedures?: string;
  anesthesia?: string;
  medicationsText?: string;
  advice?: string;
  referral?: string;
  followUpDate?: string | null;
  notes?: string;
}

function map(r: Record<string, unknown>): VisitRow {
  let teeth: number[] = [];
  try {
    teeth = JSON.parse((r.tooth_numbers as string) || '[]') as number[];
  } catch {
    teeth = [];
  }
  return {
    id: r.id as number,
    number: r.number as string,
    patientId: r.patient_id as number,
    patientCode: (r.p_code as string) ?? '',
    patientName: (r.p_name as string) ?? '',
    dentistId: (r.dentist_id as number) ?? null,
    dentistName: (r.d_name as string) ?? '',
    appointmentId: (r.appointment_id as number) ?? null,
    visitAt: r.visit_at as string,
    chiefComplaint: (r.chief_complaint as string) ?? '',
    reason: (r.reason as string) ?? '',
    symptoms: (r.symptoms as string) ?? '',
    examination: (r.examination as string) ?? '',
    diagnosis: (r.diagnosis as string) ?? '',
    treatmentPlanText: (r.treatment_plan_text as string) ?? '',
    treatmentPerformed: (r.treatment_performed as string) ?? '',
    toothNumbers: teeth,
    procedures: (r.procedures as string) ?? '',
    anesthesia: (r.anesthesia as string) ?? '',
    medicationsText: (r.medications_text as string) ?? '',
    advice: (r.advice as string) ?? '',
    referral: (r.referral as string) ?? '',
    followUpDate: (r.follow_up_date as string) ?? null,
    notes: (r.notes as string) ?? '',
    createdBy: (r.created_by as string) ?? '',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

const SELECT = `
SELECT v.*, p.code p_code, p.full_name p_name, d.name d_name
FROM visits v
JOIN patients p ON p.id = v.patient_id
LEFT JOIN dentists d ON d.id = v.dentist_id`;

function validate(input: VisitInput): void {
  if (input.visitAt && !isValidIso(input.visitAt)) throw new AppError(ERR.VALIDATION, 'Visit date/time is invalid.');
  if (input.followUpDate && !isValidLocalDate(input.followUpDate)) throw new AppError(ERR.VALIDATION, 'Follow-up date must be YYYY-MM-DD.');
  if (input.toothNumbers) {
    for (const t of input.toothNumbers) {
      if (!Number.isInteger(t) || t < 11 || t > 85) throw new AppError(ERR.VALIDATION, `Tooth number ${t} is not a valid FDI notation.`);
    }
  }
}

export class VisitService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private numbering: NumberingService
  ) {}

  get(id: number): VisitRow {
    const r = this.db.prepare(`${SELECT} WHERE v.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Visit not found.');
    return map(r);
  }

  /** Create a visit. All writes are transactional. */
  create(actor: string, input: VisitInput): VisitRow {
    validate(input);
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    const tx = this.db.transaction(() => {
      const number = this.numbering.next(NUMBER_KEYS.visit.key, NUMBER_KEYS.visit.prefix);
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO visits (number, patient_id, dentist_id, appointment_id, visit_at, chief_complaint, reason, symptoms,
             examination, diagnosis, treatment_plan_text, treatment_performed, tooth_numbers, procedures, anesthesia,
             medications_text, advice, referral, follow_up_date, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          number,
          input.patientId,
          input.dentistId ?? null,
          input.appointmentId ?? null,
          input.visitAt ?? now,
          input.chiefComplaint ?? '',
          input.reason ?? '',
          input.symptoms ?? '',
          input.examination ?? '',
          input.diagnosis ?? '',
          input.treatmentPlanText ?? '',
          input.treatmentPerformed ?? '',
          JSON.stringify(input.toothNumbers ?? []),
          input.procedures ?? '',
          input.anesthesia ?? '',
          input.medicationsText ?? '',
          input.advice ?? '',
          input.referral ?? '',
          input.followUpDate || null,
          input.notes ?? '',
          actor,
          now,
          now
        );
      const id = Number(res.lastInsertRowid);
      if (input.appointmentId != null) {
        this.db
          .prepare("UPDATE appointments SET converted_visit_id = ?, status = 'completed', updated_at = ? WHERE id = ?")
          .run(id, now, input.appointmentId);
      }
      this.audit.record(actor, 'visit.create', 'visits', id, { number });
      return id;
    });
    return this.get(tx.immediate());
  }

  update(actor: string, id: number, patch: VisitInput): VisitRow {
    validate(patch);
    const cur = this.get(id);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE visits SET dentist_id=?, visit_at=?, chief_complaint=?, reason=?, symptoms=?, examination=?, diagnosis=?,
             treatment_plan_text=?, treatment_performed=?, tooth_numbers=?, procedures=?, anesthesia=?, medications_text=?,
             advice=?, referral=?, follow_up_date=?, notes=?, updated_at=? WHERE id=?`
        )
        .run(
          patch.dentistId !== undefined ? patch.dentistId : cur.dentistId,
          patch.visitAt ?? cur.visitAt,
          patch.chiefComplaint ?? cur.chiefComplaint,
          patch.reason ?? cur.reason,
          patch.symptoms ?? cur.symptoms,
          patch.examination ?? cur.examination,
          patch.diagnosis ?? cur.diagnosis,
          patch.treatmentPlanText ?? cur.treatmentPlanText,
          patch.treatmentPerformed ?? cur.treatmentPerformed,
          JSON.stringify(patch.toothNumbers ?? cur.toothNumbers),
          patch.procedures ?? cur.procedures,
          patch.anesthesia ?? cur.anesthesia,
          patch.medicationsText ?? cur.medicationsText,
          patch.advice ?? cur.advice,
          patch.referral ?? cur.referral,
          patch.followUpDate !== undefined ? patch.followUpDate || null : cur.followUpDate,
          patch.notes ?? cur.notes,
          nowUtc(),
          id
        );
      this.audit.record(actor, 'visit.update', 'visits', id, { number: cur.number });
    });
    tx.immediate();
    return this.get(id);
  }

  listForPatient(patientId: number, page = 1, pageSize = 50): Page<VisitRow> {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM visits WHERE patient_id = ?').get(patientId) as { c: number }).c;
    const rows = this.db
      .prepare(`${SELECT} WHERE v.patient_id = ? ORDER BY v.visit_at DESC, v.id DESC LIMIT ? OFFSET ?`)
      .all(patientId, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { rows: rows.map(map), total, page, pageSize };
  }

  /** Follow-ups due on or before the given local date (drives notifications). */
  followUpsDue(day: string): VisitRow[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE v.follow_up_date IS NOT NULL AND v.follow_up_date <= ? ORDER BY v.follow_up_date ASC`)
      .all(day) as Record<string, unknown>[];
    return rows.map(map);
  }

  /**
   * Chronological clinical timeline for Patient 360 — merged visits,
   * prescriptions and appointments, sorted newest-first, fully paginated.
   * No source is capped: a patient's entire lifetime history is reachable
   * page by page (spec: no artificial record ceilings, no silent truncation).
   * The merge happens inside SQLite over the patient_id indexes, so cost
   * scales with the requested page, not with the lifetime history.
   */
  timeline(patientId: number, page = 1, pageSize = 60): Page<{ at: string; kind: string; refId: number; title: string; detail: string }> {
    const size = Math.min(Math.max(pageSize, 1), 500);
    const total =
      (this.db.prepare('SELECT COUNT(*) c FROM visits WHERE patient_id = ?').get(patientId) as { c: number }).c +
      (this.db.prepare('SELECT COUNT(*) c FROM prescriptions WHERE patient_id = ?').get(patientId) as { c: number }).c +
      (this.db.prepare('SELECT COUNT(*) c FROM appointments WHERE patient_id = ?').get(patientId) as { c: number }).c;
    const rows = this.db
      .prepare(
        `SELECT at, kind, refId, title, detail FROM (
           SELECT v.visit_at AS at, 'visit' AS kind, v.id AS refId,
                  'Visit ' || v.number AS title,
                  CASE WHEN v.chief_complaint <> '' THEN v.chief_complaint
                       WHEN v.diagnosis <> '' THEN v.diagnosis
                       ELSE v.treatment_performed END AS detail
           FROM visits v WHERE v.patient_id = ?
           UNION ALL
           SELECT r.prescribed_at, 'prescription', r.id, 'Prescription ' || r.number, ''
           FROM prescriptions r WHERE r.patient_id = ?
           UNION ALL
           SELECT a.start_at, 'appointment', a.id, 'Appointment ' || a.number, replace(a.status, '_', ' ')
           FROM appointments a WHERE a.patient_id = ?
         )
         ORDER BY at DESC, refId DESC
         LIMIT ? OFFSET ?`
      )
      .all(patientId, patientId, patientId, size, (page - 1) * size) as Array<{ at: string; kind: string; refId: number; title: string; detail: string }>;
    const pages = Math.max(1, Math.ceil(total / size));
    return { rows, total, page: Math.min(Math.max(page, 1), pages), pageSize: size };
  }
}
