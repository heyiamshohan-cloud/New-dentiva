import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx } from './helpers';
import { AppError, ERR } from '@shared/types';

describe('patients', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('assigns stable, unique, human-readable Patient Codes', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const a = ctx.services.patients.create('t', { fullName: 'Alpha One' });
    const b = ctx.services.patients.create('t', { fullName: 'Beta Two' });
    expect(a.code).toBe('PT-000001');
    expect(b.code).toBe('PT-000002');
    // Codes persist across reopen.
    ctx.close();
    ctx.reopen();
    expect(ctx.services.patients.getById(a.id).code).toBe('PT-000001');
    // Counter continues — never collides.
    const c = ctx.services.patients.create('t', { fullName: 'Gamma Three' });
    expect(c.code).toBe('PT-000003');
  });

  it('validates input (name, dob, email, phone, sex)', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    expect(() => ctx.services.patients.create('t', { fullName: '' })).toThrow(AppError);
    expect(() => ctx.services.patients.create('t', { fullName: 'X', dob: '2999-01-01' })).toThrow(/future/);
    expect(() => ctx.services.patients.create('t', { fullName: 'X', email: 'not-an-email' })).toThrow(/Email/);
    expect(() => ctx.services.patients.create('t', { fullName: 'X', sex: 'alien' as never })).toThrow(/Sex/);
  });

  it('detects duplicates by phone and by name+dob; never auto-merges', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    ctx.services.patients.create('t', { fullName: 'Karim Hossain', phone: '01712345678', dob: '1990-05-05' });
    const dupes = ctx.services.patients.findDuplicates({ fullName: 'Karim H', phone: '01712345678' });
    expect(dupes.length).toBe(1);
    expect(dupes[0].reasons.join(' ')).toMatch(/phone/);
    // create() blocks on duplicates…
    try {
      ctx.services.patients.create('t', { fullName: 'Karim H', phone: '01712345678' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(ERR.CONFLICT);
    }
    // …until the user explicitly confirms.
    const created = ctx.services.patients.create('t', { fullName: 'Karim H', phone: '01712345678' }, { skipDuplicateCheck: true });
    expect(created.code).toMatch(/^PT-/);
    expect(ctx.services.patients.count()).toBe(2); // both kept — no silent merge
  });

  it('search covers the full dataset with pagination totals', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    for (let i = 0; i < 120; i++) {
      ctx.services.patients.create('t', { fullName: `Person Number${i} Surname`, phone: `0171000${String(i).padStart(4, '0')}` });
    }
    const all = ctx.services.patients.search({ text: 'person', page: 1, pageSize: 50 });
    expect(all.total).toBe(120);
    const page3 = ctx.services.patients.search({ text: 'person', page: 3, pageSize: 50 });
    expect(page3.rows.length).toBe(20);
    const byCode = ctx.services.patients.search({ text: 'PT-000099' });
    expect(byCode.total).toBe(1);
    const byPhone = ctx.services.patients.search({ text: '01710000055' });
    expect(byPhone.total).toBe(1);
  });

  it('archive/restore keeps the record and code intact', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const p = ctx.services.patients.create('t', { fullName: 'Arch Me' });
    ctx.services.patients.setArchived('t', p.id, true);
    expect(ctx.services.patients.search({ text: 'Arch Me' }).total).toBe(0);
    expect(ctx.services.patients.search({ text: 'Arch Me', includeArchived: true }).total).toBe(1);
    ctx.services.patients.setArchived('t', p.id, false);
    expect(ctx.services.patients.search({ text: 'Arch Me' }).total).toBe(1);
  });

  it('edge cases: duplicate names, long names, unicode, missing optional data', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const a = ctx.services.patients.create('t', { fullName: 'Mohammad Ali' });
    const b = ctx.services.patients.create('t', { fullName: 'Mohammad Ali' }); // same name, no phone/dob → allowed
    expect(a.id).not.toBe(b.id);
    const long = 'N'.repeat(200);
    expect(ctx.services.patients.create('t', { fullName: long }).fullName).toBe(long);
    expect(() => ctx.services.patients.create('t', { fullName: 'N'.repeat(201) })).toThrow(/too long/);
    const uni = ctx.services.patients.create('t', { fullName: "O'Neill-Sørensen 中村", notes: 'allergies: penicillin — 注意' });
    expect(ctx.services.patients.getById(uni.id).fullName).toContain('中村');
    const minimal = ctx.services.patients.create('t', { fullName: 'Just Name' });
    expect(minimal.dob).toBeNull();
    expect(minimal.age).toBeNull();
  });
});
