import React, { useState } from 'react';
import { api } from '../api';
import { Button, Dialog, Field, Input, Select, Textarea, toast } from './ui';
import { PatientPicker } from './PatientPicker';
import { CC_OPTIONS, OE_OPTIONS, MEDICINE_FORMS, MEDICINE_TIMINGS } from '@shared/clinical';
import type { PatientSummary } from '@shared/types';

interface MedRow {
  medicineName: string; form: string; customForm: string; dose: string; frequency: string;
  duration: string; timing: string; customTiming: string; notes: string;
}

const emptyMed = (): MedRow => ({ medicineName: '', form: 'tablet', customForm: '', dose: '', frequency: '', duration: '', timing: 'after food', customTiming: '', notes: '' });

/** Flagship clinical prescription builder. Strictly clinical — no money. */
export function RxBuilderDialog(props: {
  patientId?: number;
  dentists: Array<{ id: number; name: string }>;
  defaultDentistId?: number | null;
  onClose: () => void;
  onSaved: (rxId: number) => void;
}) {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [dentistId, setDentistId] = useState(props.defaultDentistId != null ? String(props.defaultDentistId) : '');
  const [cc, setCc] = useState<string[]>([]);
  const [oe, setOe] = useState<string[]>([]);
  const [re, setRe] = useState('');
  const [advice, setAdvice] = useState('');
  const [notes, setNotes] = useState('');
  const [meds, setMeds] = useState<MedRow[]>([emptyMed()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, item: string) =>
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const setMed = (i: number, patch: Partial<MedRow>) => setMeds((cur) => cur.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const moveMed = (i: number, dir: -1 | 1) => setMeds((cur) => {
    const j = i + dir;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (saving || !props.onSaved) return;
    const pid = props.patientId ?? patient?.id;
    if (!pid) { setError('Please choose a patient.'); return; }
    if (meds.some((m) => !m.medicineName.trim())) { setError('Every medicine needs a name (or remove the empty row).'); return; }
    setSaving(true);
    setError('');
    try {
      const rx = await api<{ id: number; number: string }>('prescriptions.create', {
        input: {
          patientId: pid,
          dentistId: dentistId ? Number(dentistId) : null,
          cc, oe, re, advice, notes,
          items: meds.map((m) => ({
            medicineName: m.medicineName.trim(),
            form: m.form === 'custom' ? (m.customForm.trim() || 'custom') : m.form,
            dose: m.dose.trim(), frequency: m.frequency.trim(), duration: m.duration.trim(),
            timing: m.timing === 'custom' ? m.customTiming.trim() : m.timing,
            customInstructions: '', notes: m.notes.trim()
          }))
        }
      });
      toast.success(`Prescription ${rx.number} saved.`);
      props.onSaved(rx.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the prescription.');
      setSaving(false);
    }
  };

  const checklist = (title: string, options: readonly string[], list: string[], setList: (v: string[]) => void) => (
    <fieldset style={{ marginBottom: 12 }}>
      <legend>{title}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => (
          <button key={o} type="button" onClick={() => toggle(list, setList, o)}
            className={`btn sm ${list.includes(o) ? 'primary' : 'secondary'}`} aria-pressed={list.includes(o)}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Dialog title="New prescription" size="xl" onClose={props.onClose} footer={
      <>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Prescriptions contain clinical information only — never prices.</span>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>Save prescription</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      <div className="form-grid" style={{ marginBottom: 4 }}>
        {!props.patientId && <Field label="Patient" required width={8}><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>}
        <Field label="Dentist" width={props.patientId ? 4 : 4}>
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">— Not specified —</option>
            {props.dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {checklist('C/C — Chief Complaint', CC_OPTIONS, cc, setCc)}
        {checklist('O/E — On Examination', [...OE_OPTIONS], oe, setOe)}
      </div>
      <div className="form-grid" style={{ marginBottom: 4 }}>
        <Field label="R/E" width={6}><Textarea rows={2} value={re} onChange={(e) => setRe(e.target.value)} placeholder="Radiographic / extra findings" /></Field>
        <Field label="Advice" width={6}><Textarea rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="e.g. warm saline rinse twice daily" /></Field>
      </div>

      <fieldset>
        <legend>Medicines ({meds.length})</legend>
        {meds.map((m, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginBottom: 10, background: 'var(--neutral-25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <b style={{ fontSize: 12, color: 'var(--text-2)' }}>Medicine {i + 1}</b>
              <span style={{ flex: 1 }} />
              <Button size="sm" title="Move up" onClick={() => moveMed(i, -1)}>↑</Button>
              <Button size="sm" title="Move down" onClick={() => moveMed(i, 1)}>↓</Button>
              <Button size="sm" variant="danger-soft" onClick={() => setMeds(meds.filter((_, idx) => idx !== i))} disabled={meds.length === 1}>Remove</Button>
            </div>
            <div className="form-grid">
              <Field label="Medicine name" required width={4}><Input value={m.medicineName} onChange={(e) => setMed(i, { medicineName: e.target.value })} placeholder="e.g. Amoxicillin" /></Field>
              <Field label="Form" width={3}>
                <Select value={m.form} onChange={(e) => setMed(i, { form: e.target.value })}>
                  {MEDICINE_FORMS.map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
                </Select>
              </Field>
              {m.form === 'custom' && <Field label="Custom form" width={3}><Input value={m.customForm} onChange={(e) => setMed(i, { customForm: e.target.value })} /></Field>}
              <Field label="Dose" width={m.form === 'custom' ? 2 : 5}><Input value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} placeholder="e.g. 500 mg" /></Field>
              <Field label="Frequency" width={3}><Input value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} placeholder="e.g. 1+1+1" /></Field>
              <Field label="Duration" width={3}><Input value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} placeholder="e.g. 5 days" /></Field>
              <Field label="Timing" width={3}>
                <Select value={m.timing} onChange={(e) => setMed(i, { timing: e.target.value })}>
                  {MEDICINE_TIMINGS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                </Select>
              </Field>
              {m.timing === 'custom' && <Field label="Custom timing" width={3}><Input value={m.customTiming} onChange={(e) => setMed(i, { customTiming: e.target.value })} /></Field>}
              <Field label="Medicine notes" width={12}><Input value={m.notes} onChange={(e) => setMed(i, { notes: e.target.value })} placeholder="Instructions specific to this medicine" /></Field>
            </div>
          </div>
        ))}
        <Button icon={<span>+</span>} onClick={() => setMeds([...meds, emptyMed()])}>Add another medicine</Button>
      </fieldset>

      <Field label="Prescriber notes (not printed)" width={12}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Dialog>
  );
}
