/**
 * perf.ts — quick latency snapshot of the hot read paths on a modest dataset
 * (2,000 patients with visits + financial history). Faster than scale-test;
 * intended for iterative tuning. Exits 1 if any hot path blows its budget.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { AppContext } from '../src/main/context';

function main(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-perf-'));
  const ctx = new AppContext(root);
  try {
    ctx.services.users.create('setup', { username: 'admin', displayName: 'Admin', role: 'administrator', password: 'Str0ng#Admin' });
    const t = ctx.services.treatments.create('admin', { code: 'EXM', name: 'Exam & consult', standardPrice: '500' });
    const now = new Date().toISOString();
    const insV = ctx.current().prepare(
      `INSERT INTO visits (number, patient_id, dentist_id, appointment_id, visit_at, chief_complaint, reason, symptoms, examination, diagnosis, treatment_plan_text, treatment_performed, tooth_numbers, procedures, anesthesia, medications_text, advice, referral, follow_up_date, notes, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 'scale visit', '', '', '', 'scale-test record', '', '', '[]', '', '', '', '', '', NULL, '', 'scale', ?, ?)`
    );

    const ids: number[] = [];
    ctx.current().transaction(() => {
      for (let i = 0; i < 2000; i++) {
        const p = ctx.services.patients.create('admin', { fullName: `Perf Patient${i}`, sex: i % 2 ? 'male' : 'female', phone: `016${String(i).padStart(8, '0')}`, dob: '1988-06-15' });
        ids.push(p.id);
        for (let v = 0; v < 5; v++) insV.run(`V-${i}-${v}`, p.id, now, now, now);
        if (i % 10 === 0) {
          const inv = ctx.services.billing.createInvoice('admin', {
            patientId: p.id,
            items: [{ treatmentId: t.id, description: 'Exam & consult', unitPrice: '500' }],
            saveAsDraft: true
          });
          ctx.services.billing.issueDraft('admin', inv.id);
          ctx.services.billing.recordPayment('admin', { patientId: p.id, invoiceId: inv.id, amount: '500', method: 'Cash' });
        }
      }
    })();

    const runs: Array<[string, number, () => unknown]> = [
      ['patients.search (paged)', 100, () => ctx.services.patients.search({ text: 'Patient', page: 1, pageSize: 50 })],
      ['patients.select (typeahead)', 60, () => ctx.services.patients.select('Patient1', 20)],
      ['patient financials', 60, () => ctx.services.billing.patientFinancials(ids[0] as number)],
      ['visits.listForPatient', 60, () => ctx.services.visits.listForPatient(ids[0] as number, 1, 50)],
      ['visits.timeline', 100, () => ctx.services.visits.timeline(ids[0] as number)],
      ['billing.listInvoices', 60, () => ctx.services.billing.listInvoices({ patientId: ids[0] as number, page: 1, pageSize: 50 })],
      ['billing.listPayments', 60, () => ctx.services.billing.listPayments({ patientId: ids[0] as number, page: 1, pageSize: 50 })],
      ['appointments.listRange', 150, () => ctx.services.appointments.listRange('2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z', { page: 1, pageSize: 50 })],
      ['dashboard metrics (reports.stats)', 300, () => ctx.current().prepare('SELECT COUNT(*) n FROM patients').get()]
    ];
    let failures = 0;
    for (const [label, budget, fn] of runs) {
      const t0 = performance.now();
      fn();
      const ms = performance.now() - t0;
      const okk = ms <= budget;
      if (!okk) failures++;
      console.log(`  ${okk ? 'OK  ' : 'FAIL'} ${ms.toFixed(1).padStart(7)}ms  (budget ${budget}ms)  ${label}`);
    }
    console.log(failures === 0 ? '\nPERF: all hot paths within budget' : `\nPERF: ${failures} path(s) over budget`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
