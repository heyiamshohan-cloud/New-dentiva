/**
 * scale-test.ts — proves the app stays responsive at 1k → 100k patients.
 *
 * Usage:
 *   npx tsx scripts/scale-test.ts [patients] [visitsPerPatient]
 * Defaults: 10_000 patients, 3 visits each. Pass 100000 for the full run.
 *
 * Method: bulk-seed patients + a long-history patient (hundreds of visits,
 * invoices, payments) directly in batches inside one transaction each, then
 * run the REAL read paths (search, list paging, Patient 360 financials,
 * statement, chart, appointments range) and assert latency budgets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { AppContext } from '../src/main/context';

const N_PATIENTS = Number(process.argv[2] ?? 10_000);
const VISITS_EACH = Number(process.argv[3] ?? 3);
const NAMES = ['Rahim', 'Karim', 'Salma', 'Farhana', 'Jamal', 'Ayesha', 'Nusrat', 'Hasan', 'Rokeya', 'Tariq'];

interface Bench { label: string; ms: number }
const bench: Bench[] = [];

function time(label: string, fn: () => unknown, budgetMs: number): unknown {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  bench.push({ label, ms });
  const status = ms <= budgetMs ? 'OK  ' : 'FAIL';
  console.log(`  ${status} ${ms.toFixed(1).padStart(8)}ms  (budget ${budgetMs}ms)  ${label}`);
  if (ms > budgetMs) process.exitCode = 1;
  return out;
}

function main(): void {
  console.log(`scale test: ${N_PATIENTS.toLocaleString()} patients x ${VISITS_EACH} visits`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-scale-'));
  const ctx = new AppContext(root);
  try {
    ctx.services.users.create('setup', { username: 'admin', displayName: 'Admin', role: 'administrator', password: 'Str0ng#Admin' });
    const treatment = ctx.services.treatments.create('admin', { code: 'FILL', name: 'Composite filling', standardPrice: '2500' });

    // ── bulk seed ───────────────────────────────────────────────────────────
    const t0 = performance.now();
    const insP = ctx.current().prepare(
      `INSERT INTO patients (code, full_name, preferred_name, sex, dob, phone, alternate_phone, email, address, occupation, emergency_contact_name, emergency_contact_phone, referral_source, tags, custom_fields, medical_history, dental_history, allergies, current_medications, chronic_conditions, risk_info, notes, archived, created_at, updated_at)
       VALUES (?, ?, '', ?, ?, ?, '', '', '', '', '', '', '', '[]', '{}', '', '', '', '', '', '', '', 0, ?, ?)`
    );
    const insV = ctx.current().prepare(
      `INSERT INTO visits (number, patient_id, dentist_id, appointment_id, visit_at, chief_complaint, reason, symptoms, examination, diagnosis, treatment_plan_text, treatment_performed, tooth_numbers, procedures, anesthesia, medications_text, advice, referral, follow_up_date, notes, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 'scale visit', '', '', '', 'scale-test record', '', '', '[]', '', '', '', '', '', NULL, '', 'scale', ?, ?)`
    );
    const now = new Date().toISOString();
    const firstIds: number[] = [];
    ctx.current().transaction(() => {
      for (let i = 1; i <= N_PATIENTS; i++) {
        const code = `P-${String(i).padStart(7, '0')}`;
        const name = `${NAMES[i % NAMES.length]} Scale${i}`;
        const phone = `017${String(10_000_000 + (i % 90_000_000)).padStart(8, '0')}`;
        const info = insP.run(code, name, i % 2 ? 'male' : 'female', '1990-01-01', phone, now, now);
        const pid = Number(info.lastInsertRowid);
        if (i <= 3) firstIds.push(pid);
        for (let v = 0; v < VISITS_EACH; v++) insV.run(`V-S${i}-${v}`, pid, now, now, now);
      }
    })();
    console.log(`  seeded in ${(performance.now() - t0).toFixed(0)}ms`);

    // ── long-history patient: 400 visits, 200 invoices + payments ────────────
    const longp = ctx.services.patients.create('admin', { fullName: 'Long History', sex: 'female', phone: '01700000001', dob: '1975-05-05' });
    ctx.current().transaction(() => {
      for (let i = 0; i < 400; i++) insV.run(`V-L-${i}`, longp.id, now, now, now);
    })();
    ctx.current().transaction(() => {
      for (let i = 0; i < 200; i++) {
        const inv = ctx.services.billing.createInvoice('admin', {
          patientId: longp.id,
          items: [{ treatmentId: treatment.id, description: 'Composite filling', qty: 1, unitPrice: '2500' }],
          saveAsDraft: true
        });
        ctx.services.billing.issueDraft('admin', inv.id);
        ctx.services.billing.recordPayment('admin', { patientId: longp.id, invoiceId: inv.id, amount: '2500', method: 'Cash' });
      }
    })();
    console.log('  long-history patient seeded (400 visits, 200 settled invoices)');

    // ── read-path latency budgets ────────────────────────────────────────────
    time('patients.search paged (50/page)', () => ctx.services.patients.search({ text: 'Scale', page: 1, pageSize: 50 }), 250);
    time('patients.select typeahead', () => ctx.services.patients.select('Farhana Scale5', 20), 150);
    time('patient 360 financials (long history)', () => ctx.services.billing.patientFinancials(longp.id), 500);
    time('statement.lifetime (long history)', () => ctx.services.statements.lifetime(longp.id), 800);
    time('visits.timeline (long history)', () => ctx.services.visits.timeline(longp.id), 400);
    time('visits.listForPatient paged', () => ctx.services.visits.listForPatient(longp.id, 1, 50), 250);
    time('billing.listPayments paged', () => ctx.services.billing.listPayments({ patientId: longp.id, page: 1, pageSize: 50 }), 250);
    time('billing.listInvoices paged', () => ctx.services.billing.listInvoices({ patientId: longp.id, page: 1, pageSize: 50 }), 250);
    time('appointments weekly range', () => ctx.services.appointments.listRange('2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z', { page: 1, pageSize: 50 }), 400);
    const fin = ctx.services.billing.patientFinancials(longp.id) as { totalBilled: number; totalPaid: number; totalDue: number };
    if (fin.totalBilled !== 200 * 250000 || fin.totalPaid !== fin.totalBilled || fin.totalDue !== 0) {
      console.error(`  FAIL financial rollup incorrect at scale: ${JSON.stringify(fin)}`);
      process.exitCode = 1;
    } else {
      console.log('  OK   financial rollup exact at scale (200 x 2500 BDT fully paid)');
    }

    const dbSize = fs.statSync(path.join(root, 'dentiva.db')).size;
    console.log(`\nsummary: ${N_PATIENTS.toLocaleString()} patients | db ${(dbSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`slowest: ${bench.reduce((a, b) => (b.ms > a.ms ? b : a)).label} (${Math.max(...bench.map((b) => b.ms)).toFixed(1)}ms)`);
  } finally {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (process.exitCode === 1) console.log('\nSCALE: budget(s) exceeded');
  else console.log('\nSCALE: all latency budgets met');
}

main();
