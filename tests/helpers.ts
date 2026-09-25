import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppContext } from '@main/context';

/** Create an isolated AppContext backed by a temp directory. */
export function makeCtx(): { ctx: AppContext; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-test-'));
  const ctx = new AppContext(dir, 'test-1.0.0');
  return {
    ctx,
    dir,
    cleanup: () => {
      try {
        ctx.close();
      } catch {
        // already closed
      }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  };
}

/** Bootstrap a clinic + admin + dentist + a few patients for tests. */
export function seedBasic(ctx: AppContext): { patientId: number; dentistId: number } {
  ctx.services.clinic.update('test', { name: 'Test Dental Clinic', phone: '01700000000', address: 'Dhaka' });
  const dentist = ctx.services.dentists.create('test', { name: 'Dr. Ayesha Rahman', credentials: 'BDS, DDS' });
  const patient = ctx.services.patients.create('test', {
    fullName: 'Rahim Uddin',
    sex: 'male',
    dob: '1988-04-12',
    phone: '01811223344'
  });
  return { patientId: patient.id, dentistId: dentist.id };
}
