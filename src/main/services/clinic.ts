import type Database from 'better-sqlite3';
import { AppError, ERR, ClinicProfile } from '@shared/types';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export class ClinicService {
  constructor(private db: Database.Database, private audit: AuditService) {
    // Clinic row is required bootstrap configuration (no demo data — empty values).
    const now = nowUtc();
    db.prepare(
      'INSERT OR IGNORE INTO clinic (id, name, updated_at) VALUES (1, ?, ?)'
    ).run('', now);
  }

  get(): ClinicProfile {
    const r = this.db.prepare('SELECT * FROM clinic WHERE id = 1').get() as Record<string, unknown>;
    return {
      id: 1,
      name: (r.name as string) ?? '',
      legalName: (r.legal_name as string) ?? '',
      address: (r.address as string) ?? '',
      phone: (r.phone as string) ?? '',
      email: (r.email as string) ?? '',
      website: (r.website as string) ?? '',
      registrationNo: (r.registration_no as string) ?? '',
      professionalInfo: (r.professional_info as string) ?? '',
      timezone: (r.timezone as string) || 'Asia/Dhaka',
      currencyCode: (r.currency_code as string) || 'BDT',
      currencySymbol: (r.currency_symbol as string) || '৳',
      dateFormat: (r.date_format as string) || 'DD MMM YYYY',
      documentHeaderNote: (r.document_header_note as string) ?? '',
      documentFooterNote: (r.document_footer_note as string) ?? '',
      logoPath: (r.logo_path as string) ?? null,
      updatedAt: r.updated_at as string
    };
  }

  update(actor: string, patch: Partial<Omit<ClinicProfile, 'id' | 'updatedAt'>>): ClinicProfile {
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
      throw new AppError(ERR.VALIDATION, 'Clinic email address is not valid.');
    }
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
      } catch {
        throw new AppError(ERR.VALIDATION, `Unknown timezone "${patch.timezone}".`);
      }
    }
    const fields: Record<string, string | null | undefined> = {
      name: patch.name,
      legal_name: patch.legalName,
      address: patch.address,
      phone: patch.phone,
      email: patch.email,
      website: patch.website,
      registration_no: patch.registrationNo,
      professional_info: patch.professionalInfo,
      timezone: patch.timezone,
      currency_code: patch.currencyCode,
      currency_symbol: patch.currencySymbol,
      date_format: patch.dateFormat,
      document_header_note: patch.documentHeaderNote,
      document_footer_note: patch.documentFooterNote,
      logo_path: patch.logoPath
    };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        args.push(val);
      }
    }
    if (sets.length === 0) return this.get();
    const tx = this.db.transaction(() => {
      sets.push('updated_at = ?');
      args.push(nowUtc());
      this.db.prepare(`UPDATE clinic SET ${sets.join(', ')} WHERE id = 1`).run(...args);
      this.audit.record(actor, 'clinic.update', 'clinic', 1, patch as Record<string, unknown>);
    });
    tx.immediate();
    return this.get();
  }
}
