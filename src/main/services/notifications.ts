import type Database from 'better-sqlite3';
import { NotificationItem } from '@shared/types';
import { nowUtc, todayLocal, addDays } from '../domain/datetime';

/**
 * Real notifications derived from actual data: today's appointments,
 * follow-ups due, low stock, expiring stock and backup status. Nothing is
 * fabricated — each notification can be traced to a persisted record.
 */
export class NotificationService {
  constructor(private db: Database.Database, private timezone: () => string) {}

  /** Recompute today's generated notifications (deduped by day+type+entity). */
  refresh(): void {
    const tz = this.timezone();
    const today = todayLocal(tz);
    const dayStart = `${today}T00:00:00.000Z`;
    const put = this.db.prepare(
      `INSERT INTO notifications (type, title, body, entity, entity_id, read, created_at)
       SELECT ?, ?, ?, ?, ?, 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.type = ? AND n.entity = ? AND (n.entity_id IS ? OR n.entity_id = ?) AND n.created_at >= ?
       )`
    );
    const now = nowUtc();
    const tx = this.db.transaction(() => {
      const appointments = this.db
        .prepare(
          `SELECT a.id, a.number, a.start_at, p.full_name FROM appointments a JOIN patients p ON p.id=a.patient_id
           WHERE a.start_at <= ? AND a.end_at >= ? AND a.status IN ('scheduled','confirmed')`
        )
        .all(`${today}T23:59:59.999Z`, dayStart) as Array<{ id: number; number: string; start_at: string; full_name: string }>;
      for (const a of appointments) {
        put.run('appointment.today', `Appointment ${a.number} today`, `${a.full_name} — scheduled today`, 'appointments', a.id, now, 'appointment.today', 'appointments', a.id, a.id, dayStart);
      }
      const followUps = this.db
        .prepare(
          `SELECT v.id, v.number, v.follow_up_date, p.full_name FROM visits v JOIN patients p ON p.id=v.patient_id
           WHERE v.follow_up_date IS NOT NULL AND v.follow_up_date <= ?`
        )
        .all(today) as Array<{ id: number; number: string; follow_up_date: string; full_name: string }>;
      for (const v of followUps) {
        put.run('followup.due', `Follow-up due: ${v.full_name}`, `Visit ${v.number} follow-up was due ${v.follow_up_date}`, 'visits', v.id, now, 'followup.due', 'visits', v.id, v.id, dayStart);
      }
      const lowStock = this.db
        .prepare('SELECT id, name, quantity, min_quantity, unit FROM inventory_items WHERE active = 1 AND min_quantity > 0 AND quantity <= min_quantity')
        .all() as Array<{ id: number; name: string; quantity: number; min_quantity: number; unit: string }>;
      for (const i of lowStock) {
        put.run('inventory.low_stock', `Low stock: ${i.name}`, `${i.quantity} ${i.unit} remaining (minimum ${i.min_quantity})`, 'inventory_items', i.id, now, 'inventory.low_stock', 'inventory_items', i.id, i.id, dayStart);
      }
      const expiring = this.db
        .prepare('SELECT id, name, expiry_date, batch FROM inventory_items WHERE active = 1 AND expiry_date IS NOT NULL AND expiry_date <= ?')
        .all(addDays(today, 30)) as Array<{ id: number; name: string; expiry_date: string; batch: string }>;
      for (const i of expiring) {
        put.run('inventory.expiry', `Expiry alert: ${i.name}`, `Batch ${i.batch || '-'} expires ${i.expiry_date}`, 'inventory_items', i.id, now, 'inventory.expiry', 'inventory_items', i.id, i.id, dayStart);
      }
      const lastBackup = this.db.prepare('SELECT MAX(created_at) m FROM backups').get() as { m: string | null };
      const backupReminderDays = 3;
      if (!lastBackup.m || lastBackup.m < `${addDays(today, -backupReminderDays)}T00:00:00.000Z`) {
        put.run('backup.reminder', 'Backup reminder', 'No backup has been completed in the last few days. Create a backup to protect clinic data.', 'backups', null, now, 'backup.reminder', 'backups', null, null, dayStart);
      }
    });
    tx.immediate();
  }

  list(unreadOnly = false, limit = 100): NotificationItem[] {
    const sql = unreadOnly
      ? 'SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM notifications ORDER BY id DESC LIMIT ?';
    const rows = this.db.prepare(sql).all(Math.min(limit, 500)) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      type: r.type as string,
      title: r.title as string,
      body: (r.body as string) ?? '',
      entity: (r.entity as string) ?? '',
      entityId: (r.entity_id as number) ?? null,
      read: !!r.read,
      createdAt: r.created_at as string
    }));
  }

  unreadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM notifications WHERE read = 0').get() as { c: number }).c;
  }

  markRead(id: number): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  }

  markAllRead(): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  }
}
