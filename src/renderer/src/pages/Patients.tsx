import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Button, DataTable, Pagination, Dialog, Field, Input, Select, Textarea, toast, Badge, ConfirmDialog, useDebounce, Empty } from '../components/ui';
import { useSession } from '../session';
import { IconPatients, IconPlus, IconSearch } from '../icons';
import type { DuplicateCandidate, Page, Patient, PatientSummary } from '@shared/types';

export interface PatientFormValue {
  fullName: string; preferredName: string; sex: 'male' | 'female' | 'other'; dob: string;
  phone: string; alternatePhone: string; email: string; address: string; occupation: string;
  emergencyContactName: string; emergencyContactPhone: string; referralSource: string; tags: string;
  allergies: string; medicalHistory: string; dentalHistory: string; currentMedications: string;
  chronicConditions: string; riskInfo: string; notes: string;
}

export const emptyPatientForm: PatientFormValue = {
  fullName: '', preferredName: '', sex: 'male', dob: '', phone: '', alternatePhone: '', email: '',
  address: '', occupation: '', emergencyContactName: '', emergencyContactPhone: '', referralSource: '',
  tags: '', allergies: '', medicalHistory: '', dentalHistory: '', currentMedications: '', chronicConditions: '', riskInfo: '', notes: ''
};

export function toPayload(v: PatientFormValue): Record<string, unknown> {
  return {
    fullName: v.fullName, preferredName: v.preferredName, sex: v.sex, dob: v.dob || null,
    phone: v.phone, alternatePhone: v.alternatePhone, email: v.email, address: v.address,
    occupation: v.occupation, emergencyContactName: v.emergencyContactName, emergencyContactPhone: v.emergencyContactPhone,
    referralSource: v.referralSource, tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
    allergies: v.allergies, medicalHistory: v.medicalHistory, dentalHistory: v.dentalHistory,
    currentMedications: v.currentMedications, chronicConditions: v.chronicConditions, riskInfo: v.riskInfo, notes: v.notes
  };
}

export function PatientFormFields({ value, onChange, errors }: { value: PatientFormValue; onChange: (v: PatientFormValue) => void; errors: Record<string, string> }) {
  const set = (k: keyof PatientFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <fieldset style={{ marginBottom: 14 }}>
        <legend>Identity</legend>
        <div className="form-grid">
          <Field label="Full name" required width={8} error={errors.fullName}><Input value={value.fullName} onChange={set('fullName')} invalid={!!errors.fullName} autoFocus /></Field>
          <Field label="Preferred name" width={4}><Input value={value.preferredName} onChange={set('preferredName')} /></Field>
          <Field label="Sex" width={4}><Select value={value.sex} onChange={set('sex')}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></Field>
          <Field label="Date of birth" width={4} error={errors.dob}><Input type="date" value={value.dob} onChange={set('dob')} invalid={!!errors.dob} /></Field>
          <Field label="Phone" width={4} error={errors.phone}><Input value={value.phone} onChange={set('phone')} invalid={!!errors.phone} /></Field>
          <Field label="Alternate phone" width={4}><Input value={value.alternatePhone} onChange={set('alternatePhone')} /></Field>
          <Field label="Email" width={8} error={errors.email}><Input value={value.email} onChange={set('email')} invalid={!!errors.email} /></Field>
          <Field label="Address" width={12}><Input value={value.address} onChange={set('address')} /></Field>
          <Field label="Occupation" width={4}><Input value={value.occupation} onChange={set('occupation')} /></Field>
          <Field label="Referral source" width={4}><Input value={value.referralSource} onChange={set('referralSource')} placeholder="e.g. walk-in, friend, doctor" /></Field>
          <Field label="Tags" width={4} helper="Comma-separated"><Input value={value.tags} onChange={set('tags')} placeholder="vip, child-friendly" /></Field>
          <Field label="Emergency contact name" width={6}><Input value={value.emergencyContactName} onChange={set('emergencyContactName')} /></Field>
          <Field label="Emergency contact phone" width={6}><Input value={value.emergencyContactPhone} onChange={set('emergencyContactPhone')} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Clinical background</legend>
        <div className="form-grid">
          <Field label="Allergies" width={6}><Textarea rows={2} value={value.allergies} onChange={set('allergies')} placeholder="e.g. penicillin, latex" /></Field>
          <Field label="Current medications" width={6}><Textarea rows={2} value={value.currentMedications} onChange={set('currentMedications')} /></Field>
          <Field label="Chronic conditions" width={6}><Textarea rows={2} value={value.chronicConditions} onChange={set('chronicConditions')} placeholder="e.g. diabetes, hypertension" /></Field>
          <Field label="Medical history" width={6}><Textarea rows={2} value={value.medicalHistory} onChange={set('medicalHistory')} /></Field>
          <Field label="Dental history" width={6}><Textarea rows={2} value={value.dentalHistory} onChange={set('dentalHistory')} /></Field>
          <Field label="Relevant risks" width={6}><Textarea rows={2} value={value.riskInfo} onChange={set('riskInfo')} placeholder="e.g. bleeds easily, anxious patient" /></Field>
          <Field label="Notes" width={12}><Textarea rows={2} value={value.notes} onChange={set('notes')} /></Field>
        </div>
      </fieldset>
    </>
  );
}

export function PatientFormDialog(props: {
  title: string;
  initial?: PatientFormValue;
  patientId?: number;
  onClose: () => void;
  onSaved: (patient: Patient) => void;
}) {
  const [value, setValue] = useState<PatientFormValue>(props.initial ?? emptyPatientForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [dupes, setDupes] = useState<DuplicateCandidate[] | null>(null);
  const dirtyRef = React.useRef(false);

  useEffect(() => { dirtyRef.current = JSON.stringify(value) !== JSON.stringify(props.initial ?? emptyPatientForm); }, [value, props.initial]);

  const close = () => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) return;
    props.onClose();
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!value.fullName.trim()) e.fullName = 'Full name is required.';
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) e.email = 'Enter a valid email address.';
    if (value.phone && !/^[0-9+\-() ]{5,25}$/.test(value.phone)) e.phone = 'Enter a valid phone number.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const doSave = async (skipDuplicateCheck: boolean) => {
    setSaving(true);
    setFormError('');
    try {
      const payload = toPayload(value);
      const patient = props.patientId
        ? await api<Patient>('patients.update', { id: props.patientId, input: payload })
        : await api<Patient>('patients.create', { input: payload, skipDuplicateCheck });
      toast.success(props.patientId ? `Patient ${patient.code} updated.` : `Patient ${patient.code} created.`);
      props.onSaved(patient);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; details?: { duplicates?: DuplicateCandidate[] } };
      if (e.code === 'CONFLICT' && e.details?.duplicates) {
        setDupes(e.details.duplicates);
      } else {
        setFormError(e.message ?? 'Could not save the patient.');
      }
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!validate()) return;
    void doSave(false);
  };

  return (
    <Dialog title={props.title} size="lg" onClose={close} footer={
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save}>{props.patientId ? 'Save changes' : 'Create patient'}</Button>
      </>
    }>
      {formError && <div className="dlg-error" role="alert">{formError}</div>}
      {dupes && (
        <div className="dlg-warn" role="alert">
          <b>Possible duplicate patient detected.</b>
          <ul style={{ margin: '6px 0 6px 16px', padding: 0 }}>
            {dupes.map((d) => (
              <li key={d.patient.id}><b>{d.patient.fullName}</b> ({d.patient.code}) — {d.reasons.join(', ')}</li>
            ))}
          </ul>
          <div style={{ marginTop: 8 }}>Records are never merged automatically. Save anyway only if this is a genuinely different person.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Button size="sm" onClick={() => setDupes(null)}>Review my entry</Button>
            <Button size="sm" variant="danger-soft" loading={saving} onClick={() => { setDupes(null); void doSave(true); }}>Save as a new patient</Button>
          </div>
        </div>
      )}
      <PatientFormFields value={value} onChange={setValue} errors={errors} />
    </Dialog>
  );
}

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const debouncedText = useDebounce(text, 250);
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [data, setData] = useState<Page<PatientSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { can } = useSession();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Page<PatientSummary>>('patients.search', { text: debouncedText, includeArchived, page, pageSize: 50 }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patients.');
    } finally {
      setLoading(false);
    }
  }, [debouncedText, includeArchived, page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Patients</h1>
          <div className="sub">Full patient directory — search covers the complete dataset, always.</div>
        </div>
        {can('patients.create') && (
          <div className="page-actions"><Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New patient</Button></div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '0 1 380px' }}>
          <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-3)' }}><IconSearch size={14} /></span>
          <Input style={{ paddingLeft: 30 }} placeholder="Search by Patient Code, name or phone…" value={text}
            onChange={(e) => { setText(e.target.value); setPage(1); }} autoFocus />
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={includeArchived} onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }} /> Include archived</label>
        {loading && <span className="muted" style={{ fontSize: 12 }}>Searching…</span>}
      </div>

      {error && <div className="alert-strip danger">{error}<Button size="sm" onClick={() => void load()}>Retry</Button></div>}

      {data && (
        <>
          <DataTable
            rows={data.rows}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate(`/patients/${p.id}`)}
            columns={[
              { key: 'code', label: 'Patient Code', render: (p) => <span className="primary-cell tabular">{p.code}</span> },
              { key: 'fullName', label: 'Name', render: (p) => <span className="primary-cell">{p.fullName}{p.archived && <Badge tone="neutral">archived</Badge>}</span> },
              { key: 'sex', label: 'Sex' },
              { key: 'age', label: 'Age', num: true, render: (p) => (p.age != null ? p.age : '—') },
              { key: 'phone', label: 'Phone' },
              { key: 'createdAt', label: 'Registered', render: (p) => new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
            ]}
            empty={
              <Empty icon={<IconPatients size={34} />} title={debouncedText ? 'No patients match your search' : 'No patients yet'}
                hint={debouncedText ? 'Check the spelling, or search by Patient Code or phone number.' : 'Register your first patient to start the clinical record.'}
                action={!debouncedText && can('patients.create') ? <Button variant="primary" size="sm" icon={<IconPlus size={13} />} onClick={() => setCreating(true)}>New patient</Button> : undefined} />
            }
          />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      {creating && (
        <PatientFormDialog
          title="New patient"
          onClose={() => { setCreating(false); params.delete('new'); setParams(params, { replace: true }); }}
          onSaved={(p) => { setCreating(false); navigate(`/patients/${p.id}`); }}
        />
      )}
    </div>
  );
}
