import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, todayLocalDate } from '../api';
import { useSession } from '../session';
import { Button, Badge, StatusBadge, Empty, toast, Dialog, Field, Input, Select } from '../components/ui';
import { AppointmentDialog } from '../components/AppointmentDialog';
import { VisitDialog } from '../components/VisitDialog';
import { IconCalendar, IconLeft, IconRight, IconPlus } from '../icons';

interface ApptRow {
  id: number; number: string; status: string; startAt: string; endAt: string;
  reason: string; notes: string; dentistId: number | null; dentistName: string | null;
  patientId: number; patientName: string; patientCode: string; patientPhone: string;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DENTIST_COLORS = ['#14545c', '#2f6b4f', '#7a4f2a', '#5a4a8e', '#8e3b56', '#33608e'];

export function AppointmentsPage(_props: { bookDate?: string } = {}) {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [anchor, setAnchor] = useState(params.get('date') || todayLocalDate());
  const [mode, setMode] = useState<'day' | 'week'>(params.get('mode') === 'week' ? 'week' : 'day');
  const [dentistId, setDentistId] = useState(0);
  const [rows, setRows] = useState<ApptRow[] | null>(null);
  const [dentists, setDentists] = useState<Array<{ id: number; name: string }>>([]);
  const [booking, setBooking] = useState(false);
  const [bookFor, setBookFor] = useState<number | null>(null);
  const [convert, setConvert] = useState<ApptRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ApptRow | null>(null);
  const [err, setErr] = useState('');

  const from = anchor;
  const to = mode === 'day' ? anchor : addDays(anchor, 6);

  const load = useCallback(async () => {
    try {
      const res = await api<{ rows: ApptRow[] }>('appointments.range', { from, to, dentistId: dentistId || undefined });
      setRows(res.rows);
      setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load appointments.'); }
  }, [from, to, dentistId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<Array<{ id: number; name: string }>>('dentists.list').then(setDentists).catch(() => setDentists([]));
  }, []);

  const days = useMemo(() => {
    const out: string[] = [];
    const n = mode === 'day' ? 1 : 7;
    for (let i = 0; i < n; i++) out.push(addDays(anchor, i));
    return out;
  }, [anchor, mode]);

  const byPatient = useMemo(() => {
    const m = new Map<number, string>();
    dentists.forEach((d, i) => m.set(d.id, DENTIST_COLORS[i % DENTIST_COLORS.length]));
    return m;
  }, [dentists]);

  const shift = (n: number) => {
    const step = mode === 'day' ? n : n * 7;
    setAnchor(addDays(anchor, step));
  };

  const doTransition = async (a: ApptRow, toStatus: string) => {
    try {
      await api('appointments.setStatus', { id: a.id, status: toStatus });
      toast.success(`${a.number} → ${toStatus}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transition refused.');
    }
  };

  return (
    <div>
      <div className="page-head">
        <div><h1>Appointments</h1><div className="sub">Resource-aware scheduling with conflict detection. Use queue check-in to start the chair flow.</div></div>
        <Button size="sm" onClick={() => { setMode(mode === 'day' ? 'week' : 'day'); setParams({ date: anchor, mode: mode === 'day' ? 'week' : 'day' }); }}>
          {mode === 'day' ? 'Week view' : 'Day view'}
        </Button>
        <Select value={dentistId || ''} onChange={(e) => setDentistId(Number(e.target.value))} style={{ width: 180 }}>
          <option value="">All dentists</option>
          {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        {can('appointments.create') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setBooking(true)}>Book appointment</Button>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
          <Button size="sm" variant="ghost" icon={<IconLeft size={14} />} onClick={() => shift(-1)} aria-label="Previous" />
          <Button size="sm" variant="ghost" onClick={() => setAnchor(todayLocalDate())}>Today</Button>
          <Button size="sm" variant="ghost" icon={<IconRight size={14} />} onClick={() => shift(1)} aria-label="Next" />
          <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} style={{ width: 150 }} />
          <span className="muted" style={{ fontSize: 12 }}>
            {mode === 'day' ? fmtDate(anchor) : `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}`}
          </span>
          <span style={{ flex: 1 }} />
          {dentists.filter((d) => !dentistId || d.id === dentistId).map((d, i) => (
            <span key={d.id} style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: byPatient.get(d.id) ?? DENTIST_COLORS[i % 6] }} />{d.name}
            </span>
          ))}
        </div>
      </div>

      {err && <div className="alert-strip danger">{err}</div>}
      {!rows && !err && <div className="skeleton" style={{ height: 300 }} />}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const dayRows = (rows ?? []).filter((r) => r.startAt.slice(0, 10) === day);
          return (
            <div key={day} className="card" style={{ minHeight: 120 }}>
              <div className="card-head" style={{ padding: '8px 12px' }}>
                <h3 style={{ fontSize: 13 }}>{fmtDate(day)}</h3>
                <Badge tone="neutral">{dayRows.length}</Badge>
              </div>
              <div className="card-body" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayRows.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>No appointments</div>}
                {dayRows.map((a) => {
                  const color = a.dentistId ? (byPatient.get(a.dentistId) ?? 'var(--den-700)') : 'var(--neutral-500)';
                  return (
                    <div key={a.id} style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${color}`, borderRadius: 6, padding: '6px 8px', background: 'var(--bg-card)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                        <b style={{ fontSize: 12 }}>{a.startAt.slice(11, 16)}–{a.endAt.slice(11, 16)}</b>
                        <StatusBadge status={a.status} />
                      </div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        <button type="button" className="linklike" onClick={() => window.location.hash = `#/patients/${a.patientId}`} style={{ fontWeight: 600 }}>
                          {a.patientName}
                        </button>
                        <span className="muted tabular"> · {a.patientCode}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{a.dentistName ?? 'Any dentist'}{a.reason ? ` · ${a.reason}` : ''}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                        {can('appointments.update') && a.status === 'requested' && <Button size="sm" onClick={() => void doTransition(a, 'confirmed')}>Confirm</Button>}
                        {can('appointments.update') && (a.status === 'requested' || a.status === 'confirmed') && <Button size="sm" variant="primary" onClick={() => void doTransition(a, 'checked_in')}>Check in</Button>}
                        {can('appointments.update') && a.status === 'checked_in' && <Button size="sm" onClick={() => void doTransition(a, 'in_progress')}>In progress</Button>}
                        {can('appointments.update') && a.status === 'in_progress' && <Button size="sm" onClick={() => void doTransition(a, 'completed')}>Complete</Button>}
                        {can('appointments.update') && (a.status === 'requested' || a.status === 'confirmed' || a.status === 'checked_in') && (
                          <>
                            <Button size="sm" variant="danger-soft" onClick={() => setCancelTarget(a)}>Cancel</Button>
                            <Button size="sm" variant="ghost" onClick={() => void doTransition(a, 'no_show')}>No-show</Button>
                          </>
                        )}
                        {can('visits.create') && (a.status === 'checked_in' || a.status === 'in_progress') && (
                          <Button size="sm" variant="primary" onClick={() => setConvert(a)}>Visit ⇢</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {can('appointments.create') && dayRows.every((r) => r.status === 'cancelled' || r.status === 'no_show' || r.status === 'completed') && null}
              </div>
            </div>
          );
        })}
      </div>

      {rows && rows.length === 0 && (
        <Empty icon={<IconCalendar size={34} />} title="No appointments in this range" hint="Book an appointment to fill the diary. Conflicts are checked against dentist availability." />
      )}

      {booking && (
        <AppointmentDialog
          patientId={bookFor ?? undefined}
          dentists={dentists}
          defaultDate={anchor}
          onClose={() => { setBooking(false); setBookFor(null); }}
          onSaved={() => { setBooking(false); setBookFor(null); void load(); }}
        />
      )}

      {convert && (
        <VisitDialog
          patientId={convert.patientId}
          dentists={dentists}
          dentistId={convert.dentistId ?? undefined}
          onClose={() => setConvert(null)}
          onSaved={async () => {
            try { await api('appointments.setStatus', { id: convert.id, status: 'completed' }); } catch { /* may already be completed */ }
            setConvert(null);
            void load();
          }}
        />
      )}

      {cancelTarget && (
        <Dialog title={`Cancel ${cancelTarget.number}`} size="sm" onClose={() => setCancelTarget(null)} footer={
          <>
            <Button onClick={() => setCancelTarget(null)}>Keep appointment</Button>
            <Button variant="danger" onClick={() => {
              void doTransition(cancelTarget, 'cancelled');
              setCancelTarget(null);
            }}>Cancel appointment</Button>
          </>
        }>
          <p style={{ fontSize: 13, margin: 0 }}>
            Cancel the appointment for <b>{cancelTarget.patientName}</b> at {fmtDateTime(cancelTarget.startAt)}? The slot is freed immediately, and the cancellation is
            recorded in the audit log with your user name. To keep a reason against the appointment, edit its notes first.
          </p>
        </Dialog>
      )}
    </div>
  );
}
