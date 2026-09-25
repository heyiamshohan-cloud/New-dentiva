import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx } from './helpers';
import { AppError, ERR } from '@shared/types';
import { roleHas } from '@shared/permissions';
import { hashPassword, verifyPassword } from '@main/security/passwords';

describe('authentication, sessions, lock, RBAC', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('passwords: scrypt format, verify, never plaintext, strength enforced', () => {
    const h = hashPassword('CorrectHorse9');
    expect(h.startsWith('scrypt:16384:8:1:')).toBe(true);
    expect(h).not.toContain('CorrectHorse9');
    expect(verifyPassword('CorrectHorse9', h)).toBe(true);
    expect(verifyPassword('WrongPass1', h)).toBe(false);
    expect(() => hashPassword('short')).toThrow(/8 characters/);
    expect(() => hashPassword('onlyletters')).toThrow(/letters and numbers/);
    expect(() => hashPassword('12345678')).toThrow(/letters and numbers/);
  });

  it('login/logout/lock/unlock cycle with audit trail', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    ctx.services.users.create('test', { username: 'admin', displayName: 'Admin', role: 'administrator', password: 'Passw0rd!1' });
    // bad credentials
    try {
      ctx.services.auth.login('admin', 'nope');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.UNAUTHENTICATED);
    }
    // unknown user takes the same code path
    try {
      ctx.services.auth.login('ghost', 'nope');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.UNAUTHENTICATED);
    }
    const s = ctx.services.auth.login('admin', 'Passw0rd!1');
    expect(s.token.length).toBe(64);
    expect(ctx.session.requireActor(s.token).username).toBe('admin');

    ctx.services.auth.lock();
    try {
      ctx.session.requireActor(s.token);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.SESSION_LOCKED);
    }
    // unlock with wrong then right password
    expect(() => ctx.services.auth.unlock(s.token, 'bad bad bad')).toThrow(AppError);
    const s2 = ctx.services.auth.unlock(s.token, 'Passw0rd!1');
    expect(s2.locked).toBe(false);

    ctx.services.auth.logout();
    try {
      ctx.session.requireActor(s.token);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.UNAUTHENTICATED);
    }

    const audit = ctx.services.audit.list({ limit: 50 });
    const actions = (audit.rows as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain('auth.login_failed');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.lock');
    expect(actions).toContain('auth.unlock');
    expect(actions).toContain('auth.logout');
  });

  it('inactive accounts cannot log in', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const u = ctx.services.users.create('test', { username: 'rec1', displayName: 'Reception', role: 'receptionist', password: 'Recep123' });
    ctx.services.users.create('test', { username: 'admin', displayName: 'Admin', role: 'administrator', password: 'Admin123a' });
    ctx.services.users.update('admin', u.id, { active: false });
    try {
      ctx.services.auth.login('rec1', 'Recep123');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.FORBIDDEN);
    }
  });

  it('last-active-administrator protection', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const a = ctx.services.users.create('test', { username: 'admin', displayName: 'Admin', role: 'administrator', password: 'Admin123a' });
    expect(() => ctx.services.users.update('admin', a.id, { role: 'accountant' })).toThrow(/at least one active administrator/);
    expect(() => ctx.services.users.update('admin', a.id, { active: false })).toThrow(/at least one active administrator/);
  });

  it('RBAC matrix enforces explicitly defined permissions', () => {
    expect(roleHas('administrator', 'backup.restore')).toBe(true);
    expect(roleHas('administrator', 'users.manage')).toBe(true);
    expect(roleHas('dentist', 'prescriptions.create')).toBe(true);
    expect(roleHas('dentist', 'payments.create')).toBe(false);
    expect(roleHas('dentist', 'users.manage')).toBe(false);
    expect(roleHas('receptionist', 'payments.create')).toBe(true);
    expect(roleHas('receptionist', 'prescriptions.create')).toBe(false);
    expect(roleHas('receptionist', 'backup.restore')).toBe(false);
    expect(roleHas('accountant', 'payments.void')).toBe(true);
    expect(roleHas('accountant', 'visits.create')).toBe(false);
    expect(roleHas('assistant', 'patients.create')).toBe(false);
    expect(roleHas('assistant', 'queue.manage')).toBe(true);
    // every role has every permission either granted or denied — never undefined
    for (const role of ['administrator', 'dentist', 'assistant', 'receptionist', 'accountant'] as const) {
      expect(typeof roleHas(role, 'patients.read')).toBe('boolean');
    }
  });
});
