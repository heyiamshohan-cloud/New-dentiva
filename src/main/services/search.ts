import type Database from 'better-sqlite3';

export interface GlobalSearchResult {
  kind: 'patient' | 'appointment' | 'visit' | 'prescription' | 'invoice' | 'payment' | 'treatment';
  id: number;
  ref: string;
  title: string;
  subtitle: string;
}

function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

/**
 * Global search across patients (code/name/phone), appointments, visits,
 * prescriptions, invoices and payments. Every match is reachable — the
 * per-kind LIMIT is a response-size bound, and each kind reports whether it
 * was truncated so callers can offer a filtered follow-up. Permissions are
 * enforced by the IPC layer routing results to permitted kinds.
 */
export class SearchService {
  constructor(private db: Database.Database) {}

  global(text: string, perKind = 8): { results: GlobalSearchResult[]; truncatedKinds: string[] } {
    const q = text.trim();
    if (q.length < 2) return { results: [], truncatedKinds: [] };
    const like = `%${escLike(q)}%`;
    const results: GlobalSearchResult[] = [];
    const truncatedKinds: string[] = [];
    const overFetch = perKind + 1;

    const push = (kind: GlobalSearchResult['kind'], rows: GlobalSearchResult[]) => {
      if (rows.length > perKind) {
        truncatedKinds.push(kind);
        results.push(...rows.slice(0, perKind));
      } else {
        results.push(...rows);
      }
    };

    push(
      'patient',
      (
        this.db
          .prepare(
            `SELECT id, code, full_name, phone FROM patients
             WHERE code LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR phone LIKE ? ESCAPE '\\'
             ORDER BY code LIMIT ?`
          )
          .all(like, like, like, overFetch) as Array<{ id: number; code: string; full_name: string; phone: string }>
      ).map((r) => ({ kind: 'patient', id: r.id, ref: r.code, title: r.full_name, subtitle: `${r.code} · ${r.phone}` }))
        .map((r) => ({ ...r, kind: 'patient' as const }))
    );

    push(
      'appointment',
      (
        this.db
          .prepare(
            `SELECT a.id, a.number, p.full_name, a.start_at FROM appointments a JOIN patients p ON p.id=a.patient_id
             WHERE a.number LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY a.start_at DESC LIMIT ?`
          )
          .all(like, like, overFetch) as Array<{ id: number; number: string; full_name: string; start_at: string }>
      ).map((r) => ({ kind: 'appointment' as const, id: r.id, ref: r.number, title: `Appointment ${r.number}`, subtitle: `${r.full_name} · ${r.start_at.slice(0, 16).replace('T', ' ')}` }))
    );

    push(
      'visit',
      (
        this.db
          .prepare(
            `SELECT v.id, v.number, p.full_name, v.visit_at FROM visits v JOIN patients p ON p.id=v.patient_id
             WHERE v.number LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR v.chief_complaint LIKE ? ESCAPE '\\' COLLATE NOCASE
             ORDER BY v.visit_at DESC LIMIT ?`
          )
          .all(like, like, like, overFetch) as Array<{ id: number; number: string; full_name: string; visit_at: string }>
      ).map((r) => ({ kind: 'visit' as const, id: r.id, ref: r.number, title: `Visit ${r.number}`, subtitle: r.full_name }))
    );

    push(
      'prescription',
      (
        this.db
          .prepare(
            `SELECT r.id, r.number, p.full_name FROM prescriptions r JOIN patients p ON p.id=r.patient_id
             WHERE r.number LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY r.id DESC LIMIT ?`
          )
          .all(like, like, overFetch) as Array<{ id: number; number: string; full_name: string }>
      ).map((r) => ({ kind: 'prescription' as const, id: r.id, ref: r.number, title: `Prescription ${r.number}`, subtitle: r.full_name }))
    );

    push(
      'invoice',
      (
        this.db
          .prepare(
            `SELECT i.id, i.number, p.full_name FROM invoices i JOIN patients p ON p.id=i.patient_id
             WHERE i.number LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY i.id DESC LIMIT ?`
          )
          .all(like, like, like, overFetch) as Array<{ id: number; number: string; full_name: string }>
      ).map((r) => ({ kind: 'invoice' as const, id: r.id, ref: r.number, title: `Invoice ${r.number}`, subtitle: r.full_name }))
    );

    push(
      'payment',
      (
        this.db
          .prepare(
            `SELECT y.id, y.receipt_no, p.full_name FROM payments y JOIN patients p ON p.id=y.patient_id
             WHERE y.receipt_no LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY y.id DESC LIMIT ?`
          )
          .all(like, like, overFetch) as Array<{ id: number; receipt_no: string; full_name: string }>
      ).map((r) => ({ kind: 'payment' as const, id: r.id, ref: r.receipt_no, title: `Receipt ${r.receipt_no}`, subtitle: r.full_name }))
    );

    push(
      'treatment',
      (
        this.db
          .prepare(
            `SELECT id, code, name, category FROM treatments
             WHERE code LIKE ? ESCAPE '\\' COLLATE NOCASE OR name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY name LIMIT ?`
          )
          .all(like, like, overFetch) as Array<{ id: number; code: string; name: string; category: string }>
      ).map((r) => ({ kind: 'treatment' as const, id: r.id, ref: r.code, title: r.name, subtitle: r.category }))
    );

    return { results, truncatedKinds };
  }
}
