import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppContext } from '@main/context';

/**
 * Scale smoke test: 10,000 patients with realistic related records.
 * (25k/50k/100k runs use scripts/scale-test.ts — same code path, heavier
 * seeds; kept out of the default suite to keep CI fast.) Measures actual
 * timings and asserts generous sanity bounds; numbers reported to stdout.
 */
const PATIENTS = Number(process.env.DENTIVA_SCALE ?? 10_000);

describe('large dataset performance (10k patients)', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('seeds 10k + related rows and stays responsive', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-perf-'));
    const ctx = new AppContext(dir);
    cleanups.push(() => { try { ctx.close(); } catch { /* already closed */ } });
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }));

    const t0 = performance.now();
    // Bulk seed using direct prepared statements for speed of GENERATION only.
    const insertPatient = ctx.db.prepare(
      `INSERT INTO patients (code, full_name, sex, dob, phone, email, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertVisit = ctx.db.prepare(
      `INSERT INTO visits (number, patient_id, visit_at, chief_complaint, diagnosis, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'seeder', ?, ?)`
    );
    const insertInv = ctx.db.prepare(
      `INSERT INTO invoices (number, patient_id, issued_at, status, total_paisa, subtotal_paisa, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'issued', ?, ?, 'seeder', ?, ?)`
    );
    const insertPay = ctx.db.prepare(
      `INSERT INTO payments (receipt_no, patient_id, invoice_id, amount_paisa, method, received_by, paid_at, created_at)
       VALUES (?, ?, ?, ?, 'Cash', 'seeder', ?, ?)`
    );
    const seed = ctx.db.transaction(() => {
      for (let i = 1; i <= PATIENTS; i++) {
        const code = `PT-${String(i).padStart(6, '0')}`;
        const res = insertPatient.run(
          code, `Scale Person ${i} Surname${i % 97}`, i % 2 ? 'male' : 'female',
          `19${60 + (i % 40)}-0${1 + (i % 9)}-1${i % 9}`, `017${String(10000000 + i)}`,
          i % 5 ? '' : `person${i}@example.com`, 'Dhaka', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        );
        const pid = Number(res.lastInsertRowid);
        // 2 visits, 1 invoice+payment for every 3rd patient
        insertVisit.run(`VST-${i}-A`, pid, '2026-02-01T10:00:00Z', 'Pain On', 'Gingivitis', '2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z');
        insertVisit.run(`VST-${i}-B`, pid, '2026-03-01T10:00:00Z', 'Sensitivity', 'Caries', '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z');
        if (i % 3 === 0) {
          const inv = insertInv.run(`INV-S${i}`, pid, '2026-02-15T11:00:00Z', 150000, 150000, '2026-02-15T11:00:00Z', '2026-02-15T11:00:00Z');
          insertPay.run(`RCP-S${i}`, pid, Number(inv.lastInsertRowid), 150000, '2026-02-15T11:05:00Z', '2026-02-15T11:05:00Z');
        }
      }
    });
    seed();
    ctx.db.prepare("UPDATE counters SET value = ? WHERE key = 'patient'").run(PATIENTS);
    const seedMs = performance.now() - t0;

    const dbSize = fs.statSync(path.join(dir, 'dentiva.db')).size;

    // Measure key queries.
    const measure = <T>(name: string, fn: () => T): { ms: number; result: T } => {
      const s = performance.now();
      const result = fn();
      return { ms: performance.now() - s, result };
    };

    const m1 = measure('search substring', () => ctx.services.patients.search({ text: 'Surname42', page: 1, pageSize: 50 }));
    const m2 = measure('directory page', () => ctx.services.patients.search({ text: '', page: 100, pageSize: 50 }));
    const m3 = measure('patient code lookup', () => ctx.services.patients.getByCode('PT-003333'));
    const targetPid = m3.result!.id;
    const m4 = measure('Patient 360 summary', () => {
      ctx.services.visits.listForPatient(targetPid);
      ctx.services.billing.patientFinancials(targetPid);
      ctx.services.visits.timeline(targetPid);
    });
    const m5 = measure('statement', () => ctx.services.statements.lifetime(targetPid));
    const m6 = measure('dashboard overview', () => ctx.services.dashboard.overview());
    const m7 = measure('global search', () => ctx.services.search.global('5000'));
    const m8 = measure('outstanding report', () => ctx.services.reports.run('outstanding', {}));

    const backupMs = (() => {
      const s = performance.now();
      return ctx.backup.createBackup('perf', path.join(dir, 'b')).then(() => performance.now() - s);
    })();

    const backupTime = await backupMs;

    console.log('\n===== SCALE RESULTS =====');
    console.log(`patients: ${PATIENTS}, db size: ${(dbSize / 1e6).toFixed(1)} MB, seed: ${seedMs.toFixed(0)} ms`);
    console.log(`search: ${m1.ms.toFixed(1)} ms (${m1.result.total} matches), page100: ${m2.ms.toFixed(1)} ms, code lookup: ${m3.ms.toFixed(2)} ms`);
    console.log(`Patient360: ${m4.ms.toFixed(1)} ms, statement: ${m5.ms.toFixed(1)} ms (${m5.result.rows.length} rows), dashboard: ${m6.ms.toFixed(1)} ms`);
    console.log(`global search: ${m7.ms.toFixed(1)} ms, outstanding report: ${m8.ms.toFixed(1)} ms (${m8.result.rows.length} rows), backup: ${backupTime.toFixed(0)} ms`);
    console.log('=========================\n');

    // Sanity bounds — generous on CI, tight enough to catch regressions.
    expect(m1.result.total).toBeGreaterThan(0);
    expect(m1.ms).toBeLessThan(2000);
    expect(m2.ms).toBeLessThan(1000);
    expect(m3.ms).toBeLessThan(200);
    expect(m4.ms).toBeLessThan(1500);
    expect(m5.ms).toBeLessThan(1500);
    expect(m6.ms).toBeLessThan(3000);
    expect(m8.ms).toBeLessThan(5000);
  }, 120000);
});
