import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, todayLocalDate } from '../api';
import { useSession } from '../session';
import type { PatientSummary } from '@shared/types';
import { Button, Badge, Empty, toast, Dialog, Field, Textarea, Select } from '../components/ui';
import { PatientPicker } from '../components/PatientPicker';
import { VisitDialog } from '../components/VisitDialog';
import { IconQueue, IconPlus } from '../icons';
import type { QueueStatus } from '@shared/types';

interface QueueRow {
  id: number; day: string; serial: number; patientId: number; patientCode: string; patientName: string;
  dentistId: number | null; dentistName: string; room: string; chair: string; appointmentId: number | null;
  status: QueueStatus; notes: string; createdAt: string; updatedAt: string;
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting: 'Waiting', called: 'Called', in_progress: 'In chair', completed: 'Done', skipped: 'Skipped', cancelled: 'Removed'
};

const NEXT: Record<QueueStatus, QueueStatus[]> = {
  waiting: ['called', 'skipped', 'cancelled'],
  called: ['in_progress', 'skipped', 'cancelled'],
  in_progress: ['completed'],
  skipped: ['waiting', 'cancelled'],
  completed: [], cancelled: []
};

const ACTION_LABEL: Record<QueueStatus, string> = {
  waiting: 'Re-queue', called: 'Call', in_progress: 'Start treatment', completed: 'Done', skipped: 'Skip', cancelled: 'Remove'
};

export function QueuePage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [walkPatient, setWalkPatient] = useState<PatientSummary | null>(null);
  const [dentistId, setDentistId] = useState(0);
  const [notes, setNotes] = useState('');
  const [convert, setConvert] = useState<QueueRow | null>(null);
  const [dentists, setDentists] = useState<Array<{ id: number; name: string }>>([]);
  const today = todayLocalDate();

  const load = useCallback(async (silent = false) => {
    try {
      const res = await api<QueueRow[]>('queue.day', { day: today });
      setRows(Array.isArray(res) ? res : []);
      setError('');
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load the queue.');
    }
  }, [today]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    api<Array<{ id: number; name: string }>>('dentists.list', { includeInactive: false }).then(setDentists).catch(() => setDentists([]));
  }, []);

  const transition = async (row: QueueRow, toStatus: QueueStatus) => {
    try {
      await api('queue.setStatus', { id: row.id, status: toStatus });
      toast.success(`Serial ${row.serial} → ${STATUS_LABEL[toStatus]}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transition failed.');
    }
  };

  const addToQueue = async () => {
    if (!walkPatient) { toast.info('Select a patient first.'); return; }
    try {
      await api('queue.add', { input: { day: today, patientId: walkPatient.id, dentistId: dentistId || null, notes } });
      toast.success('Patient added to today’s queue.');
      setAdding(false); setWalkPatient(null); setDentistId(0); setNotes('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add to the queue.');
    }
  };

  const rows1 = rows ?? [];
  const active = rows1.filter((r) => r.status === 'waiting' || r.status === 'called' || r.status === 'in_progress')
    .sort((a, b) => (a.status === b.status ? a.serial - b.serial : (a.status === 'waiting' ? -1 : 1)));
  const finished = rows1.filter((r) => r.status === 'completed' || r.status === 'skipped' || r.status === 'cancelled')
    .sort((a, b) => a.serial - b.serial);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Today’s Queue</h1>
          <div className="sub">Chair flow for {today} — serial numbers are issued per day. Auto-refreshes every 15 seconds.</div>
        </div>
        {can('queue.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setAdding(true)}>Walk-in check-in</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!rows && !error && <div className="skeleton" style={{ height: 300 }} />}
      {rows && rows.length === 0 && (
        <Empty icon={<IconQueue size={34} />} title="Queue is empty" hint="Add a walk-in patient here, or check in a booked appointment from the Appointments page." />
      )}

      {active.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><h3>Active ({active.length})</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data">
              <thead>
                <tr><th style={{ width: 70 }}>Serial</th><th>Patient</th><th>Dentist</th><th>Status</th><th>Notes</th><th style={{ width: 330 }}></th></tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr key={r.id} style={r.status === 'in_progress' ? { background: 'var(--den-50)' } : undefined}>
                    <td className="tabular" style={{ fontWeight: 800, fontSize: 16 }}>{r.serial}</td>
                    <td>
                      <button type="button" className="linklike primary-cell" onClick={() => navigate(`/patients/${r.patientId}`)}>{r.patientName}</button>
                      <span className="muted tabular"> · {r.patientCode}</span>
                    </td>
                    <td>{r.dentistName || <span className="muted">any</span>}</td>
                    <td><Badge tone={r.status === 'in_progress' ? 'info' : r.status === 'called' ? 'warning' : 'neutral'}>{STATUS_LABEL[r.status]}</Badge></td>
                    <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' }}>{r.notes || ''}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {can('queue.manage') && NEXT[r.status].filter((s) => s !== 'cancelled').map((s) => (
                          <Button key={s} size="sm" variant={(s === 'in_progress' || s === 'completed' || s === 'called') ? 'primary' : 'secondary'} onClick={() => void transition(r, s)}>
                            {ACTION_LABEL[s]}
                          </Button>
                        ))}
                        {can('queue.manage') && NEXT[r.status].includes('cancelled') && (
                          <Button size="sm" variant="danger-soft" onClick={() => void transition(r, 'cancelled')}>Remove</Button>
                        )}
                        {can('visits.create') && (r.status === 'called' || r.status === 'in_progress') && (
                          <Button size="sm" onClick={() => setConvert(r)}>Record visit ⇢</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {finished.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Finished today ({finished.length})</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data dense">
              <thead><tr><th style={{ width: 70 }}>Serial</th><th>Patient</th><th>Dentist</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {finished.map((r) => (
                  <tr key={r.id} style={{ opacity: 0.72 }}>
                    <td className="tabular">{r.serial}</td>
                    <td>{r.patientName} <span className="muted tabular">{r.patientCode}</span></td>
                    <td className="muted">{r.dentistName || '—'}</td>
                    <td><Badge tone={r.status === 'completed' ? 'success' : 'neutral'}>{STATUS_LABEL[r.status]}</Badge></td>
                    <td className="muted" style={{ userSelect: 'text' }}>{r.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && (
        <Dialog title="Walk-in check-in" size="sm" onClose={() => setAdding(false)} footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={!walkPatient} onClick={() => void addToQueue()}>Issue serial & check in</Button>
          </>
        }>
          <Field label="Patient" required><PatientPicker value={walkPatient} onChange={setWalkPatient} autoFocus /></Field>
          <Field label="Dentist (optional)">
            <Select value={dentistId || ''} onChange={(e) => setDentistId(Number(e.target.value))}>
              <option value="">Any dentist</option>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. severe pain since last night" /></Field>
        </Dialog>
      )}

      {convert && (
        <VisitDialog
          patientId={convert.patientId}
          dentists={dentists}
          dentistId={convert.dentistId ?? undefined}
          onClose={() => setConvert(null)}
          onSaved={async () => {
            try { await api('queue.setStatus', { id: convert.id, status: 'completed' }); } catch { /* status may already have moved on */ }
            setConvert(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
