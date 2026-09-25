import { describe, it, expect, afterEach } from 'vitest';
import { makeCtx, seedBasic } from './helpers';
import { AppError } from '@shared/types';
import { isValidFdi, adultTeeth, primaryTeeth } from '@main/services/chart';

const T = (iso: string) => iso;

describe('appointments & queue', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('detects dentist/chair/room conflicts resource-aware', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId, dentistId } = seedBasic(ctx);
    const a1 = ctx.services.appointments.create('t', { patientId, dentistId, chair: 'C1', startAt: T('2026-10-01T09:00:00Z'), durationMinutes: 30 });
    expect(a1.number).toBe('APT-000001');
    // same dentist overlapping → conflict
    expect(() => ctx.services.appointments.create('t', { patientId, dentistId, chair: 'C9', startAt: T('2026-10-01T09:15:00Z'), durationMinutes: 30 })).toThrow(/conflicts/i);
    // different dentist, different chair, different room → ok
    const d2 = ctx.services.dentists.create('t', { name: 'Dr Two' });
    ctx.services.appointments.create('t', { patientId, dentistId: d2.id, chair: 'C2', startAt: T('2026-10-01T09:15:00Z'), durationMinutes: 30 });
    // same chair different dentist → conflict
    expect(() => ctx.services.appointments.create('t', { patientId, dentistId: d2.id, chair: 'c1', startAt: T('2026-10-01T09:10:00Z'), durationMinutes: 10 })).toThrow(/conflicts/i);
    // non-overlapping → ok
    ctx.services.appointments.create('t', { patientId, dentistId, chair: 'C1', startAt: T('2026-10-01T09:30:00Z'), durationMinutes: 30 });
    // override allowed explicitly
    const forced = ctx.services.appointments.create('t', { patientId, dentistId, chair: 'C1', startAt: T('2026-10-01T09:05:00Z'), durationMinutes: 10 }, { allowConflict: true });
    expect(forced.status).toBe('scheduled');
  });

  it('rejects invalid durations and times', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    expect(() => ctx.services.appointments.create('t', { patientId, startAt: 'not-a-date', durationMinutes: 30 })).toThrow(AppError);
    expect(() => ctx.services.appointments.create('t', { patientId, startAt: T('2026-10-01T09:00:00Z'), durationMinutes: 4 })).toThrow(/duration/i);
  });

  it('status lifecycle: terminal states are protected', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const a = ctx.services.appointments.create('t', { patientId, startAt: T('2026-10-02T09:00:00Z'), durationMinutes: 30 });
    ctx.services.appointments.setStatus('t', a.id, 'confirmed');
    ctx.services.appointments.setStatus('t', a.id, 'cancelled');
    expect(() => ctx.services.appointments.setStatus('t', a.id, 'scheduled')).toThrow(/cannot be changed/);
    expect(() => ctx.services.appointments.update('t', a.id, { chair: 'C2' })).toThrow(/cannot be edited/);
    // reschedule edits time
    const b = ctx.services.appointments.create('t', { patientId, startAt: T('2026-10-03T09:00:00Z'), durationMinutes: 30 });
    const moved = ctx.services.appointments.update('t', b.id, { startAt: T('2026-10-03T10:00:00Z'), durationMinutes: 45 });
    expect(moved.startAt).toBe(T('2026-10-03T10:00:00Z'));
    expect(moved.endAt).toBe(T('2026-10-03T10:45:00Z'));
  });

  it('queue serials are per-day unique and state changes are reliable', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const p2 = ctx.services.patients.create('t', { fullName: 'Second Person', phone: '01999999999' });
    const q1 = ctx.services.queue.add('t', { day: '2026-10-01', patientId });
    const q2 = ctx.services.queue.add('t', { day: '2026-10-01', patientId: p2.id });
    expect(q1.serial).toBe(1);
    expect(q2.serial).toBe(2);
    ctx.services.queue.setStatus('t', q1.id, 'called');
    ctx.services.queue.setStatus('t', q1.id, 'in_progress');
    ctx.services.queue.setStatus('t', q1.id, 'completed');
    const day = ctx.services.queue.listDay('2026-10-01');
    expect(day.find((q) => q.id === q1.id)!.status).toBe('completed');
    expect(day.find((q) => q.id === q2.id)!.status).toBe('waiting');
  });
});

describe('visits, chart, prescriptions', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('FDI validation covers adult and primary ranges', () => {
    expect(isValidFdi(11)).toBe('adult');
    expect(isValidFdi(48)).toBe('adult');
    expect(isValidFdi(51)).toBe('primary');
    expect(isValidFdi(85)).toBe('primary');
    expect(isValidFdi(19)).toBeNull();
    expect(isValidFdi(90)).toBeNull();
    expect(adultTeeth()).toHaveLength(32);
    expect(primaryTeeth()).toHaveLength(20);
  });

  it('visit creates transactionally and closes its appointment', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId, dentistId } = seedBasic(ctx);
    const appt = ctx.services.appointments.create('t', { patientId, dentistId, startAt: T('2026-10-01T09:00:00Z'), durationMinutes: 30 });
    const v = ctx.services.visits.create('t', {
      patientId, dentistId, appointmentId: appt.id,
      chiefComplaint: 'Pain On', diagnosis: 'Irreversible pulpitis',
      treatmentPerformed: 'Pulpotomy', toothNumbers: [36, 37], followUpDate: '2026-10-15'
    });
    expect(v.number).toBe('VST-000001');
    expect(ctx.services.appointments.get(appt.id).status).toBe('completed');
    expect(ctx.services.appointments.get(appt.id).convertedVisitId).toBe(v.id);
    // tooth validation
    expect(() => ctx.services.visits.create('t', { patientId, toothNumbers: [99] })).toThrow(/FDI/);
    // timeline includes it
    const tl = ctx.services.visits.timeline(patientId);
    expect(tl.some((e) => e.kind === 'visit' && e.refId === v.id)).toBe(true);
    // follow-up surfaces
    expect(ctx.services.visits.followUpsDue('2026-10-15').length).toBe(1);
  });

  it('dental chart persists tooth states incl. multi-tooth updates', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    ctx.services.chart.setTooth('t', patientId, 36, 'caries', 'MOD caries');
    ctx.services.chart.setMany('t', patientId, [11, 12, 21], 'healthy');
    ctx.services.chart.setMany('t', patientId, [71, 72], 'missing');
    const chart = ctx.services.chart.getChart(patientId);
    expect(chart.find((t) => t.toothFdi === 36)!.state).toBe('caries');
    expect(chart.filter((t) => t.dentition === 'primary')).toHaveLength(2);
    // clearing removes record
    ctx.services.chart.setTooth('t', patientId, 36, '');
    expect(ctx.services.chart.getChart(patientId).find((t) => t.toothFdi === 36)).toBeUndefined();
    expect(() => ctx.services.chart.setTooth('t', patientId, 99, 'caries')).toThrow(/FDI/);
  });

  it('prescription: clinical only, transactional, numbered, multi-medicine', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId, dentistId } = seedBasic(ctx);
    expect(() => ctx.services.prescriptions.create('t', { patientId, dentistId, items: [] })).toThrow(/at least one medicine/);
    expect(() => ctx.services.prescriptions.create('t', { patientId, items: [{ medicineName: '', form: 'tablet', dose: '', frequency: '', duration: '', timing: '', customInstructions: '', notes: '' }] })).toThrow(/needs a name/);
    const rx = ctx.services.prescriptions.create('t', {
      patientId, dentistId,
      cc: ['Pain On', 'Swelling'], oe: ['Gingivitis'],
      re: 'IOPA: periapical radiolucency 36',
      advice: 'Warm saline rinse 3x daily',
      items: [
        { medicineName: 'Amoxicillin', form: 'capsule', dose: '500 mg', frequency: '1+1+1', duration: '5 days', timing: 'after food', customInstructions: '', notes: '' },
        { medicineName: 'Ibuprofen', form: 'tablet', dose: '400 mg', frequency: '1+0+1', duration: '3 days', timing: 'after food', customInstructions: 'only if pain', notes: '' },
        { medicineName: 'Chlorhexidine', form: 'mouthwash', dose: '0.2%', frequency: '2x daily', duration: '7 days', timing: 'after food', customInstructions: '', notes: 'spit, do not swallow' }
      ]
    });
    expect(rx.number).toBe('RX-000001');
    expect(rx.items).toHaveLength(3);
    expect(rx.items[2].form).toBe('mouthwash');
    // Prescription object carries zero financial fields.
    const json = JSON.stringify(rx).toLowerCase();
    for (const forbidden of ['price', 'total', 'discount', 'tax', 'paid', 'due', 'balance', 'amount']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('treatment plans: totals, status flow, no auto-invoicing', () => {
    const { ctx, cleanup } = makeCtx(); cleanups.push(cleanup);
    const { patientId } = seedBasic(ctx);
    const tr = ctx.services.treatments.create('t', { code: 'RCT-M', name: 'Root Canal — Molar', standardPrice: '8000', category: 'Endodontics' });
    const plan = ctx.services.plans.create('t', {
      patientId, title: 'Phase 1', items: [
        { treatmentId: tr.id, qty: 1, unitPrice: '8000' },
        { customName: 'Crown PFZ', qty: 1, unitPrice: '12000', toothFdi: '36' }
      ]
    });
    expect(plan.estimatedTotal).toBe(2000000);
    ctx.services.plans.setStatus('t', plan.id, 'proposed');
    ctx.services.plans.setStatus('t', plan.id, 'accepted');
    // no invoice created implicitly
    expect(ctx.services.billing.listInvoices({ patientId }).total).toBe(0);
    ctx.services.plans.setItemStatus('t', plan.items[0].id, 'completed');
    const updated = ctx.services.plans.get(plan.id);
    expect(updated.items[0].status).toBe('completed');
    ctx.services.plans.setStatus('t', plan.id, 'completed');
    expect(() => ctx.services.plans.update('t', plan.id, { title: 'x' })).toThrow(/completed/);
  });
});
