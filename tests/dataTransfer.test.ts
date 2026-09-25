import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx } from './helpers';
import { AppError } from '@shared/types';

describe('import / export', () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.forEach((c) => c()); cleanups = []; });

  it('imports valid CSV, reports malformed rows, skips duplicates', () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    const csv = [
      'fullName,preferredName,sex,dob,phone,alternatePhone,email,address,occupation,allergies,medicalHistory,notes',
      'Alice Rahman,,female,1992-03-04,01711112222,,alice@example.com,Dhaka,Teacher,penicillin,,',
      '"Bob, Junior",,male,1985-07-09,01833334444,,,,Engineer,,,comma in name',
      'Charlie Dod,,other,2999-01-01,01755556666,,,,,,,bad future dob',
      'Dup Record,,female,1990-01-01,01711112222,,,,,,duplicate phone',
      'No Name,,male,1990-01-01,01799998888,,,,,,',
      ',,,,,,,,,,,missing name'
    ].join('\r\n');
    // Make No Name actually have a name to keep the case distinct:
    const file = path.join(dir, 'import.csv');
    fs.writeFileSync(file, csv, 'utf8');
    const res = ctx.services.dataTransfer.importPatientsCsv('t', file, {});
    expect(res.inserted).toBe(3); // Alice, Bob (comma name), No Name
    // Charlie (future dob) and the empty-name row fail with reasons.
    expect(res.failed.length).toBe(2);
    expect(res.failed.map((f) => f.reason).join(' | ')).toMatch(/future/);
    // Dup Record shares Alice's phone → skipped and reported, not silently merged.
    expect(res.skippedDuplicates).toBe(1);
    expect(ctx.services.patients.count()).toBe(3);
    // Explicit consent path inserts despite duplicates.
    const res2 = ctx.services.dataTransfer.importPatientsCsv('t', file, { allowDuplicates: true });
    expect(res2.skippedDuplicates).toBe(0);
    expect(res2.inserted).toBe(4); // Alice2, Bob2, Dup Record, No Name
    const bob = ctx.services.patients.search({ text: 'comma in name' });
    void bob;
    const bobby = ctx.services.patients.search({ text: 'Bob, Junior' });
    expect(bobby.total).toBe(2); // one from each import round
    expect(bobby.rows[0].fullName).toBe('Bob, Junior');
  });

  it('rejects empty files and missing required headers', () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    const empty = path.join(dir, 'empty.csv');
    fs.writeFileSync(empty, '', 'utf8');
    expect(() => ctx.services.dataTransfer.importPatientsCsv('t', empty, {})).toThrow(/empty/);
    const bad = path.join(dir, 'bad.csv');
    fs.writeFileSync(bad, 'wrongHeader,other\nx,y\n', 'utf8');
    expect(() => ctx.services.dataTransfer.importPatientsCsv('t', bad, {})).toThrow(/Missing required column/);
    expect(() => ctx.services.dataTransfer.importPatientsCsv('t', path.join(dir, 'nope.csv'), {})).toThrow(AppError);
  });

  it('exports ALL rows with identifiers preserved (no truncation)', () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    for (let i = 0; i < 250; i++) {
      ctx.services.patients.create('t', { fullName: `Bulk Person ${String(i).padStart(4, '0')}`, phone: `016${String(10000000 + i)}` });
    }
    const out = path.join(dir, 'export.csv');
    const res = ctx.services.dataTransfer.exportPatientsCsv('t', out);
    expect(res.rows).toBe(250);
    const lines = fs.readFileSync(out, 'utf8').split('\r\n');
    expect(lines).toHaveLength(251); // header + 250
    expect(lines[0]).toContain('patientCode');
    expect(lines[1]).toContain('PT-000001');
    expect(lines[250]).toContain('PT-000250');
  });

  it('unicode survives export round trip', () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    ctx.services.patients.create('t', { fullName: 'Søren " quoted " 中村', address: 'line1\nline2' });
    const out = path.join(dir, 'uni.csv');
    ctx.services.dataTransfer.exportPatientsCsv('t', out);
    const content = fs.readFileSync(out, 'utf8');
    expect(content).toContain('中村');
    expect(content).toContain('"" quoted ""');
  });

  it('report exports always include complete match set with counts', () => {
    const { ctx, dir, cleanup } = makeCtx(); cleanups.push(cleanup);
    for (let i = 0; i < 600; i++) ctx.services.patients.create('t', { fullName: `R Person ${i}` });
    const out = path.join(dir, 'report-patients.csv');
    const res = ctx.services.dataTransfer.exportReportCsv('t', 'patients', {}, out);
    expect(res.rows).toBe(600);
  });
});
