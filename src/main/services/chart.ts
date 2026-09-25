import type Database from 'better-sqlite3';
import { AppError, Dentition, ERR } from '@shared/types';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export const TOOTH_STATES = [
  'healthy',
  'caries',
  'filled',
  'crown',
  'root_canal',
  'missing',
  'impacted',
  'fractured',
  'implant',
  'bridge',
  'watch',
  'extract_planned'
] as const;
export type ToothState = (typeof TOOTH_STATES)[number];

/** FDI ranges: adult 11–48, primary 51–85. */
export function isValidFdi(n: number): 'adult' | 'primary' | null {
  if (!Number.isInteger(n)) return null;
  const q = Math.floor(n / 10);
  const u = n % 10;
  if (u < 1 || u > 8) return null;
  if (q >= 1 && q <= 4 && u <= 8) return 'adult';
  if (q >= 5 && q <= 8 && u <= 5) return 'primary';
  return null;
}

export function adultTeeth(): number[] {
  const out: number[] = [];
  for (const q of [1, 2, 3, 4]) for (let u = 1; u <= 8; u++) out.push(q * 10 + u);
  return out;
}

export function primaryTeeth(): number[] {
  const out: number[] = [];
  for (const q of [5, 6, 7, 8]) for (let u = 1; u <= 5; u++) out.push(q * 10 + u);
  return out;
}

export interface ToothRecord {
  toothFdi: number;
  dentition: Dentition;
  state: ToothState;
  notes: string;
  visitId: number | null;
  updatedAt: string;
}

export class ChartService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  getChart(patientId: number): ToothRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM tooth_records WHERE patient_id = ? ORDER BY tooth_fdi ASC')
      .all(patientId) as Record<string, unknown>[];
    return rows.map((r) => ({
      toothFdi: Number(r.tooth_fdi),
      dentition: r.dentition as Dentition,
      state: r.state as ToothState,
      notes: (r.notes as string) ?? '',
      visitId: (r.visit_id as number) ?? null,
      updatedAt: r.updated_at as string
    }));
  }

  setTooth(actor: string, patientId: number, toothFdi: number, state: string, notes = '', visitId: number | null = null): ToothRecord {
    const dentition = isValidFdi(toothFdi);
    if (!dentition) throw new AppError(ERR.VALIDATION, `Tooth ${toothFdi} is not a valid FDI number.`);
    if (!(TOOTH_STATES as readonly string[]).includes(state) && state !== '') {
      throw new AppError(ERR.VALIDATION, `Unknown tooth state "${state}".`);
    }
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    const tx = this.db.transaction(() => {
      if (state === '') {
        this.db.prepare('DELETE FROM tooth_records WHERE patient_id = ? AND tooth_fdi = ?').run(patientId, String(toothFdi));
      } else {
        this.db
          .prepare(
            `INSERT INTO tooth_records (patient_id, tooth_fdi, dentition, state, notes, visit_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(patient_id, tooth_fdi) DO UPDATE SET state = excluded.state, notes = excluded.notes,
               visit_id = excluded.visit_id, updated_at = excluded.updated_at`
          )
          .run(patientId, String(toothFdi), dentition, state, notes, visitId, nowUtc());
      }
      this.audit.record(actor, 'chart.update', 'tooth_records', `${patientId}:${toothFdi}`, { state });
    });
    tx.immediate();
    return { toothFdi, dentition, state: state as ToothState, notes, visitId, updatedAt: nowUtc() };
  }

  /** Multi-tooth update in one transaction (e.g. mark a quadrant). */
  setMany(actor: string, patientId: number, teeth: number[], state: string, notes = ''): void {
    const tx = this.db.transaction(() => {
      for (const t of teeth) this.setTooth(actor, patientId, t, state, notes);
    });
    tx.immediate();
  }
}
