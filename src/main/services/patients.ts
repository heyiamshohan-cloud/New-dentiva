import type Database from 'better-sqlite3';
import { AppError, DuplicateCandidate, ERR, Page, Patient, PatientSummary, Sex } from '@shared/types';
import { nowUtc, ageOn, todayLocal, isValidLocalDate } from '../domain/datetime';
import { AuditService } from './audit';
import { NumberingService, NUMBER_KEYS } from './counters';

export interface PatientInput {
  fullName: string;
  preferredName?: string;
  sex?: Sex;
  dob?: string | null;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  occupation?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  referralSource?: string;
  tags?: string[];
  customFields?: Record<string, string>;
  medicalHistory?: string;
  dentalHistory?: string;
  allergies?: string;
  currentMedications?: string;
  chronicConditions?: string;
  riskInfo?: string;
  notes?: string;
}

function mapSummary(r: Record<string, unknown>, tz: string): PatientSummary {
  const dob = (r.dob as string) ?? null;
  return {
    id: r.id as number,
    code: r.code as string,
    fullName: r.full_name as string,
    preferredName: (r.preferred_name as string) ?? '',
    sex: r.sex as Sex,
    dob,
    age: dob ? ageOn(dob, todayLocal(tz)) : null,
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    archived: !!r.archived,
    createdAt: r.created_at as string
  };
}

function mapFull(r: Record<string, unknown>, tz: string): Patient {
  return {
    ...mapSummary(r, tz),
    alternatePhone: (r.alternate_phone as string) ?? '',
    address: (r.address as string) ?? '',
    occupation: (r.occupation as string) ?? '',
    emergencyContactName: (r.emergency_contact_name as string) ?? '',
    emergencyContactPhone: (r.emergency_contact_phone as string) ?? '',
    referralSource: (r.referral_source as string) ?? '',
    tags: safeJson(r.tags as string, [] as string[]),
    customFields: safeJson(r.custom_fields as string, {} as Record<string, string>),
    medicalHistory: (r.medical_history as string) ?? '',
    dentalHistory: (r.dental_history as string) ?? '',
    allergies: (r.allergies as string) ?? '',
    currentMedications: (r.current_medications as string) ?? '',
    chronicConditions: (r.chronic_conditions as string) ?? '',
    riskInfo: (r.risk_info as string) ?? '',
    notes: (r.notes as string) ?? '',
    updatedAt: r.updated_at as string
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export function validatePatientInput(input: PatientInput): void {
  if (!input.fullName || !input.fullName.trim()) throw new AppError(ERR.VALIDATION, 'Patient full name is required.');
  if (input.fullName.trim().length > 200) throw new AppError(ERR.VALIDATION, 'Patient name is too long (max 200 characters).');
  if (input.sex && !['male', 'female', 'other'].includes(input.sex)) throw new AppError(ERR.VALIDATION, 'Sex must be male, female or other.');
  if (input.dob) {
    if (!isValidLocalDate(input.dob)) throw new AppError(ERR.VALIDATION, 'Date of birth must be a valid date (YYYY-MM-DD).');
    const tz = 'UTC';
    if (input.dob > todayLocal(tz)) throw new AppError(ERR.VALIDATION, 'Date of birth cannot be in the future.');
    if (input.dob < '1900-01-01') throw new AppError(ERR.VALIDATION, 'Date of birth is unreasonably far in the past.');
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new AppError(ERR.VALIDATION, 'Email address is not valid.');
  }
  if (input.phone && !/^[0-9+\-() ]{5,25}$/.test(input.phone)) {
    throw new AppError(ERR.VALIDATION, 'Phone number contains invalid characters.');
  }
}

export class PatientService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private numbering: NumberingService,
    private timezone: () => string
  ) {}

  getById(id: number): Patient {
    const r = this.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, `Patient with id ${id} was not found.`);
    return mapFull(r, this.timezone());
  }

  getByCode(code: string): Patient | null {
    const r = this.db.prepare('SELECT * FROM patients WHERE code = ?').get(code) as Record<string, unknown> | undefined;
    return r ? mapFull(r, this.timezone()) : null;
  }

  count(includeArchived = false): number {
    const sql = includeArchived ? 'SELECT COUNT(*) c FROM patients' : 'SELECT COUNT(*) c FROM patients WHERE archived = 0';
    return (this.db.prepare(sql).get() as { c: number }).c;
  }

  /**
   * Detect likely duplicates by phone, or same normalised name + date of birth.
   * Detection only warns — merging is never automatic.
   */
  findDuplicates(input: PatientInput, excludeId?: number): DuplicateCandidate[] {
    const found = new Map<number, { reasons: Set<string> }>();
    const phone = (input.phone ?? '').replace(/[^0-9+]/g, '');
    if (phone.length >= 7) {
      const rows = this.db
        .prepare("SELECT * FROM patients WHERE archived = 0 AND replace(replace(replace(phone,' ',''),'-',''),'(','') LIKE ?")
        .all(`%${escLike(phone.slice(-8))}%`) as Record<string, unknown>[];
      for (const r of rows) {
        if (excludeId && r.id === excludeId) continue;
        (found.get(r.id as number) ?? found.set(r.id as number, { reasons: new Set() }).get(r.id as number)!).reasons.add('same phone number');
      }
    }
    const name = (input.fullName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name.length >= 3) {
      const rows = this.db
        .prepare("SELECT * FROM patients WHERE archived = 0 AND lower(trim(full_name)) = ?")
        .all(name) as Record<string, unknown>[];
      for (const r of rows) {
        if (excludeId && r.id === excludeId) continue;
        const entry = found.get(r.id as number) ?? found.set(r.id as number, { reasons: new Set() }).get(r.id as number)!;
        entry.reasons.add('same name');
        if (input.dob && r.dob === input.dob) entry.reasons.add('same date of birth');
      }
    }
    const out: DuplicateCandidate[] = [];
    for (const [id, v] of found) {
      // Only surface strong-enough signals: phone match, or name+dob match.
      if (v.reasons.has('same phone number') || v.reasons.size >= 2) {
        const r = this.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<string, unknown>;
        out.push({ patient: mapSummary(r, this.timezone()), reasons: [...v.reasons] });
      }
    }
    return out;
  }

  /** Create a patient with a stable, unique Patient Code. */
  create(actor: string, input: PatientInput, opts: { skipDuplicateCheck?: boolean } = {}): Patient {
    validatePatientInput(input);
    if (!opts.skipDuplicateCheck) {
      const dupes = this.findDuplicates(input);
      if (dupes.length > 0) {
        throw new AppError(ERR.CONFLICT, 'Possible duplicate patient detected.', { duplicates: dupes });
      }
    }
    const tx = this.db.transaction(() => {
      const code = this.numbering.next(NUMBER_KEYS.patient.key, NUMBER_KEYS.patient.prefix);
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO patients (code, full_name, preferred_name, sex, dob, phone, alternate_phone, email, address,
             occupation, emergency_contact_name, emergency_contact_phone, referral_source, tags, custom_fields,
             medical_history, dental_history, allergies, current_medications, chronic_conditions, risk_info, notes,
             archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          code,
          input.fullName.trim(),
          input.preferredName?.trim() ?? '',
          input.sex ?? 'other',
          input.dob || null,
          input.phone?.trim() ?? '',
          input.alternatePhone?.trim() ?? '',
          input.email?.trim() ?? '',
          input.address ?? '',
          input.occupation ?? '',
          input.emergencyContactName ?? '',
          input.emergencyContactPhone ?? '',
          input.referralSource ?? '',
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.customFields ?? {}),
          input.medicalHistory ?? '',
          input.dentalHistory ?? '',
          input.allergies ?? '',
          input.currentMedications ?? '',
          input.chronicConditions ?? '',
          input.riskInfo ?? '',
          input.notes ?? '',
          now,
          now
        );
      this.audit.record(actor, 'patient.create', 'patients', Number(res.lastInsertRowid), { code });
      return Number(res.lastInsertRowid);
    });
    return this.getById(tx.immediate());
  }

  update(actor: string, id: number, patch: PatientInput): Patient {
    validatePatientInput(patch);
    this.getById(id);
    const tx = this.db.transaction(() => {
      const cur = this.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<string, unknown>;
      this.db
        .prepare(
          `UPDATE patients SET full_name=?, preferred_name=?, sex=?, dob=?, phone=?, alternate_phone=?, email=?, address=?,
             occupation=?, emergency_contact_name=?, emergency_contact_phone=?, referral_source=?, tags=?, custom_fields=?,
             medical_history=?, dental_history=?, allergies=?, current_medications=?, chronic_conditions=?, risk_info=?,
             notes=?, updated_at=? WHERE id=?`
        )
        .run(
          patch.fullName.trim(),
          patch.preferredName?.trim() ?? '',
          patch.sex ?? 'other',
          patch.dob || null,
          patch.phone?.trim() ?? '',
          patch.alternatePhone?.trim() ?? '',
          patch.email?.trim() ?? '',
          patch.address ?? '',
          patch.occupation ?? '',
          patch.emergencyContactName ?? '',
          patch.emergencyContactPhone ?? '',
          patch.referralSource ?? '',
          JSON.stringify(patch.tags ?? []),
          JSON.stringify(patch.customFields ?? safeJson(cur.custom_fields as string, {})),
          patch.medicalHistory ?? '',
          patch.dentalHistory ?? '',
          patch.allergies ?? '',
          patch.currentMedications ?? '',
          patch.chronicConditions ?? '',
          patch.riskInfo ?? '',
          patch.notes ?? '',
          nowUtc(),
          id
        );
      this.audit.record(actor, 'patient.update', 'patients', id, { code: cur.code });
    });
    tx.immediate();
    return this.getById(id);
  }

  setArchived(actor: string, id: number, archived: boolean): void {
    const p = this.getById(id);
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE patients SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, nowUtc(), id);
      this.audit.record(actor, archived ? 'patient.archive' : 'patient.restore', 'patients', id, { code: p.code });
    });
    tx.immediate();
  }

  /**
   * Paginated directory search across the full dataset. Search matches
   * Patient Code, name and phone. Sorting is stable and deterministic.
   * pageSize is capped high (500) but pagination never hides records —
   * `total` always reflects the complete match count.
   */
  search(query: {
    text?: string;
    includeArchived?: boolean;
    onlyArchived?: boolean;
    sex?: Sex;
    page?: number;
    pageSize?: number;
    sortBy?: 'code' | 'name' | 'created' | 'phone';
    sortDir?: 'asc' | 'desc';
  }): Page<PatientSummary> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (query.onlyArchived) where.push('archived = 1');
    else if (!query.includeArchived) where.push('archived = 0');
    if (query.sex) {
      where.push('sex = ?');
      args.push(query.sex);
    }
    const text = (query.text ?? '').trim();
    if (text) {
      const like = `%${escLike(text)}%`;
      where.push('(code LIKE ? ESCAPE \'\\\' OR full_name LIKE ? ESCAPE \'\\\' OR phone LIKE ? ESCAPE \'\\\' COLLATE NOCASE)');
      args.push(like, like, like);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM patients ${w}`).get(...args) as { c: number }).c;
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 500);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(query.page ?? 1, 1), pages);
    const sortCol =
      query.sortBy === 'name' ? 'full_name COLLATE NOCASE' : query.sortBy === 'phone' ? 'phone' : query.sortBy === 'created' ? 'created_at' : 'code';
    const dir = query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const rows = this.db
      .prepare(`SELECT * FROM patients ${w} ORDER BY ${sortCol} ${dir}, id ${dir} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    const tz = this.timezone();
    return { rows: rows.map((r) => mapSummary(r, tz)), total, page, pageSize };
  }

  /** Search-based selector for pickers — no arbitrary hard caps beyond a sane page. */
  select(text: string, limit = 50): PatientSummary[] {
    return this.search({ text, page: 1, pageSize: Math.min(limit, 200) }).rows;
  }
}
