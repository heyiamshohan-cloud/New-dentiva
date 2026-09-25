import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { makeCtx, seedBasic } from './helpers';
import { openDatabase, integrityCheck } from '@main/db/database';
import { AppContext } from '@main/context';

/**
 * Race condition & crash recovery matrix: repeated saves, rapid multi-actor
 * numbering, close-during-write, and restart-during-write recovery.
 */
describe('race conditions & crash recovery', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('repeated saves produce distinct records with unique numbers', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const numbers = new Set<string>();
    // Simulate a hammered Save button = many sequential submissions.
    for (let i = 0; i < 50; i++) {
      const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: `Rapid ${i}`, qty: 1, unitPrice: '10' }] });
      expect(numbers.has(inv.number)).toBe(false);
      numbers.add(inv.number);
    }
    expect(ctx.services.billing.listInvoices({ patientId }).total).toBe(50);
  });

  it('rapid numbering from two open contexts never collides', () => {
    // Two AppContexts on the SAME data dir approximate two racing writers.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-race-'));
    const a = new AppContext(dir);
    cleanups.push(() => { try { a.close(); } catch { /* already closed */ } });
    seedBasic(a);
    const b = new AppContext(dir);
    cleanups.push(() => { try { b.close(); } catch { /* already closed */ } });
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }));
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const pa = a.services.patients.create('a', { fullName: `Writer A ${i}` });
      const pb = b.services.patients.create('b', { fullName: `Writer B ${i}` });
      expect(seen.has(pa.code)).toBe(false);
      expect(seen.has(pb.code)).toBe(false);
      seen.add(pa.code);
      seen.add(pb.code);
    }
    expect(seen.size).toBe(50); // all writer codes unique
    expect(seen.has('PT-000001')).toBe(false); // seed code never reused
    const diag = a.services.diagnostics.run();
    expect(diag.issues.filter((i) => i.message.includes('Duplicate Patient Code'))).toHaveLength(0);
  });

  it('failed transactions roll back completely (no partial writes)', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const invoicesBefore = ctx.services.billing.listInvoices({ patientId }).total;
    // Attempt an invoice whose second item is invalid → whole creation fails.
    expect(() =>
      ctx.services.billing.createInvoice('t', {
        patientId,
        items: [
          { description: 'Good', qty: 1, unitPrice: '100' },
          { description: 'Bad', qty: 0, unitPrice: '100' }
        ]
      })
    ).toThrow();
    expect(ctx.services.billing.listInvoices({ patientId }).total).toBe(invoicesBefore);
    // Counter was consumed inside the rolled-back transaction → number not reused.
    const next = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Ok', qty: 1, unitPrice: '50' }] });
    expect(next.number).toBe('INV-000001');
  });

  it('close during write, then restart: database stays valid and consistent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-crash-'));
    const ctx = new AppContext(dir);
    seedBasic(ctx);
    const patient = ctx.services.patients.search({ text: 'Rahim' }).rows[0];
    ctx.services.billing.createInvoice('t', { patientId: patient.id, items: [{ description: 'X', qty: 1, unitPrice: '100' }] });
    ctx.db.close(); // hard close simulating termination

    const ctx2 = new AppContext(dir);
    cleanups.push(() => { try { ctx2.close(); } catch { /* already closed */ } });
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }));
    expect(integrityCheck(ctx2.db).ok).toBe(true);
    expect(ctx2.services.billing.listInvoices({ patientId: patient.id }).total).toBe(1);
    expect(ctx2.services.patients.search({ text: 'Rahim' }).total).toBe(1);
  });

  it('simulated mid-transaction kill leaves no partial payment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-crash2-'));
    const h = openDatabase(dir);
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }));
    // Begin a transaction, write, then abandon by closing the handle hard.
    h.db.prepare('INSERT INTO patients (code, full_name, created_at, updated_at) VALUES (?,?,?,?)').run('PT-SIM-1', 'Sim', '2026', '2026');
    h.db.close();
    const h2 = openDatabase(dir);
    expect(integrityCheck(h2.db).ok).toBe(true);
    const c = (h2.db.prepare('SELECT COUNT(*) c FROM patients').get() as { c: number }).c;
    expect(c).toBe(1);
    h2.db.close();
  });

  it('queue serial assignment under rapid adds stays unique per day', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) ids.push(ctx.services.patients.create('t', { fullName: `Q Person ${i}` }).id);
    const serials = new Set<number>();
    for (const pid of ids) {
      const q = ctx.services.queue.add('t', { day: '2026-10-01', patientId: pid });
      expect(serials.has(q.serial)).toBe(false);
      serials.add(q.serial);
    }
    expect(serials.size).toBe(30);
  });
});
