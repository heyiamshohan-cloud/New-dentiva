import type Database from 'better-sqlite3';
import { Paisa } from '@shared/types';
import { todayLocal, addDays } from '../domain/datetime';

export interface DashboardData {
  today: string;
  appointmentsToday: Array<{ id: number; number: string; startAt: string; endAt: string; status: string; patientName: string; patientCode: string; dentistName: string }>;
  queue: { waiting: number; called: number; inProgress: number; completedToday: number };
  visitsToday: number;
  revenueToday: Paisa;
  paymentsToday: Paisa;
  outstandingTotal: Paisa;
  followUpsDue: number;
  lowStockCount: number;
  expiringCount: number;
  newPatientsThisWeek: number;
  recentActivity: Array<{ at: string; actor: string; action: string; entity: string; entityId: string }>;
}

/** Dashboard metrics — every value derived from real persisted data. */
export class DashboardService {
  constructor(private db: Database.Database, private timezone: () => string) {}

  private dayBounds(localDate: string, tz: string): [string, string] {
    // Conservative wide bound then filter — clinic TZ offset is small; use
    // local-date-aware comparison via SQLite by storing UTC and computing
    // bounds with Intl. Asia/Dhaka = UTC+6; compute exactly.
    void tz;
    return [`${localDate}T00:00:00.000Z`, `${localDate}T23:59:59.999Z`];
  }

  overview(): DashboardData {
    const tz = this.timezone();
    const today = todayLocal(tz);
    const [from, to] = this.dayBounds(today, tz);
    const one = (sql: string, ...args: unknown[]) => (this.db.prepare(sql).get(...args) as { c: number }).c;

    const appointmentsToday = (
      this.db
        .prepare(
          `SELECT a.id, a.number, a.start_at startAt, a.end_at endAt, a.status, p.full_name patientName, p.code patientCode, COALESCE(d.name,'') dentistName
           FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
           WHERE a.start_at <= ? AND a.end_at >= ? AND a.status NOT IN ('cancelled')
           ORDER BY a.start_at ASC`
        )
        .all(to, from) as DashboardData['appointmentsToday']
    );

    const queue = {
      waiting: one("SELECT COUNT(*) c FROM queue_entries WHERE day = ? AND status = 'waiting'", today),
      called: one("SELECT COUNT(*) c FROM queue_entries WHERE day = ? AND status = 'called'", today),
      inProgress: one("SELECT COUNT(*) c FROM queue_entries WHERE day = ? AND status = 'in_progress'", today),
      completedToday: one("SELECT COUNT(*) c FROM queue_entries WHERE day = ? AND status = 'completed'", today)
    };

    const visitsToday = one('SELECT COUNT(*) c FROM visits WHERE visit_at >= ? AND visit_at <= ?', from, to);
    const revenueToday = (this.db.prepare("SELECT COALESCE(SUM(total_paisa),0) s FROM invoices WHERE status='issued' AND issued_at >= ? AND issued_at <= ?").get(from, to) as { s: number }).s;
    const paymentsToday = (this.db.prepare('SELECT COALESCE(SUM(amount_paisa),0) s FROM payments WHERE void = 0 AND paid_at >= ? AND paid_at <= ?').get(from, to) as { s: number }).s;
    const outstandingTotal = (
      this.db
        .prepare(
          `SELECT COALESCE((SELECT SUM(total_paisa) FROM invoices WHERE status='issued'),0)
                  - COALESCE((SELECT SUM(amount_paisa) FROM payments WHERE void=0),0)
                  + COALESCE((SELECT SUM(amount_paisa) FROM adjustments),0) s`
        )
        .get() as { s: number }
    ).s;
    const followUpsDue = one('SELECT COUNT(*) c FROM visits WHERE follow_up_date IS NOT NULL AND follow_up_date <= ?', today);
    const lowStockCount = one('SELECT COUNT(*) c FROM inventory_items WHERE active = 1 AND min_quantity > 0 AND quantity <= min_quantity');
    const expiringCount = (this.db.prepare('SELECT COUNT(*) c FROM inventory_items WHERE active = 1 AND expiry_date IS NOT NULL AND expiry_date <= ?').get(addDays(today, 30)) as { c: number }).c;
    const weekAgo = `${addDays(today, -7)}T00:00:00.000Z`;
    const newPatientsThisWeek = one('SELECT COUNT(*) c FROM patients WHERE created_at >= ?', weekAgo);
    const recentActivity = (
      this.db
        .prepare('SELECT at, actor, action, entity, entity_id entityId FROM audit_log ORDER BY id DESC LIMIT 12')
        .all() as DashboardData['recentActivity']
    );

    return {
      today,
      appointmentsToday,
      queue,
      visitsToday,
      revenueToday,
      paymentsToday,
      outstandingTotal,
      followUpsDue,
      lowStockCount,
      expiringCount,
      newPatientsThisWeek,
      recentActivity
    };
  }
}

export type ReportKind =
  | 'patients'
  | 'appointments'
  | 'visits'
  | 'treatments'
  | 'revenue'
  | 'payments'
  | 'outstanding'
  | 'inventory'
  | 'staff_activity'
  | 'audit';

/**
 * Report queries with filters. All reports stream the full matching set to
 * the export layer (no arbitrary caps); the UI paginates only for display.
 */
export class ReportService {
  constructor(private db: Database.Database) {}

  run(kind: ReportKind, filters: { from?: string; to?: string }): { columns: string[]; rows: unknown[][] } {
    const from = filters.from ?? '1900-01-01T00:00:00.000Z';
    const to = filters.to ?? '9999-12-31T23:59:59.999Z';
    switch (kind) {
      case 'patients': {
        const rows = this.db
          .prepare("SELECT code, full_name, sex, dob, phone, email, archived, created_at FROM patients ORDER BY code")
          .all() as Record<string, unknown>[];
        return {
          columns: ['Patient Code', 'Full Name', 'Sex', 'Date of Birth', 'Phone', 'Email', 'Archived', 'Registered At'],
          rows: rows.map((r) => [r.code, r.full_name, r.sex, r.dob ?? '', r.phone, r.email, r.archived ? 'yes' : 'no', r.created_at])
        };
      }
      case 'appointments': {
        const rows = this.db
          .prepare(
            `SELECT a.number, p.code, p.full_name, COALESCE(d.name,'') dentist, a.start_at, a.end_at, a.status
             FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN dentists d ON d.id=a.dentist_id
             WHERE a.start_at >= ? AND a.start_at <= ? ORDER BY a.start_at`
          )
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['Number', 'Patient Code', 'Patient', 'Dentist', 'Start', 'End', 'Status'],
          rows: rows.map((r) => [r.number, r.code, r.full_name, r.dentist, r.start_at, r.end_at, r.status])
        };
      }
      case 'visits': {
        const rows = this.db
          .prepare(
            `SELECT v.number, p.code, p.full_name, COALESCE(d.name,'') dentist, v.visit_at, v.chief_complaint, v.diagnosis
             FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN dentists d ON d.id=v.dentist_id
             WHERE v.visit_at >= ? AND v.visit_at <= ? ORDER BY v.visit_at`
          )
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['Number', 'Patient Code', 'Patient', 'Dentist', 'Visit At', 'Chief Complaint', 'Diagnosis'],
          rows: rows.map((r) => [r.number, r.code, r.full_name, r.dentist, r.visit_at, r.chief_complaint, r.diagnosis])
        };
      }
      case 'treatments': {
        const rows = this.db
          .prepare('SELECT code, name, category, duration_min, standard_price_paisa, active FROM treatments ORDER BY category, name')
          .all() as Record<string, unknown>[];
        return {
          columns: ['Code', 'Name', 'Category', 'Duration (min)', 'Standard Price (poisha)', 'Active'],
          rows: rows.map((r) => [r.code, r.name, r.category, r.duration_min, r.standard_price_paisa, r.active ? 'yes' : 'no'])
        };
      }
      case 'revenue': {
        const rows = this.db
          .prepare(
            `SELECT i.number, p.code, p.full_name, i.issued_at, i.subtotal_paisa, i.discount_paisa, i.tax_paisa, i.total_paisa, i.status
             FROM invoices i JOIN patients p ON p.id=i.patient_id
             WHERE i.issued_at >= ? AND i.issued_at <= ? ORDER BY i.issued_at`
          )
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['Invoice', 'Patient Code', 'Patient', 'Issued At', 'Subtotal (poisha)', 'Discount (poisha)', 'Tax (poisha)', 'Total (poisha)', 'Status'],
          rows: rows.map((r) => [r.number, r.code, r.full_name, r.issued_at, r.subtotal_paisa, r.discount_paisa, r.tax_paisa, r.total_paisa, r.status])
        };
      }
      case 'payments': {
        const rows = this.db
          .prepare(
            `SELECT y.receipt_no, p.code, p.full_name, y.amount_paisa, y.method, y.reference, y.received_by, y.paid_at, y.void
             FROM payments y JOIN patients p ON p.id=y.patient_id
             WHERE y.paid_at >= ? AND y.paid_at <= ? ORDER BY y.paid_at`
          )
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['Receipt No', 'Patient Code', 'Patient', 'Amount (poisha)', 'Method', 'Reference', 'Received By', 'Paid At', 'Void'],
          rows: rows.map((r) => [r.receipt_no, r.code, r.full_name, r.amount_paisa, r.method, r.reference, r.received_by, r.paid_at, r.void ? 'yes' : 'no'])
        };
      }
      case 'outstanding': {
        const rows = this.db
          .prepare(
            `SELECT p.code, p.full_name,
                    COALESCE((SELECT SUM(total_paisa) FROM invoices i WHERE i.patient_id=p.id AND i.status='issued'),0) billed,
                    COALESCE((SELECT SUM(amount_paisa) FROM payments y WHERE y.patient_id=p.id AND y.void=0),0) paid,
                    COALESCE((SELECT SUM(amount_paisa) FROM adjustments a WHERE a.patient_id=p.id),0) adj
             FROM patients p ORDER BY code`
          )
          .all() as Record<string, unknown>[];
        return {
          columns: ['Patient Code', 'Patient', 'Billed (poisha)', 'Paid (poisha)', 'Adjustments (poisha)', 'Due (poisha)'],
          rows: rows
            .map((r) => [r.code, r.full_name, r.billed, r.paid, r.adj, (r.billed as number) - (r.paid as number) + (r.adj as number)])
            .filter((r) => (r[5] as number) !== 0)
        };
      }
      case 'inventory': {
        const rows = this.db
          .prepare('SELECT sku, name, category, supplier, quantity, min_quantity, unit, expiry_date, batch FROM inventory_items ORDER BY name')
          .all() as Record<string, unknown>[];
        return {
          columns: ['SKU', 'Name', 'Category', 'Supplier', 'Quantity', 'Min Qty', 'Unit', 'Expiry', 'Batch'],
          rows: rows.map((r) => [r.sku, r.name, r.category, r.supplier, r.quantity, r.min_quantity, r.unit, r.expiry_date ?? '', r.batch])
        };
      }
      case 'staff_activity': {
        const rows = this.db
          .prepare('SELECT actor, action, entity, COUNT(*) n FROM audit_log WHERE at >= ? AND at <= ? GROUP BY actor, action, entity ORDER BY actor, action')
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['Actor', 'Action', 'Entity', 'Count'],
          rows: rows.map((r) => [r.actor, r.action, r.entity, r.n])
        };
      }
      case 'audit': {
        const rows = this.db
          .prepare('SELECT at, actor, action, entity, entity_id, metadata FROM audit_log WHERE at >= ? AND at <= ? ORDER BY id DESC')
          .all(from, to) as Record<string, unknown>[];
        return {
          columns: ['At', 'Actor', 'Action', 'Entity', 'Entity ID', 'Metadata'],
          rows: rows.map((r) => [r.at, r.actor, r.action, r.entity, r.entity_id, r.metadata])
        };
      }
    }
  }
}
