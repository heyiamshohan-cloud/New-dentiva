import type Database from 'better-sqlite3';
import { AppError, ERR, Page } from '@shared/types';
import { nowUtc, isValidIso } from '../domain/datetime';
import { AuditService } from './audit';
import { NumberingService, NUMBER_KEYS } from './counters';

export interface RxItemRow {
  id?: number;
  medicineName: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string;
  timing: string;
  customInstructions: string;
  notes: string;
  sortOrder: number;
}

export interface PrescriptionRow {
  id: number;
  number: string;
  patientId: number;
  patientCode: string;
  patientName: string;
  dentistId: number | null;
  dentistName: string;
  dentistCredentials: string;
  visitId: number | null;
  prescribedAt: string;
  cc: string[];
  oe: string[];
  re: string;
  advice: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  items: RxItemRow[];
}

export interface PrescriptionInput {
  patientId: number;
  dentistId?: number | null;
  visitId?: number | null;
  prescribedAt?: string;
  cc?: string[];
  oe?: string[];
  re?: string;
  advice?: string;
  notes?: string;
  items: Array<Omit<RxItemRow, 'id' | 'sortOrder'>>;
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s) as string[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const SELECT = `
SELECT r.*, p.code p_code, p.full_name p_name, d.name d_name, d.credentials d_credentials
FROM prescriptions r
JOIN patients p ON p.id = r.patient_id
LEFT JOIN dentists d ON d.id = r.dentist_id`;

export class PrescriptionService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private numbering: NumberingService
  ) {}

  private loadItems(rxId: number): RxItemRow[] {
    const rows = this.db
      .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order ASC, id ASC')
      .all(rxId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      medicineName: r.medicine_name as string,
      form: (r.form as string) ?? 'tablet',
      dose: (r.dose as string) ?? '',
      frequency: (r.frequency as string) ?? '',
      duration: (r.duration as string) ?? '',
      timing: (r.timing as string) ?? '',
      customInstructions: (r.custom_instructions as string) ?? '',
      notes: (r.notes as string) ?? '',
      sortOrder: r.sort_order as number
    }));
  }

  private map(r: Record<string, unknown>): PrescriptionRow {
    return {
      id: r.id as number,
      number: r.number as string,
      patientId: r.patient_id as number,
      patientCode: (r.p_code as string) ?? '',
      patientName: (r.p_name as string) ?? '',
      dentistId: (r.dentist_id as number) ?? null,
      dentistName: (r.d_name as string) ?? '',
      dentistCredentials: (r.d_credentials as string) ?? '',
      visitId: (r.visit_id as number) ?? null,
      prescribedAt: r.prescribed_at as string,
      cc: safeArr((r.cc_json as string) ?? '[]'),
      oe: safeArr((r.oe_json as string) ?? '[]'),
      re: (r.re_text as string) ?? '',
      advice: (r.advice as string) ?? '',
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string,
      items: this.loadItems(r.id as number)
    };
  }

  get(id: number): PrescriptionRow {
    const r = this.db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Prescription not found.');
    return this.map(r);
  }

  /** A prescription carries strictly clinical data — never any money fields. */
  create(actor: string, input: PrescriptionInput): PrescriptionRow {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new AppError(ERR.VALIDATION, 'A prescription needs at least one medicine.');
    }
    input.items.forEach((it, i) => {
      if (!it.medicineName?.trim()) throw new AppError(ERR.VALIDATION, `Medicine ${i + 1} needs a name.`);
    });
    if (input.prescribedAt && !isValidIso(input.prescribedAt)) throw new AppError(ERR.VALIDATION, 'Prescription date is invalid.');
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(input.patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    const tx = this.db.transaction(() => {
      const number = this.numbering.next(NUMBER_KEYS.prescription.key, NUMBER_KEYS.prescription.prefix);
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO prescriptions (number, patient_id, dentist_id, visit_id, prescribed_at, cc_json, oe_json, re_text, advice, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          number,
          input.patientId,
          input.dentistId ?? null,
          input.visitId ?? null,
          input.prescribedAt ?? now,
          JSON.stringify(input.cc ?? []),
          JSON.stringify(input.oe ?? []),
          input.re ?? '',
          input.advice ?? '',
          input.notes ?? '',
          actor,
          now
        );
      const id = Number(res.lastInsertRowid);
      const stmt = this.db.prepare(
        `INSERT INTO prescription_items (prescription_id, medicine_name, form, dose, frequency, duration, timing, custom_instructions, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      input.items.forEach((it, i) => {
        stmt.run(
          id,
          it.medicineName.trim(),
          (it.form || 'tablet').toLowerCase(),
          it.dose ?? '',
          it.frequency ?? '',
          it.duration ?? '',
          it.timing ?? '',
          it.customInstructions ?? '',
          it.notes ?? '',
          i + 1
        );
      });
      this.audit.record(actor, 'prescription.create', 'prescriptions', id, { number });
      return id;
    });
    return this.get(tx.immediate());
  }

  listForPatient(patientId: number, page = 1, pageSize = 50): Page<PrescriptionRow> {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM prescriptions WHERE patient_id = ?').get(patientId) as { c: number }).c;
    const rows = this.db
      .prepare(`${SELECT} WHERE r.patient_id = ? ORDER BY r.prescribed_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .all(patientId, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return { rows: rows.map((r) => this.map(r)), total, page, pageSize };
  }
}
