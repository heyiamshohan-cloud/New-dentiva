/**
 * smoke.ts — end-to-end "one realistic clinic day" verification.
 *
 * Runs the full production workflow through the real service layer against a
 * throwaway data directory:
 *   setup → login → patients → appointment conflict → visit + chart →
 *   catalog → plan (never auto-invoices) → prescription (no financial data) →
 *   invoice → issue → payment (receipt only after persistence) → statement →
 *   inventory (negative stock refused) → attachment round-trip → backup →
 *   deliberate damage → restore → verification.
 *
 * Exits non-zero on the first failed invariant. Node-only: no Electron needed
 * (`npx tsx scripts/smoke.ts` / `node --import tsx scripts/smoke.ts`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppContext } from '../src/main/context';
import { AppError, ENTITY_TABLES, ERR } from '../src/shared/types';
import { roleHas } from '../src/shared/permissions';

let failed = 0;

function ok(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  PASS  ${name}`);
    })
    .catch((e) => {
      failed += 1;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${e instanceof Error ? e.message : String(e)}`);
    });
}

function eq<T>(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function expectThrow(fn: () => unknown, code: string, label: string): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError && e.code === code) return;
    throw new Error(`${label}: threw wrong error ${e instanceof Error ? `${e.message}` : String(e)}`);
  }
  throw new Error(`${label}: expected AppError(${code}), nothing was thrown`);
}

const sha256 = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-smoke-'));
  const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-smoke-restore-'));
  const actor = 'admin';
  console.log(`smoke data dir: ${root}`);

  const ctx = new AppContext(root);
  try {
    // ── Setup & auth ────────────────────────────────────────────────────────
    eq(ctx.services.users.count(), 0, 'fresh database starts empty');
    ctx.services.clinic.update('setup', { name: 'Smile Care Dental', phone: '+8801712345678', address: 'Tangail' });
    ctx.services.users.create('setup', { username: 'admin', displayName: 'Dr. Admin', role: 'administrator', password: 'Str0ng#Admin' });
    ctx.services.users.create(actor, { username: 'recep', displayName: 'Front Desk', role: 'receptionist', password: 'Str0ng#Recep' });
    ctx.services.settings.set('setupComplete', true);

    const session = ctx.services.auth.login('admin', 'Str0ng#Admin');
    if (!session.token) throw new Error('login did not return a session token');
    expectThrow(() => ctx.services.auth.login('admin', 'wrong-password'), ERR.UNAUTHENTICATED, 'wrong password rejected');
    await ok('auth: login works, bad password rejected', async () => {});

    ctx.services.auth.lock();
    eq(ctx.services.auth.status().locked, true, 'locked after lock()');
    ctx.services.auth.unlock(session.token, 'Str0ng#Admin');
    await ok('auth: lock/unlock cycle', async () => {});

    // RBAC is backend-enforced: receptionist must not hold admin permissions.
    eq(roleHas('receptionist', 'settings.update'), false, 'receptionist blocked from clinic settings');
    eq(roleHas('receptionist', 'patients.create'), true, 'receptionist can register patients');
    await ok('rbac: role/permission map enforced', async () => {});

    // ── Patients ────────────────────────────────────────────────────────────
    const p1 = ctx.services.patients.create(actor, {
      fullName: 'Rahim Uddin',
      sex: 'male',
      phone: '01711110000',
      dob: '1985-03-12',
      address: 'Tangail Sadar'
    });
    if (!p1.code) throw new Error('patient code missing');
    const code1 = p1.code;
    eq(ctx.services.patients.getById(p1.id).code, code1, 'patient code stable');
    const p2 = ctx.services.patients.create(actor, { fullName: 'Karima Begum', sex: 'female', phone: '01722220000', dob: '1990-01-01' });
    if (p2.code === code1) throw new Error('patient codes not unique');
    const dupes = ctx.services.patients.findDuplicates({ fullName: 'Rahim Uddin', phone: '01711110000' });
    if (dupes.length === 0) throw new Error('duplicate detection missed same name+phone');
    await ok('patients: unique stable codes, duplicate detection warns', async () => {});

    // ── Appointment conflict detection ──────────────────────────────────────
    const dentist = ctx.services.dentists.create(actor, { name: 'Dr. Farhana', credentials: 'BDS' });
    const startAt = new Date(Date.now() + 86_400_000);
    const startA = startAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const endA = new Date(startAt.getTime() + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    ctx.services.appointments.create(actor, { patientId: p1.id, dentistId: dentist.id, chair: '1', startAt: startA, durationMinutes: 30 });
    const conflicts = ctx.services.appointments.findConflicts(startA, endA, dentist.id, '1', '');
    if (conflicts.length === 0) throw new Error('overlapping appointment not detected');
    expectThrow(
      () => ctx.services.appointments.create(actor, { patientId: p2.id, dentistId: dentist.id, chair: '1', startAt: startA, durationMinutes: 30 }),
      ERR.CONFLICT,
      'overlapping appointment refused'
    );
    await ok('appointments: resource-aware conflict detection', async () => {});

    // ── Visit + FDI chart ───────────────────────────────────────────────────
    const visit = ctx.services.visits.create(actor, {
      patientId: p1.id,
      dentistId: dentist.id,
      chiefComplaint: 'Pain in upper right molar',
      examination: 'Caries on 16',
      diagnosis: 'Irreversible pulpitis 16',
      treatmentPerformed: 'Access opening, drainage',
      toothNumbers: [16],
      advice: 'Warm saline rinses'
    });
    ctx.services.chart.setTooth(actor, p1.id, 16, 'caries', 'occlusal', visit.id);
    const chart = ctx.services.chart.getChart(p1.id);
    if (!chart.find((t) => t.toothFdi === 16)) throw new Error('tooth 16 not recorded on chart');
    await ok('visits + chart: clinical encounter persisted', async () => {});

    // ── Catalog, plan (plans never auto-invoice) ────────────────────────────
    const rct = ctx.services.treatments.create(actor, { code: 'RCT1', name: 'Root canal (molar)', category: 'Endodontics', standardPrice: '12000' });
    ctx.services.plans.create(actor, {
      patientId: p1.id,
      title: 'RCT 16',
      diagnosis: 'Irreversible pulpitis',
      items: [{ treatmentId: rct.id, toothFdi: '16', unitPrice: '12000' }]
    });
    const invoiceCountAfterPlan = ctx.services.billing.listInvoices({ patientId: p1.id }).total;
    eq(invoiceCountAfterPlan, 0, 'plan must not create an invoice');
    await ok('plans: never auto-invoice', async () => {});

    // ── Prescription: clinical only, zero financials ────────────────────────
    const rx = ctx.services.prescriptions.create(actor, {
      patientId: p1.id,
      dentistId: dentist.id,
      visitId: visit.id,
      cc: ['Toothache'],
      oe: ['Tender on percussion 16'],
      re: 'X-ray recommended',
      advice: 'Start after meal',
      items: [
        { medicineName: 'Amoxicillin', form: 'capsule', dose: '500 mg', frequency: '1+1+1', duration: '7 days', timing: 'after food', customInstructions: '', notes: '' },
        { medicineName: 'Ibuprofen', form: 'tablet', dose: '400 mg', frequency: '1-0-1', duration: '5 days', timing: 'after food', customInstructions: 'Stop if stomach upset', notes: '' }
      ]
    });
    const rxLoaded = ctx.services.prescriptions.get(rx.id);
    eq(rxLoaded.items.length, 2, 'prescription items persisted');
    const rxJson = JSON.stringify(rxLoaded);
    for (const banned of ['amount', 'price', 'total', 'due', 'paid', 'invoice', 'payment']) {
      if (new RegExp(`"${banned}`, 'i').test(rxJson)) throw new Error(`prescription payload leaks financial field: ${banned}`);
    }
    await ok('prescriptions: multi-medicine, strictly financial-free payload', async () => {});

    // ── Billing: draft → issue → partial payment → receipt ─────────────────
    const inv = ctx.services.billing.createInvoice(actor, {
      patientId: p1.id,
      visitId: visit.id,
      items: [
        { treatmentId: rct.id, description: 'Root canal (molar) 16', toothFdi: '16', qty: 1, unitPrice: '12000' },
        { description: 'Consultation & exam', qty: 1, unitPrice: '500' }
      ],
      discount: '500',
      saveAsDraft: true
    });
    eq(inv.computed.status, 'draft', 'invoice starts as draft');
    const issued = ctx.services.billing.issueDraft(actor, inv.id);
    eq(issued.total, 1200000 + 50000 - 50000, 'integer paisa arithmetic: 12000+500-500 BDT');
    eq(issued.computed.status, 'issued', 'invoice issued');
    const { payment, remainingDue, duplicate } = ctx.services.billing.recordPayment(actor, {
      patientId: p1.id,
      invoiceId: issued.id,
      amount: '8000',
      method: 'Cash',
      clientRef: 'smoke-pos-1'
    });
    eq(duplicate, false, 'first payment is not a duplicate');
    if (!payment.receiptNo) throw new Error('receipt number missing after payment persistence');
    ctx.services.billing.getPayment(payment.id); // persisted → fetchable
    eq(remainingDue, issued.total - 800000, 'remaining due arithmetic');
    // Idempotency: replaying the same client reference must not double-charge.
    const replay = ctx.services.billing.recordPayment(actor, { patientId: p1.id, invoiceId: issued.id, amount: '8000', method: 'Cash', clientRef: 'smoke-pos-1' });
    eq(replay.duplicate, true, 'replay of clientRef is idempotent');
    eq(replay.payment.id, payment.id, 'replay returns original payment');
    const fin = ctx.services.billing.patientFinancials(p1.id);
    if (fin.totalBilled !== issued.total || fin.totalPaid !== 800000) throw new Error('patient 360 financials mismatch');
    const st = ctx.services.statements.lifetime(p1.id);
    if (!st) throw new Error('statement unavailable');
    await ok('billing: draft lifecycle, receipt after persistence, idempotent client refs, exact sums', async () => {});

    // ── Inventory: no invalid negative stock ────────────────────────────────
    const item = ctx.services.inventory.createItem(actor, { sku: 'GPA-4', name: 'Gutta percha #4', unit: 'box', openingQuantity: 10, minQuantity: 2 });
    ctx.services.inventory.recordMovement(actor, { itemId: item.id, type: 'stock_out', qty: 3, reference: `visit-${visit.id}` });
    eq(ctx.services.inventory.get(item.id).quantity, 7, 'stock after issue');
    expectThrow(() => ctx.services.inventory.recordMovement(actor, { itemId: item.id, type: 'stock_out', qty: 99 }), ERR.CONFLICT, 'negative stock refused');
    await ok('inventory: movements tracked, invalid negative stock refused', async () => {});

    // ── Attachments: content round-trip + integrity ─────────────────────────
    const srcFile = path.join(root, 'sample-xray.txt');
    const payload = Buffer.from('synthetic radiograph bytes for smoke test');
    fs.writeFileSync(srcFile, payload);
    const att = ctx.services.attachments.add(actor, p1.id, srcFile, { title: 'IOPA 16 note', mime: 'text/plain' });
    const round = ctx.services.attachments.read(att.id);
    eq(sha256(round.data), sha256(payload), 'attachment bytes round-trip intact');
    const verify = ctx.services.attachments.verifyAll();
    eq(verify.problems.length, 0, 'attachment integrity verified');
    await ok('attachments: verified byte-exact storage', async () => {});

    // ── Backup → damage → restore (no partial-corruption restore) ───────────
    const backup = await ctx.backup.createBackup(actor);
    const inspect = await ctx.backup.inspectBackup(backup.path);
    eq(inspect.ok, true, 'backup self-inspection passes checksums');
    const patientsBefore = ctx.services.patients.count();
    // Deliberate damage: wipe every business table, then restore.
    ctx.current().pragma('foreign_keys = OFF');
    for (const t of [...ENTITY_TABLES].reverse()) ctx.current().prepare(`DELETE FROM "${t}"`).run();
    ctx.current().pragma('foreign_keys = ON');
    eq(ctx.services.patients.count(), 0, 'damage applied');
    await ctx.backup.restoreBackup(actor, backup.path);
    eq(ctx.services.patients.count(), patientsBefore, 'restore recovers all patients');
    eq(ctx.services.patients.getByCode(code1)?.code, code1, 'patient codes survive restore');
    const finAfter = ctx.services.billing.patientFinancials(p1.id);
    if (finAfter.totalPaid !== 800000) throw new Error('financials lost across restore');
    const attAfter = ctx.services.attachments.read(att.id);
    eq(sha256(attAfter.data), sha256(payload), 'attachments survive restore');
    // Corrupt backup must be refused outright.
    const corrupt = path.join(root, 'corrupt.dentiva-backup');
    fs.writeFileSync(corrupt, Buffer.from('not a backup'));
    const bad = await ctx.backup.inspectBackup(corrupt);
    eq(bad.ok, false, 'corrupt archive fails inspection');
    await ok('backup/restore: checksummed, damage-proof, corrupt archives refused', async () => {});

    // ── Audit trail anchored ────────────────────────────────────────────────
    const auditCount = (ctx.current().prepare('SELECT COUNT(*) n FROM audit_log').get() as { n: number }).n;
    if (auditCount < 20) throw new Error(`audit trail too thin (${auditCount}) after a full clinic day`);
    await ok('activation: main-process gate wired and behaving (fixture keyring)', async () => {
      // Wiring: a fresh installation is unactivated until a valid serial is
      // entered; arbitrary guesses are refused with a constant message; a
      // fixture keyring proves the full positive path without production
      // secrets (the real serial never appears in the repo or CI).
      const { ActivationManager, normalizeSerial } = await import('../src/main/security/activation');
      const { buildKeyringFor } = await import('./activation-fixture');
      eq(ctx.activation.status().activated, false, 'fresh install must be unactivated');
      const fxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-activation-'));
      const fxSerial = 'SMOKE-9999-1111-2222';
      const fxKeyring = buildKeyringFor(fxSerial); // one keyring per installation — as production
      const fx = new ActivationManager(fxDir, fxKeyring);
      let generic = '';
      try { fx.activate('wrongserial123456'); } catch (e) { generic = (e as Error).message; }
      eq(generic, 'This activation serial is not valid for Dentiva Pro.', 'rejection message must be constant');
      eq(normalizeSerial(' smoke 9999 1111 2222 '), normalizeSerial(fxSerial), 'normalization equivalence');
      fx.activate(fxSerial);
      eq(fx.isActivated(), true, 'fixture serial activates');
      const reopened = new ActivationManager(fxDir, fxKeyring);
      eq(reopened.isActivated(), true, 'activation survives restart');
      fs.rmSync(fxDir, { recursive: true, force: true });
    });
    await ok(`audit: trail anchored at ${auditCount} entries`, async () => {});
  } finally {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(restoreRoot, { recursive: true, force: true });
  }

  console.log(failed === 0 ? '\nSMOKE: all scenarios passed' : `\nSMOKE: ${failed} scenario(s) failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
