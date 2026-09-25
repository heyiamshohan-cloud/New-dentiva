import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { AppError, ERR } from '@shared/types';
import { AuditService } from './audit';
import { PatientService, PatientInput } from './patients';
import { ReportService, ReportKind } from './reports';

export interface ImportResult {
  inserted: number;
  skippedDuplicates: number;
  failed: Array<{ line: number; reason: string }>;
}

const CSV_HEADERS = [
  'fullName',
  'preferredName',
  'sex',
  'dob',
  'phone',
  'alternatePhone',
  'email',
  'address',
  'occupation',
  'allergies',
  'medicalHistory',
  'notes'
] as const;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV import/export for patients + full-fidelity report export.
 * Import validates every row, detects duplicates by phone, preserves
 * generated Patient Codes on the resulting records, reports per-row errors
 * and never silently truncates. Export always writes the complete match set.
 */
export class DataTransferService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private patients: PatientService,
    private reports: ReportService
  ) {}

  /**
   * Default policy: duplicate rows are SKIPPED and reported (never silently
   * merged, never silently re-registered). Pass `allowDuplicates` to force
   * insertion with explicit operator consent.
   */
  importPatientsCsv(actor: string, filePath: string, opts: { allowDuplicates?: boolean } = {}): ImportResult {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      throw new AppError(ERR.IO, 'The import file could not be read.');
    }
    if (!raw.trim()) throw new AppError(ERR.VALIDATION, 'The import file is empty.');
    // strip BOM
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const missing = CSV_HEADERS.slice(0, 1).filter((h) => !header.includes(h));
    if (missing.length) {
      throw new AppError(ERR.VALIDATION, `Missing required column(s): ${missing.join(', ')}. Expected header row: ${CSV_HEADERS.join(',')}`);
    }
    const idx = new Map(header.map((h, i) => [h, i]));
    const result: ImportResult = { inserted: 0, skippedDuplicates: 0, failed: [] };
    for (let lineNo = 1; lineNo < lines.length; lineNo++) {
      const cells = parseCsvLine(lines[lineNo]);
      const get = (name: string) => (idx.has(name) ? (cells[idx.get(name)!] ?? '').trim() : '');
      const input: PatientInput = {
        fullName: get('fullName'),
        preferredName: get('preferredName'),
        sex: (get('sex') || 'other').toLowerCase() as PatientInput['sex'],
        dob: get('dob') || null,
        phone: get('phone'),
        alternatePhone: get('alternatePhone'),
        email: get('email'),
        address: get('address'),
        occupation: get('occupation'),
        allergies: get('allergies'),
        medicalHistory: get('medicalHistory'),
        notes: get('notes')
      };
      try {
        this.patients.create(actor, input, { skipDuplicateCheck: !!opts.allowDuplicates });
        result.inserted++;
      } catch (e) {
        if (e instanceof AppError && e.code === ERR.CONFLICT) {
          result.skippedDuplicates++;
        } else {
          result.failed.push({ line: lineNo + 1, reason: (e as Error).message });
        }
      }
    }
    this.audit.record(actor, 'data.import_patients', 'patients', '', { file: filePath.split(/[\\/]/).pop(), ...result });
    return result;
  }

  /** Export a report as CSV — always the FULL match set. */
  exportReportCsv(actor: string, kind: ReportKind, filters: { from?: string; to?: string }, outPath: string): { rows: number } {
    const { columns, rows } = this.reports.run(kind, filters);
    const csv = [columns.map(csvEscape).join(','), ...rows.map((r) => (r as unknown[]).map(csvEscape).join(','))].join('\r\n');
    fs.writeFileSync(outPath, csv, 'utf8');
    this.audit.record(actor, 'data.export', 'reports', '', { kind, rows: rows.length });
    return { rows: rows.length };
  }

  exportPatientsCsv(actor: string, outPath: string, includeArchived = false): { rows: number } {
    const where = includeArchived ? '' : 'WHERE archived = 0';
    const rows = this.db
      .prepare(
        `SELECT full_name, preferred_name, sex, dob, phone, alternate_phone, email, address, occupation, allergies, medical_history, notes, code
         FROM patients ${where} ORDER BY code`
      )
      .all() as Record<string, unknown>[];
    const header = [...CSV_HEADERS, 'patientCode'].join(',');
    const body = rows.map((r) =>
      [
        r.full_name, r.preferred_name, r.sex, r.dob ?? '', r.phone, r.alternate_phone, r.email,
        r.address, r.occupation, r.allergies, r.medical_history, r.notes, r.code
      ].map(csvEscape).join(',')
    );
    fs.writeFileSync(outPath, [header, ...body].join('\r\n'), 'utf8');
    this.audit.record(actor, 'data.export', 'patients', '', { rows: rows.length });
    return { rows: rows.length };
  }
}
