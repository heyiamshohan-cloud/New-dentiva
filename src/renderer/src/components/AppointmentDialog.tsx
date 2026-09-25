import React, { useState } from 'react';
import { api } from '../api';
import { Button, Dialog, Field, Input, Select, Textarea, toast } from './ui';
import { PatientPicker } from './PatientPicker';
import type { PatientSummary } from '@shared/types';

export function AppointmentDialog(props: {
  patientId?: number;
  dentists: Array<{ id: number; name: string }>;
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [date, setDate] = useState(() => props.defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('30');
  const [dentistId, setDentistId] = useState('');
  const [chair, setChair] = useState('');
  const [room, setRoom] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<Array<{ number: string; startAt: string; patientName: string }> | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (allowConflict: boolean) => {
    if (saving) return;
    const pid = props.patientId ?? patient?.id;
    if (!pid) { setError('Please choose a patient.'); return; }
    setSaving(true);
    setError('');
    setConflicts(null);
    try {
      const startAt = new Date(`${date}T${time}:00`).toISOString();
      const created = await api<{ number: string }>('appointments.create', {
        input: { patientId: pid, dentistId: dentistId ? Number(dentistId) : null, chair, room, startAt, durationMinutes: Number(duration), notes },
        allowConflict
      });
      toast.success(`Appointment ${created.number} scheduled.`);
      props.onSaved();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; details?: { conflicts?: Array<{ number: string; startAt: string; patientName: string }> } };
      if (e.code === 'CONFLICT' && e.details?.conflicts) {
        setConflicts(e.details.conflicts);
      } else {
        setError(e.message ?? 'Could not create the appointment.');
      }
      setSaving(false);
    }
  };

  return (
    <Dialog title="New appointment" onClose={props.onClose} footer={
      <>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save(false)}>Schedule</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      {conflicts && (
        <div className="dlg-warn">
          <b>This time conflicts with existing appointment(s):</b>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
            {conflicts.map((c) => <li key={c.number}>{c.number} — {c.patientName} at {new Date(c.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</li>)}
          </ul>
          Same dentist, chair or room is already engaged. Choose another time, or explicitly schedule anyway.
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="danger-soft" loading={saving} onClick={() => void save(true)}>Schedule anyway (double-book)</Button>
          </div>
        </div>
      )}
      <div className="form-grid">
        {!props.patientId && <Field label="Patient" required width={12}><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>}
        <Field label="Date" required width={4}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Time" required width={4}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Duration" width={4}>
          <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </Field>
        <Field label="Dentist" width={4}>
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">Any</option>
            {props.dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Chair" width={4}><Input value={chair} onChange={(e) => setChair(e.target.value)} placeholder="e.g. C1" /></Field>
        <Field label="Room" width={4}><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. R1" /></Field>
        <Field label="Notes" width={12}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
