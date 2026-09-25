import React, { useState } from 'react';
import { api } from '../api';
import { Button, Dialog, Field, Input, Select, Textarea, toast } from './ui';
import type { VisitInput } from '@main/services/visits';

export function VisitDialog(props: {
  patientId: number;
  dentistId?: number | null;
  appointmentId?: number | null;
  dentists: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: (visitId: number) => void;
}) {
  const [v, setV] = useState({
    chiefComplaint: '', reason: '', symptoms: '', examination: '', diagnosis: '',
    treatmentPlanText: '', treatmentPerformed: '', toothNumbers: '', procedures: '',
    anesthesia: '', medicationsText: '', advice: '', referral: '', followUpDate: '', notes: ''
  });
  const [dentistId, setDentistId] = useState<string>(props.dentistId != null ? String(props.dentistId) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const teeth = v.toothNumbers.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map(Number);
      const payload: VisitInput = {
        patientId: props.patientId,
        dentistId: dentistId ? Number(dentistId) : null,
        appointmentId: props.appointmentId ?? null,
        chiefComplaint: v.chiefComplaint, reason: v.reason, symptoms: v.symptoms,
        examination: v.examination, diagnosis: v.diagnosis, treatmentPlanText: v.treatmentPlanText,
        treatmentPerformed: v.treatmentPerformed, toothNumbers: teeth, procedures: v.procedures,
        anesthesia: v.anesthesia, medicationsText: v.medicationsText, advice: v.advice,
        referral: v.referral, followUpDate: v.followUpDate || null, notes: v.notes
      };
      const visit = await api<{ id: number; number: string }>('visits.create', { input: payload });
      toast.success(`Visit ${visit.number} recorded.`);
      props.onSaved(visit.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the visit.');
      setSaving(false);
    }
  };

  return (
    <Dialog title="New visit" size="lg" onClose={props.onClose} footer={
      <>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>Save visit</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      <div className="form-grid">
        <Field label="Dentist" width={4}>
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">— Not specified —</option>
            {props.dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Chief complaint" width={8}><Input value={v.chiefComplaint} onChange={set('chiefComplaint')} placeholder="e.g. Pain On" autoFocus /></Field>
        <Field label="Reason for visit" width={6}><Input value={v.reason} onChange={set('reason')} /></Field>
        <Field label="Tooth numbers (FDI)" width={6} helper="Comma or space separated, e.g. 36 37"><Input value={v.toothNumbers} onChange={set('toothNumbers')} /></Field>
        <Field label="Symptoms" width={6}><Textarea rows={2} value={v.symptoms} onChange={set('symptoms')} /></Field>
        <Field label="Examination findings" width={6}><Textarea rows={2} value={v.examination} onChange={set('examination')} /></Field>
        <Field label="Diagnosis" width={6}><Textarea rows={2} value={v.diagnosis} onChange={set('diagnosis')} /></Field>
        <Field label="Treatment plan" width={6}><Textarea rows={2} value={v.treatmentPlanText} onChange={set('treatmentPlanText')} /></Field>
        <Field label="Treatment performed" width={6}><Textarea rows={2} value={v.treatmentPerformed} onChange={set('treatmentPerformed')} /></Field>
        <Field label="Procedures" width={6}><Input value={v.procedures} onChange={set('procedures')} /></Field>
        <Field label="Anesthesia" width={3}><Input value={v.anesthesia} onChange={set('anesthesia')} /></Field>
        <Field label="Medications" width={3}><Input value={v.medicationsText} onChange={set('medicationsText')} /></Field>
        <Field label="Referral" width={6}><Input value={v.referral} onChange={set('referral')} placeholder="e.g. oral surgeon" /></Field>
        <Field label="Follow-up date" width={6}><Input type="date" value={v.followUpDate} onChange={set('followUpDate')} /></Field>
        <Field label="Advice" width={6}><Textarea rows={2} value={v.advice} onChange={set('advice')} /></Field>
        <Field label="Internal notes" width={6}><Textarea rows={2} value={v.notes} onChange={set('notes')} /></Field>
      </div>
    </Dialog>
  );
}
