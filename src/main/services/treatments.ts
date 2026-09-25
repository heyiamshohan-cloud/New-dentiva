import type Database from 'better-sqlite3';
import { AppError, ERR, Paisa } from '@shared/types';
import { parseNonNegativeMoney, assertPaisa } from '../domain/money';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface TreatmentRow {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string;
  durationMin: number;
  standardPrice: Paisa;
  active: boolean;
  notes: string;
}

export interface TreatmentInput {
  code: string;
  name: string;
  category?: string;
  description?: string;
  durationMin?: number;
  standardPrice: string | number;
  active?: boolean;
  notes?: string;
}

function map(r: Record<string, unknown>): TreatmentRow {
  return {
    id: r.id as number,
    code: r.code as string,
    name: r.name as string,
    category: (r.category as string) ?? '',
    description: (r.description as string) ?? '',
    durationMin: r.duration_min as number,
    standardPrice: r.standard_price_paisa as number,
    active: !!r.active,
    notes: (r.notes as string) ?? ''
  };
}

function validate(input: TreatmentInput): Paisa {
  if (!input.code?.trim()) throw new AppError(ERR.VALIDATION, 'Treatment code is required.');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(input.code.trim())) throw new AppError(ERR.VALIDATION, 'Treatment code may contain letters, numbers, dash and underscore only.');
  if (!input.name?.trim()) throw new AppError(ERR.VALIDATION, 'Treatment name is required.');
  const price = parseNonNegativeMoney(input.standardPrice, 'standard price');
  assertPaisa(price);
  const dur = input.durationMin ?? 30;
  if (!Number.isInteger(dur) || dur < 5 || dur > 8 * 60) throw new AppError(ERR.VALIDATION, 'Duration must be between 5 minutes and 8 hours.');
  return price;
}

export class TreatmentService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  list(includeInactive = false): TreatmentRow[] {
    const sql = includeInactive ? 'SELECT * FROM treatments ORDER BY category, name' : 'SELECT * FROM treatments WHERE active = 1 ORDER BY category, name';
    return (this.db.prepare(sql).all() as Record<string, unknown>[]).map(map);
  }

  get(id: number): TreatmentRow {
    const r = this.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Treatment not found.');
    return map(r);
  }

  create(actor: string, input: TreatmentInput): TreatmentRow {
    const price = validate(input);
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO treatments (code, name, category, description, duration_min, standard_price_paisa, active, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.code.trim().toUpperCase(),
          input.name.trim(),
          input.category ?? '',
          input.description ?? '',
          input.durationMin ?? 30,
          price,
          (input.active ?? true) ? 1 : 0,
          input.notes ?? '',
          now,
          now
        );
      this.audit.record(actor, 'treatment.create', 'treatments', Number(res.lastInsertRowid), { code: input.code.trim().toUpperCase() });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  /**
   * Update catalog entry. Historical invoice lines already store their own
   * charged price snapshot, so billing history is never rewritten.
   */
  update(actor: string, id: number, patch: Partial<TreatmentInput>): TreatmentRow {
    const cur = this.get(id);
    const price = patch.standardPrice !== undefined ? parseNonNegativeMoney(patch.standardPrice, 'standard price') : cur.standardPrice;
    if (patch.code && !/^[A-Za-z0-9_-]{1,30}$/.test(patch.code.trim())) throw new AppError(ERR.VALIDATION, 'Treatment code may contain letters, numbers, dash and underscore only.');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE treatments SET code=?, name=?, category=?, description=?, duration_min=?, standard_price_paisa=?, active=?, notes=?, updated_at=? WHERE id=?`
        )
        .run(
          (patch.code ?? cur.code).trim().toUpperCase(),
          (patch.name ?? cur.name).trim(),
          patch.category ?? cur.category,
          patch.description ?? cur.description,
          patch.durationMin ?? cur.durationMin,
          price,
          (patch.active ?? cur.active) ? 1 : 0,
          patch.notes ?? cur.notes,
          nowUtc(),
          id
        );
      this.audit.record(actor, 'treatment.update', 'treatments', id, { code: cur.code });
    });
    tx.immediate();
    return this.get(id);
  }
}
