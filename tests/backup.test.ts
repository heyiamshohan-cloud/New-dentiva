import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';
import { makeCtx, seedBasic } from './helpers';
import { AppError, ERR } from '@shared/types';

/**
 * Backup/restore test matrix: fresh backup, backup with attachments,
 * corrupted/tampered archives, invalid metadata, restore with rollback,
 * post-restore integrity.
 */
describe('backup & restore', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('creates a backup with manifest + checksums and restores it exactly', async () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const inv = ctx.services.billing.createInvoice('t', { patientId, items: [{ description: 'Scaling', qty: 1, unitPrice: '1500' }] });
    ctx.services.billing.recordPayment('t', { patientId, invoiceId: inv.id, amount: '1500', method: 'Cash' });

    // attachment
    const srcFile = path.join(dir, 'xray.pdf');
    fs.writeFileSync(srcFile, Buffer.from('%PDF-1.4 fake body for testing'));
    const att = ctx.services.attachments.add('t', patientId, srcFile, { mime: 'application/pdf', title: 'Pre-op X-ray' });

    const backupDir = path.join(dir, 'out-backups');
    const backup = await ctx.backup.createBackup('t', backupDir);
    expect(fs.existsSync(backup.path)).toBe(true);
    expect(backup.counts.patients).toBe(1);
    expect(backup.counts.invoices).toBe(1);

    // inspect passes
    const inspect = await ctx.backup.inspectBackup(backup.path);
    expect(inspect.ok).toBe(true);

    // mutate live data AFTER backup
    const p2 = ctx.services.patients.create('t', { fullName: 'After Backup Person', phone: '01111111111' });
    expect(ctx.services.patients.count()).toBe(2);

    // restore → mutation gone, backup state back
    const restored = await ctx.backup.restoreBackup('t', backup.path);
    expect(restored.restoredCounts.patients).toBe(1);
    expect(ctx.services.patients.count()).toBe(1);
    expect(() => ctx.services.patients.getById(p2.id)).toThrow(AppError);
    expect(ctx.services.patients.getById(patientId).code).toBe('PT-000001');
    const attAfter = ctx.services.attachments.read(att.id);
    expect(attAfter.data.toString()).toContain('fake body');
    const diag = ctx.services.diagnostics.run();
    expect(diag.ok).toBe(true);
  });

  it('rejects corrupted archives (checksum mismatch)', async () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    seedBasic(ctx);
    const backup = await ctx.backup.createBackup('t', path.join(dir, 'b2'));

    // Rebuild archive with one corrupted byte in the DB but original manifest.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-corrupt-'));
    const extractZip = (await import('extract-zip')).default;
    await extractZip(backup.path, { dir: tmp });
    const dbPath = path.join(tmp, 'dentiva.db');
    const buf = fs.readFileSync(dbPath);
    buf[500] = buf[500] ^ 0xff;
    fs.writeFileSync(dbPath, buf);
    const corrupted = path.join(dir, 'corrupted.dvp');
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(corrupted);
      const arc = archiver('zip');
      out.on('close', () => resolve());
      arc.on('error', reject);
      arc.pipe(out);
      arc.directory(tmp, false);
      void arc.finalize();
    });

    const inspect = await ctx.backup.inspectBackup(corrupted);
    expect(inspect.ok).toBe(false);
    expect(inspect.problems.join(';')).toMatch(/Checksum mismatch/);

    // Restore must refuse and LEAVE CURRENT DATA INTACT.
    const before = ctx.services.patients.count();
    try {
      await ctx.backup.restoreBackup('t', corrupted);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(ERR.INTEGRITY);
    }
    expect(ctx.services.patients.count()).toBe(before); // no partial corruption
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects archives without a manifest and non-Dentiva archives', async () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    const fakeZip = path.join(dir, 'not-a-backup.dvp');
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(fakeZip);
      const arc = archiver('zip');
      out.on('close', () => resolve());
      arc.on('error', reject);
      arc.pipe(out);
      arc.append('hello', { name: 'random.txt' });
      void arc.finalize();
    });
    const inspect = await ctx.backup.inspectBackup(fakeZip);
    expect(inspect.ok).toBe(false);
    expect(inspect.problems.join(';')).toMatch(/manifest/i);
    await expect(ctx.backup.restoreBackup('t', fakeZip)).rejects.toThrow(/validation failed/i);
  });

  it('rejects nonexistent files cleanly', async () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const r = await ctx.backup.inspectBackup('/no/such/file.dvp');
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/does not exist/);
  });

  it('backup history is recorded', async () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    seedBasic(ctx);
    await ctx.backup.createBackup('t', path.join(dir, 'b3'));
    const history = ctx.backup.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(history[0].fileName).toMatch(/^dentiva-backup-.*\.dvp$/);
  });
});
