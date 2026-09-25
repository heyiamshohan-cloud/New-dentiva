import type Database from 'better-sqlite3';
import { AppError, ERR, Role } from '@shared/types';
import { hashPassword } from '../security/passwords';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface UserRow {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

function map(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as number,
    username: row.username as string,
    displayName: row.display_name as string,
    role: row.role as Role,
    active: !!row.active,
    lastLoginAt: (row.last_login_at as string) ?? null
  };
}

export class UserService {
  constructor(private db: Database.Database, private audit: AuditService) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  }

  list(): UserRow[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY username').all() as Record<string, unknown>[]).map(map);
  }

  getByUsername(username: string): { id: number; username: string; display_name: string; role: Role; password_hash: string; active: number } | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as never;
  }

  create(actor: string, input: { username: string; displayName: string; role: Role; password: string }): UserRow {
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      throw new AppError(ERR.VALIDATION, 'Username must be 3–40 characters (letters, numbers, dot, dash, underscore).');
    }
    if (!input.displayName.trim()) throw new AppError(ERR.VALIDATION, 'Display name is required.');
    const validRoles: Role[] = ['administrator', 'dentist', 'assistant', 'receptionist', 'accountant'];
    if (!validRoles.includes(input.role)) throw new AppError(ERR.VALIDATION, 'Invalid role.');
    const tx = this.db.transaction(() => {
      const now = nowUtc();
      const res = this.db
        .prepare(
          `INSERT INTO users (username, display_name, role, password_hash, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(username, input.displayName.trim(), input.role, hashPassword(input.password), now, now);
      this.audit.record(actor, 'user.create', 'users', Number(res.lastInsertRowid), { username, role: input.role });
      return Number(res.lastInsertRowid);
    });
    return this.getById(tx.immediate());
  }

  getById(id: number): UserRow {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(ERR.NOT_FOUND, 'User not found.');
    return map(row);
  }

  update(actor: string, id: number, patch: { displayName?: string; role?: Role; active?: boolean }): UserRow {
    const existing = this.getById(id);
    const tx = this.db.transaction(() => {
      const role: Role = patch.role ?? existing.role;
      if (existing.role === 'administrator' && (patch.role !== undefined && patch.role !== 'administrator' || patch.active === false)) {
        const admins = (this.db.prepare("SELECT COUNT(*) c FROM users WHERE role='administrator' AND active=1").get() as { c: number }).c;
        if (admins <= 1) {
          throw new AppError(ERR.CONFLICT, 'The clinic must retain at least one active administrator account.');
        }
      }
      this.db
        .prepare('UPDATE users SET display_name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(patch.displayName?.trim() || existing.displayName, role, (patch.active ?? existing.active) ? 1 : 0, nowUtc(), id);
      this.audit.record(actor, 'user.update', 'users', id, patch as Record<string, unknown>);
    });
    tx.immediate();
    return this.getById(id);
  }

  changePassword(actor: string, userId: number, newPassword: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), nowUtc(), userId);
      this.audit.record(actor, 'user.password_change', 'users', userId);
    });
    tx.immediate();
  }

  touchLogin(userId: number): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowUtc(), userId);
  }
}
