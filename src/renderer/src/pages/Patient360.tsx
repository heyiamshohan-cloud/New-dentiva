import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, todayLocalDate } from '../api';
import { useSession } from '../session';
import { Button, Tabs, StatusBadge, Badge, Money, DataTable, ConfirmDialog, Field, Input, Select, Textarea, Empty, toast, Dialog } from '../components/ui';
import { PatientFormDialog, PatientFormValue } from './Patients';
import { VisitDialog } from '../components/VisitDialog';
import { RxBuilderDialog } from '../components/RxBuilderDialog';
import { InvoiceDialog } from '../components/InvoiceDialog';
import { PaymentDialog } from '../components/PaymentDialog';
import { AppointmentDialog } from '../components/AppointmentDialog';
import { DocPreviewDialog } from '../components/DocPreview';
import { IconRx, IconInvoice, IconPayment, IconVisit, IconPrint, IconTooth, IconPlus } from '../icons';
import type { FinancialSummary, Page, Patient, TreatmentPlanStatus } from '@shared/types';

interface Summary360 {
  patient: Patient;
  counts: { visits: number; prescriptions: number; appointments: number; invoices: number; payments: number; plans: number; attachments: number };
  firstVisit: string | null;
  latestVisit: string | null;
  financials: FinancialSummary;
}

type TabId = 'overview' | 'visits' | 'chart' | 'plans' | 'rx' | 'appointments' | 'billing' | 'statement' | 'attachments' | 'timeline';
type Action = { kind: 'visit' | 'rx' | 'invoice' | 'payment' | 'appointment' | 'payInvoice'; invoiceId?: number; due?: number } | null;

export function Patient360Page() {
  const { id } = useParams();
  const pid = Number(id);
  const location = useLocation();
  const { can } = useSession();
  const [data, setData] = useState<Summary360 | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>('overview');
  const [dentists, setDentists] = useState<Array<{ id: number; name: string }>>([]);
  const [treatments, setTreatments] = useState<Array<{ id: number; name: string; code: string; standardPrice: number }>>([]);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [rxOpen, setRxOpen] = useState<number | null>(null);
  const [invOpen, setInvOpen] = useState<number | null>(null);
  const [rcptOpen, setRcptOpen] = useState<number | null>(null);
  const [stmtPreview, setStmtPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Summary360>('patients.summary360', { patientId: pid }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patient.');
    }
  }, [pid]);

  useEffect(() => {
    void load();
    api<Array<{ id: number; name: string }>>('dentists.list').then(setDentists).catch(() => setDentists([]));
    api<Array<{ id: number; name: string; code: string; standardPrice: number }>>('treatments.list').then(setTreatments).catch(() => setTreatments([]));
  }, [load]);

  useEffect(() => {
    if (location.hash) setTab(location.hash.slice(1) as TabId);
  }, [location.hash]);

  if (error) return <div className="alert-strip danger">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 400 }} />;
  const p = data.patient;
  const fin = data.financials;

  const initialForm: PatientFormValue = {
    fullName: p.fullName, preferredName: p.preferredName, sex: p.sex, dob: p.dob ?? '',
    phone: p.phone, alternatePhone: p.alternatePhone, email: p.email, address: p.address,
    occupation: p.occupation, emergencyContactName: p.emergencyContactName, emergencyContactPhone: p.emergencyContactPhone,
    referralSource: p.referralSource, tags: p.tags.join(', '), allergies: p.allergies,
    medicalHistory: p.medicalHistory, dentalHistory: p.dentalHistory, currentMedications: p.currentMedications,
    chronicConditions: p.chronicConditions, riskInfo: p.riskInfo, notes: p.notes
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'visits', label: `Visits (${data.counts.visits})` },
    { id: 'chart', label: 'Dental Chart' },
    { id: 'plans', label: `Plans (${data.counts.plans})` },
    { id: 'rx', label: `Prescriptions (${data.counts.prescriptions})` },
    { id: 'appointments', label: `Appointments (${data.counts.appointments})` },
    { id: 'billing', label: `Billing (${data.counts.invoices})` },
    { id: 'statement', label: 'Statement' },
    { id: 'attachments', label: `Attachments (${data.counts.attachments})` },
    { id: 'timeline', label: 'Timeline' }
  ];

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--den-100)', color: 'var(--den-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flex: '0 0 auto' }}>
            {p.fullName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: '1 1 360px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 20 }}>{p.fullName}</h1>
              <span className="tabular" style={{ fontWeight: 700, color: 'var(--den-800)', background: 'var(--den-50)', border: '1px solid var(--den-100)', borderRadius: 4, padding: '1px 8px' }}>{p.code}</span>
              {p.archived && <Badge tone="neutral">archived</Badge>}
              {p.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              {p.sex} · {p.age != null ? `${p.age} yrs` : 'age unknown'} {p.dob ? `(born ${fmtDate(p.dob)})` : ''} · {p.phone || 'no phone'}{p.email ? ` · ${p.email}` : ''}
            </div>
            {(p.allergies || p.riskInfo || p.chronicConditions) && (
              <div className="alert-strip danger" style={{ margin: '8px 0 0', userSelect: 'text' }}>
                {p.allergies && <span><b>Allergies:</b> {p.allergies}</span>}
                {p.chronicConditions && <span><b>Chronic:</b> {p.chronicConditions}</span>}
                {p.riskInfo && <span><b>Risks:</b> {p.riskInfo}</span>}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', marginRight: 10 }}>
            <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Billed</div>
            <Money value={fin.totalBilled} />
            <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Paid</div>
            <Money value={fin.totalPaid} />
            <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{fin.totalDue < 0 ? 'Credit' : 'Due'}</div>
            <Money value={fin.totalDue} signed />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {can('visits.create') && !p.archived && <Button size="sm" variant="primary" icon={<IconVisit size={13} />} onClick={() => setAction({ kind: 'visit' })}>New visit</Button>}
            {can('prescriptions.create') && !p.archived && <Button size="sm" icon={<IconRx size={13} />} onClick={() => setAction({ kind: 'rx' })}>New prescription</Button>}
            {can('invoices.create') && !p.archived && <Button size="sm" icon={<IconInvoice size={13} />} onClick={() => setAction({ kind: 'invoice' })}>New invoice</Button>}
            {can('payments.create') && !p.archived && <Button size="sm" icon={<IconPayment size={13} />} onClick={() => setAction({ kind: 'payment' })}>Record payment</Button>}
            {can('appointments.create') && !p.archived && <Button size="sm" onClick={() => setAction({ kind: 'appointment' })}>Book appointment</Button>}
            <div style={{ display: 'flex', gap: 6 }}>
              {can('patients.update') && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
              {can('patients.archive') && <Button size="sm" variant={p.archived ? 'secondary' : 'danger-soft'} onClick={() => setConfirmArchive(true)}>{p.archived ? 'Restore' : 'Archive'}</Button>}
            </div>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'visits' && <VisitsTab pid={pid} />}
      {tab === 'chart' && <ChartTab pid={pid} canEdit={can('chart.update')} />}
      {tab === 'plans' && <PlansTab pid={pid} treatments={treatments} canPlan={can('plans.create') && can('plans.update')} canBill={can('invoices.create')} onChanged={load} />}
      {tab === 'rx' && <RxTab pid={pid} onPreview={(id) => setRxOpen(id)} />}
      {tab === 'appointments' && <AppointmentsTab pid={pid} />}
      {tab === 'billing' && (
        <BillingTab pid={pid} canPay={can('payments.create')} canVoid={can('invoices.void')} canVoidPayment={can('payments.void')}
          onPay={(invoiceId, due) => setAction({ kind: 'payInvoice', invoiceId, due })}
          onPreviewInvoice={(i) => setInvOpen(i)} onPreviewReceipt={(i) => setRcptOpen(i)} onChanged={load} />
      )}
      {tab === 'statement' && <StatementTab pid={pid} code={p.code} onPrint={() => setStmtPreview(true)} />}
      {tab === 'attachments' && <AttachmentsTab pid={pid} canEdit={can('patients.update')} />}
      {tab === 'timeline' && <TimelineTab pid={pid} />}

      {action?.kind === 'visit' && <VisitDialog patientId={pid} dentists={dentists} onClose={() => setAction(null)} onSaved={() => { setAction(null); void load(); setTab('visits'); }} />}
      {action?.kind === 'rx' && <RxBuilderDialog patientId={pid} dentists={dentists} onClose={() => setAction(null)} onSaved={(rxId) => { setAction(null); setRxOpen(rxId); void load(); }} />}
      {action?.kind === 'invoice' && <InvoiceDialog patientId={pid} treatments={treatments} onClose={() => setAction(null)} onSaved={(invId) => { setAction(null); setInvOpen(invId); void load(); }} />}
      {action?.kind === 'payment' && <PaymentDialog patientId={pid} onClose={() => setAction(null)} onSaved={(payId) => { setAction(null); setRcptOpen(payId); void load(); }} />}
      {action?.kind === 'payInvoice' && <PaymentDialog patientId={pid} invoiceId={action.invoiceId} invoiceDue={action.due} onClose={() => setAction(null)} onSaved={(payId) => { setAction(null); setRcptOpen(payId); void load(); }} />}
      {action?.kind === 'appointment' && <AppointmentDialog patientId={pid} dentists={dentists} onClose={() => setAction(null)} onSaved={() => { setAction(null); void load(); setTab('appointments'); }} />}

      {editing && <PatientFormDialog title="Edit patient" patientId={pid} initial={initialForm} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} />}
      {confirmArchive && (
        <ConfirmDialog
          title={p.archived ? 'Restore patient' : 'Archive patient'}
          danger={!p.archived}
          message={p.archived
            ? <>Restore <b>{p.fullName}</b> ({p.code}) to the active directory? All records remain intact.</>
            : <>Archive <b>{p.fullName}</b> ({p.code})? The patient is hidden from daily workflows; every record is preserved and the patient can be restored at any time.</>}
          confirmLabel={p.archived ? 'Restore' : 'Archive'}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            await api('patients.archive', { id: pid, archived: !p.archived });
            setConfirmArchive(false);
            toast.success(p.archived ? 'Patient restored.' : 'Patient archived.');
            void load();
          }} />
      )}
      {rxOpen != null && <DocPreviewDialog title="Prescription" kind="prescription" payload={{ id: rxOpen }} onClose={() => setRxOpen(null)} />}
      {invOpen != null && <DocPreviewDialog title="Invoice" kind="invoice" payload={{ id: invOpen }} onClose={() => setInvOpen(null)} />}
      {rcptOpen != null && <DocPreviewDialog title="Payment Receipt" kind="receipt" payload={{ id: rcptOpen }} onClose={() => setRcptOpen(null)} />}
      {stmtPreview && <DocPreviewDialog title={`Statement ${p.code}`} kind="statement" payload={{ patientId: pid, from: '2000-01-01', to: todayLocalDate() }} onClose={() => setStmtPreview(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- overview */
function OverviewTab({ data }: { data: Summary360 }) {
  const p = data.patient;
  return (
    <div className="grid-2">
      <div className="card"><div className="card-head"><h3>Demographics</h3></div>
        <div className="card-body"><dl className="kv-list">
          <dt>Patient Code</dt><dd className="tabular">{p.code}</dd>
          <dt>Full name</dt><dd>{p.fullName}</dd>
          <dt>Preferred name</dt><dd>{p.preferredName || '—'}</dd>
          <dt>Sex</dt><dd>{p.sex}</dd>
          <dt>Date of birth</dt><dd>{fmtDate(p.dob)}</dd>
          <dt>Phone</dt><dd>{p.phone || '—'}</dd>
          <dt>Alt phone</dt><dd>{p.alternatePhone || '—'}</dd>
          <dt>Email</dt><dd>{p.email || '—'}</dd>
          <dt>Address</dt><dd>{p.address || '—'}</dd>
          <dt>Occupation</dt><dd>{p.occupation || '—'}</dd>
          <dt>Emergency contact</dt><dd>{p.emergencyContactName ? `${p.emergencyContactName} · ${p.emergencyContactPhone}` : '—'}</dd>
          <dt>Referral source</dt><dd>{p.referralSource || '—'}</dd>
          <dt>Registered</dt><dd>{fmtDateTime(p.createdAt)}</dd>
        </dl></div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card"><div className="card-head"><h3>Lifetime summary</h3></div>
          <div className="card-body"><dl className="kv-list">
            <dt>Total visits</dt><dd className="tabular">{data.counts.visits}</dd>
            <dt>First visit</dt><dd>{fmtDateTime(data.firstVisit)}</dd>
            <dt>Latest visit</dt><dd>{fmtDateTime(data.latestVisit)}</dd>
            <dt>Prescriptions</dt><dd className="tabular">{data.counts.prescriptions}</dd>
            <dt>Appointments</dt><dd className="tabular">{data.counts.appointments}</dd>
            <dt>Treatment plans</dt><dd className="tabular">{data.counts.plans}</dd>
            <dt>Attachments</dt><dd className="tabular">{data.counts.attachments}</dd>
          </dl></div></div>
        <div className="card"><div className="card-head"><h3>Clinical background</h3></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, userSelect: 'text' }}>
            <div><b>Allergies:</b> {p.allergies || <span className="muted">none recorded</span>}</div>
            <div><b>Current medications:</b> {p.currentMedications || <span className="muted">none recorded</span>}</div>
            <div><b>Chronic conditions:</b> {p.chronicConditions || <span className="muted">none recorded</span>}</div>
            <div><b>Medical history:</b> {p.medicalHistory || <span className="muted">none recorded</span>}</div>
            <div><b>Dental history:</b> {p.dentalHistory || <span className="muted">none recorded</span>}</div>
            {p.notes && <div><b>Notes:</b> {p.notes}</div>}
          </div></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ visits */
function VisitsTab({ pid }: { pid: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<{ id: number; number: string; visitAt: string; dentistName: string; chiefComplaint: string; diagnosis: string; treatmentPerformed: string; followUpDate: string | null; notes: string }> | null>(null);
  useEffect(() => {
    api<typeof data>('visits.forPatient', { patientId: pid, page, pageSize: 25 }).then(setData).catch((e) => toast.error(String(e)));
  }, [pid, page]);
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;
  return (
    <>
      <DataTable rows={data.rows} rowKey={(v) => v.id}
        columns={[
          { key: 'number', label: 'Visit', render: (v) => <span className="primary-cell tabular">{v.number}</span> },
          { key: 'visitAt', label: 'Date', render: (v) => fmtDateTime(v.visitAt) },
          { key: 'dentistName', label: 'Dentist', render: (v) => v.dentistName || '—' },
          { key: 'chiefComplaint', label: 'C/C', render: (v) => <span style={{ userSelect: 'text' }}>{v.chiefComplaint || '—'}</span> },
          { key: 'diagnosis', label: 'Diagnosis', render: (v) => <span style={{ userSelect: 'text' }}>{v.diagnosis || '—'}</span> },
          { key: 'treatmentPerformed', label: 'Treatment done', render: (v) => <span style={{ userSelect: 'text' }}>{v.treatmentPerformed || '—'}</span> },
          { key: 'followUpDate', label: 'Follow-up', render: (v) => v.followUpDate ? <Badge tone="warning">{fmtDate(v.followUpDate)}</Badge> : '—' }
        ]}
        empty={<Empty icon={<IconVisit size={34} />} title="No visits recorded" hint="Clinical visits document the encounter: complaint, examination, diagnosis and treatment performed." />} />
      <div className="table-foot"><span className="tabular">{data.total} visits</span><span style={{ display: 'flex', gap: 6 }}><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>
    </>
  );
}

/* ------------------------------------------------------------- dental chart */
const TOOTH_STATES: Array<{ id: string; label: string; color: string }> = [
  { id: 'healthy', label: 'Healthy', color: '#3f9d5c' },
  { id: 'caries', label: 'Caries', color: '#d4713a' },
  { id: 'filled', label: 'Filled', color: '#4a7eb5' },
  { id: 'crown', label: 'Crown', color: '#8e6bbf' },
  { id: 'root_canal', label: 'Root canal', color: '#b0485a' },
  { id: 'missing', label: 'Missing', color: '#6b7885' },
  { id: 'impacted', label: 'Impacted', color: '#9a6a00' },
  { id: 'fractured', label: 'Fractured', color: '#c0432b' },
  { id: 'implant', label: 'Implant', color: '#2277aa' },
  { id: 'watch', label: 'Watch', color: '#9999aa' }
];
const stateColor = (id: string) => TOOTH_STATES.find((s) => s.id === id)?.color ?? 'transparent';
const stateLabel = (id: string) => TOOTH_STATES.find((s) => s.id === id)?.label ?? id;

/* FDI display layout (patient facing viewer): q1 18→11 | q2 21→28 over q4 48→41 | q3 31→38.
   Primary dentition: q5/q6 top, q8/q7 bottom. A quadrant lists teeth distal→mesial if
   q mod 4 ∈ {0,1}, mesial→distal if q mod 4 ∈ {2,3}. */
function quadrantTeeth(q: number, count: number): number[] {
  const desc = q % 4 === 0 || q % 4 === 1;
  return Array.from({ length: count }, (_, i) => q * 10 + (desc ? count - i : i + 1));
}

function ChartTab({ pid, canEdit }: { pid: number; canEdit: boolean }) {
  interface ToothRec { toothFdi: number; dentition: string; state: string; notes: string }
  const [records, setRecords] = useState<Map<number, ToothRec>>(new Map());
  const [dentition, setDentition] = useState<'adult' | 'primary'>('adult');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyState, setApplyState] = useState('caries');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<ToothRec[]>('chart.get', { patientId: pid })
      .then((rows) => setRecords(new Map(rows.map((r) => [r.toothFdi, r]))))
      .catch((e) => toast.error(String(e)));
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const toggleTooth = (n: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  const apply = async (state: string) => {
    if (selected.size === 0) { toast.info('Select one or more teeth first.'); return; }
    await api('chart.setMany', { patientId: pid, teeth: [...selected], state, notes: note });
    toast.success(`Marked ${selected.size} tooth/teeth as ${state ? stateLabel(state) : 'cleared'}.`);
    setSelected(new Set());
    setNote('');
    load();
  };

  const jaws = dentition === 'adult' ? [[1, 2], [4, 3]] : [[5, 6], [8, 7]];
  const count = dentition === 'adult' ? 8 : 5;

  const jawRow = (quads: number[]) => (
    <div className={`chart-jaw${dentition === 'primary' ? ' primary' : ''}`} style={{ gridTemplateColumns: `repeat(${count * 2}, 1fr)` }}>
      {quads.map((q) =>
        quadrantTeeth(q, count).map((n) => {
          const rec = records.get(n);
          const sel = selected.has(n);
          return (
            <button key={n} type="button" className={`tooth${sel ? ' selected' : ''}`} onClick={() => canEdit && toggleTooth(n)}
              title={`FDI ${n}${rec ? ` — ${stateLabel(rec.state)}${rec.notes ? `: ${rec.notes}` : ''}` : ''}`} aria-pressed={sel}>
              <span className="fdi">{n}</span>
              <span className="glyph"><IconTooth size={16} strokeWidth={1.6} /></span>
              <span className="marker" style={{ background: rec ? stateColor(rec.state) : 'transparent' }} />
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 300px' }}>
      <div className="card"><div className="card-head">
        <h3>Dental chart (FDI)</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant={dentition === 'adult' ? 'primary' : 'secondary'} onClick={() => setDentition('adult')}>Adult</Button>
          <Button size="sm" variant={dentition === 'primary' ? 'primary' : 'secondary'} onClick={() => setDentition('primary')}>Primary</Button>
        </div>
      </div>
        <div className="card-body chart">
          {jawRow(jaws[0])}
          <div style={{ borderTop: '1px dashed var(--border-strong)', margin: '2px 0' }} />
          {jawRow(jaws[1])}
          <div className="legend">
            {TOOTH_STATES.map((s) => <span key={s.id} className="item"><span className="sw" style={{ background: s.color }} />{s.label}</span>)}
          </div>
        </div>
      </div>
      <div className="card" style={{ opacity: canEdit ? 1 : 0.6 }}>
        <div className="card-head"><h3>Tooth actions</h3></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>{canEdit ? 'Click teeth to select, choose a state, then apply. Multi-tooth selection is supported.' : 'You have read-only access to the chart.'}</div>
          <Field label="Selected teeth" width={12}>
            <Input readOnly value={selected.size ? [...selected].sort((a, b) => a - b).join(', ') : '—'} />
          </Field>
          <Field label="State" width={12}>
            <Select value={applyState} onChange={(e) => setApplyState(e.target.value)} disabled={!canEdit}>
              {TOOTH_STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Note (optional)" width={12}><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} /></Field>
          <Button variant="primary" disabled={!canEdit || selected.size === 0} onClick={() => void apply(applyState)}>Apply state</Button>
          <Button disabled={!canEdit || selected.size === 0} onClick={() => void apply('')}>Clear selected</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- plans */
function PlansTab({ pid, treatments, canPlan, canBill, onChanged }: {
  pid: number; treatments: Array<{ id: number; name: string; code: string; standardPrice: number }>;
  canPlan: boolean; canBill: boolean; onChanged: () => void;
}) {
  interface PlanItem { id: number; label: string; toothFdi: string; qty: number; unitPrice: number; status: string }
  interface Plan { id: number; title: string; diagnosis: string; status: TreatmentPlanStatus; notes: string; estimatedTotal: number; items: PlanItem[] }
  const [plans, setPlans] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [items, setItems] = useState<Array<{ description: string; unitPrice: string; qty: string; toothFdi: string }>>([]);
  const [billPlan, setBillPlan] = useState<Plan | null>(null);

  const load = useCallback(() => {
    api<Plan[]>('plans.forPatient', { patientId: pid }).then(setPlans).catch((e) => toast.error(String(e)));
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await api('plans.create', { input: { patientId: pid, title, diagnosis, items: items.filter((i) => i.description).map((i, idx) => ({ customName: i.description, unitPrice: i.unitPrice || '0', qty: parseInt(i.qty) || 1, toothFdi: i.toothFdi, sortOrder: idx + 1 })) } });
      toast.success('Treatment plan created.');
      setCreating(false); setTitle(''); setDiagnosis(''); setItems([]);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create the plan.'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        {canPlan && <Button variant="primary" size="sm" icon={<IconPlus size={13} />} onClick={() => setCreating(true)}>New treatment plan</Button>}
      </div>
      {plans.length === 0 && !creating && (
        <Empty icon={<IconInvoice size={34} />} title="No treatment plans" hint="Treatment plans stage estimated work for acceptance. They never bill automatically — invoicing is a separate explicit action." />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {plans.map((plan) => (
          <div className="card" key={plan.id}>
            <div className="card-head">
              <h3>{plan.title || `Plan #${plan.id}`} <StatusBadge status={plan.status} /></h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Money value={plan.estimatedTotal} />
                {canPlan && plan.status !== 'completed' && plan.status !== 'cancelled' && (
                  <>
                    {plan.status === 'draft' && <Button size="sm" onClick={() => api('plans.setStatus', { id: plan.id, status: 'proposed' }).then(load)}>Propose</Button>}
                    {plan.status === 'proposed' && <Button size="sm" variant="primary" onClick={() => api('plans.setStatus', { id: plan.id, status: 'accepted' }).then(load)}>Mark accepted</Button>}
                    {(plan.status === 'accepted' || plan.status === 'in_progress') && <Button size="sm" onClick={() => api('plans.setStatus', { id: plan.id, status: 'completed' }).then(load)}>Complete</Button>}
                  </>
                )}
                {canBill && (plan.status === 'accepted' || plan.status === 'in_progress') && (
                  <Button size="sm" variant="primary" onClick={() => setBillPlan(plan)}>Invoice this plan…</Button>
                )}
              </div>
            </div>
            {plan.diagnosis && <div style={{ padding: '8px 16px 0', fontSize: 12, color: 'var(--text-2)' }}><b>Diagnosis:</b> {plan.diagnosis}</div>}
            <div className="card-body" style={{ padding: 0 }}>
              <DataTable dense rows={plan.items} rowKey={(i) => i.id}
                columns={[
                  { key: 'label', label: 'Item', render: (i) => <span className="primary-cell">{i.label}{i.toothFdi ? <span className="muted"> · tooth {i.toothFdi}</span> : ''}</span> },
                  { key: 'qty', label: 'Qty', num: true },
                  { key: 'unitPrice', label: 'Est. price', num: true, render: (i) => <Money value={i.unitPrice} /> },
                  { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
                  ...(canPlan ? [{ key: 'act', label: '', render: (i: PlanItem) => i.status !== 'completed' ? <Button size="sm" onClick={() => api('plans.setItemStatus', { itemId: i.id, status: 'completed' }).then(load)}>Done</Button> : null }] : [])
                ]} />
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Dialog title="New treatment plan" size="lg" onClose={() => setCreating(false)} footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void create()}>Create plan</Button>
          </>
        }>
          <div className="form-grid">
            <Field label="Plan title" width={6}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Phase 1 — posterior rehabilitation" autoFocus /></Field>
            <Field label="Diagnosis / context" width={6}><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
          </div>
          <fieldset style={{ marginTop: 10 }}>
            <legend>Estimated items</legend>
            {items.map((it, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 70px 90px 40px', gap: 6, marginBottom: 6 }}>
                <Input placeholder="Item (e.g. Root canal)" value={it.description} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} list={`plan-treat-${idx}`} />
                <datalist id={`plan-treat-${idx}`}>{treatments.map((t) => <option key={t.id} value={t.name} />)}</datalist>
                <Input placeholder="Tooth" value={it.toothFdi} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, toothFdi: e.target.value } : x))} />
                <Input type="number" min={1} placeholder="Qty" value={it.qty} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                <Input placeholder="Price" value={it.unitPrice} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} />
                <Button size="sm" variant="danger-soft" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setItems([...items, { description: '', unitPrice: '', qty: '1', toothFdi: '' }])}>+ Add item</Button>
            {treatments.length > 0 && (
              <Select style={{ marginLeft: 8, width: 240 }} value="" onChange={(e) => {
                const t = treatments.find((x) => x.id === Number(e.target.value));
                if (t) setItems([...items, { description: t.name, unitPrice: (t.standardPrice / 100).toFixed(2), qty: '1', toothFdi: '' }]);
              }}>
                <option value="">+ From catalog…</option>
                {treatments.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
              </Select>
            )}
          </fieldset>
        </Dialog>
      )}

      {billPlan && (
        <InvoiceDialog patientId={pid} treatments={treatments} planId={billPlan.id}
          prefillLines={billPlan.items.filter((i) => i.status !== 'skipped').map((i) => ({ description: i.toothFdi ? `${i.label} (tooth ${i.toothFdi})` : i.label, unitPrice: i.unitPrice, qty: i.qty, toothFdi: i.toothFdi }))}
          onClose={() => setBillPlan(null)} onSaved={() => { setBillPlan(null); onChanged(); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ prescriptions */
function RxTab({ pid, onPreview }: { pid: number; onPreview: (id: number) => void }) {
  const [data, setData] = useState<Page<{ id: number; number: string; prescribedAt: string; dentistName: string; cc: string[]; items: Array<{ medicineName: string }> }> | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    api<typeof data>('prescriptions.forPatient', { patientId: pid, page, pageSize: 25 }).then(setData).catch((e) => toast.error(String(e)));
  }, [pid, page]);
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;
  return (
    <>
      <DataTable rows={data.rows} rowKey={(r) => r.id}
        onRowClick={(r) => onPreview(r.id)}
        columns={[
          { key: 'number', label: 'Rx No', render: (r) => <span className="primary-cell tabular">{r.number}</span> },
          { key: 'prescribedAt', label: 'Date', render: (r) => fmtDate(r.prescribedAt) },
          { key: 'dentistName', label: 'Dentist', render: (r) => r.dentistName || '—' },
          { key: 'cc', label: 'C/C', render: (r) => r.cc.join(', ') || '—' },
          { key: 'items', label: 'Medicines', render: (r) => r.items.map((i) => i.medicineName).join(', ') },
          { key: 'preview', label: '', render: (r) => <Button size="sm" icon={<IconPrint size={13} />} onClick={(e) => { e.stopPropagation(); onPreview(r.id); }}>Preview</Button> }
        ]}
        empty={<Empty icon={<IconRx size={34} />} title="No prescriptions yet" hint="Prescriptions are strictly clinical documents with the full assessment and medication list." />} />
      <div className="table-foot"><span className="tabular">{data.total} prescriptions</span><span style={{ display: 'flex', gap: 6 }}><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>
    </>
  );
}

/* ------------------------------------------------------------ appointments */
function AppointmentsTab({ pid }: { pid: number }) {
  const [data, setData] = useState<Page<{ id: number; number: string; startAt: string; endAt: string; status: string; dentistName: string; notes: string }> | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback(() => {
    api<typeof data>('appointments.forPatient', { patientId: pid, page, pageSize: 25 }).then(setData).catch((e) => toast.error(String(e)));
  }, [pid, page]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;
  return (
    <>
      <DataTable rows={data.rows} rowKey={(a) => a.id}
        columns={[
          { key: 'number', label: 'No', render: (a) => <span className="tabular primary-cell">{a.number}</span> },
          { key: 'startAt', label: 'When', render: (a) => fmtDateTime(a.startAt) },
          { key: 'dentistName', label: 'Dentist', render: (a) => a.dentistName || '—' },
          { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> }
        ]}
        empty={<Empty icon={<IconInvoice size={34} />} title="No appointments" hint="Book the first appointment from the header action." />} />
      <div className="table-foot"><span className="tabular">{data.total} appointments</span><span style={{ display: 'flex', gap: 6 }}><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>
    </>
  );
}

/* ------------------------------------------------------------------ billing */
function BillingTab({ pid, canPay, canVoid, canVoidPayment, onPay, onPreviewInvoice, onPreviewReceipt, onChanged }: {
  pid: number; canPay: boolean; canVoid: boolean; canVoidPayment: boolean;
  onPay: (invoiceId: number | undefined, due: number | undefined) => void;
  onPreviewInvoice: (id: number) => void; onPreviewReceipt: (id: number) => void; onChanged: () => void;
}) {
  interface Inv { id: number; number: string; issuedAt: string; total: number; notes: string; computed: { status: string; totalPaid: number; totalDue: number } }
  interface Pay { id: number; receiptNo: string; paidAt: string; amount: number; method: string; reference: string; void: boolean; invoiceNumber: string | null; receivedBy: string }
  const [invoices, setInvoices] = useState<Page<Inv> | null>(null);
  const [payments, setPayments] = useState<Page<Pay> | null>(null);
  const [voiding, setVoiding] = useState<Inv | null>(null);
  const [voidPay, setVoidPay] = useState<Pay | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(() => {
    api<Page<Inv>>('invoices.list', { patientId: pid, pageSize: 100 }).then(setInvoices).catch((e) => toast.error(String(e)));
    api<Page<Pay>>('payments.list', { patientId: pid, includeVoid: true, pageSize: 100 }).then(setPayments).catch((e) => toast.error(String(e)));
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-head"><h3>Invoices</h3></div>
        <div className="card-body" style={{ padding: 0 }}>
          <DataTable dense rows={invoices?.rows ?? []} rowKey={(i) => i.id}
            columns={[
              { key: 'number', label: 'Invoice', render: (i) => <span className="tabular primary-cell">{i.number}</span> },
              { key: 'issuedAt', label: 'Date', render: (i) => fmtDate(i.issuedAt) },
              { key: 'total', label: 'Total', num: true, render: (i) => <Money value={i.total} /> },
              { key: 'paid', label: 'Paid', num: true, render: (i) => <Money value={i.computed.totalPaid} /> },
              { key: 'due', label: 'Due', num: true, render: (i) => <Money value={i.computed.totalDue} signed /> },
              { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.computed.status} /> },
              {
                key: 'actions', label: '', render: (i) => (
                  <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" onClick={() => onPreviewInvoice(i.id)}>View</Button>
                    {canPay && i.computed.totalDue > 0 && i.computed.status !== 'void' && i.computed.status !== 'draft' && <Button size="sm" variant="primary" onClick={() => onPay(i.id, i.computed.totalDue)}>Pay</Button>}
                    {canVoid && i.computed.status !== 'void' && i.computed.status !== 'draft' && <Button size="sm" variant="danger-soft" onClick={() => setVoiding(i)}>Void</Button>}
                  </span>
                )
              }
            ]}
            empty={<Empty icon={<IconInvoice size={34} />} title="No invoices yet" hint="Create an invoice from the header action or from an accepted treatment plan." />} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Payments & receipts</h3></div>
        <div className="card-body" style={{ padding: 0 }}>
          <DataTable dense rows={payments?.rows ?? []} rowKey={(p) => p.id}
            columns={[
              { key: 'receiptNo', label: 'Receipt', render: (p) => <span className="tabular primary-cell">{p.receiptNo}</span> },
              { key: 'paidAt', label: 'Date', render: (p) => fmtDate(p.paidAt) },
              { key: 'amount', label: 'Amount', num: true, render: (p) => <Money value={p.amount} /> },
              { key: 'method', label: 'Method' },
              { key: 'invoiceNumber', label: 'Invoice', render: (p) => p.invoiceNumber ?? <span className="muted">account</span> },
              { key: 'state', label: 'State', render: (p) => p.void ? <Badge tone="neutral">void</Badge> : <Badge tone="success">received</Badge> },
              {
                key: 'actions', label: '', render: (p) => (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Button size="sm" onClick={() => onPreviewReceipt(p.id)}>Receipt</Button>
                    {canVoidPayment && !p.void && <Button size="sm" variant="danger-soft" onClick={() => setVoidPay(p)}>Void</Button>}
                  </span>
                )
              }
            ]}
            empty={<Empty icon={<IconPayment size={34} />} title="No payments recorded" hint="Payments are separate persisted transactions — each successful payment issues a receipt." />} />
        </div>
      </div>

      {voiding && (
        <Dialog title={`Void invoice ${voiding.number}`} onClose={() => setVoiding(null)} footer={
          <>
            <Button onClick={() => setVoiding(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              try {
                await api('invoices.void', { id: voiding.id, reason: voidReason });
                toast.success(`Invoice ${voiding.number} voided.`);
                setVoiding(null); setVoidReason('');
                load(); onChanged();
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not void the invoice.'); }
            }}>Void invoice</Button>
          </>
        }>
          <p style={{ fontSize: 13, marginBottom: 10 }}>Voiding reverses the invoice in all balances. The invoice and its history remain on record — nothing is deleted.</p>
          <Field label="Reason"><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus /></Field>
        </Dialog>
      )}
      {voidPay && (
        <Dialog title={`Void payment ${voidPay.receiptNo}`} onClose={() => setVoidPay(null)} footer={
          <>
            <Button onClick={() => setVoidPay(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              try {
                await api('payments.void', { id: voidPay.id, reason: voidReason });
                toast.success(`Payment ${voidPay.receiptNo} voided.`);
                setVoidPay(null); setVoidReason('');
                load(); onChanged();
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not void the payment.'); }
            }}>Void payment</Button>
          </>
        }>
          <p style={{ fontSize: 13, marginBottom: 10 }}>Voiding removes the payment from balances but keeps the complete record for audit.</p>
          <Field label="Reason" required><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus /></Field>
        </Dialog>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- statement */
function StatementTab({ pid, code, onPrint }: { pid: number; code: string; onPrint: () => void }) {
  const [from, setFrom] = useState('2000-01-01');
  const [to, setTo] = useState(todayLocalDate());
  interface Row { effectiveAt: string; kind: string; ref: string; description: string; debit: number; credit: number; balance: number }
  const [data, setData] = useState<{ openingBalance: number; rows: Row[]; closingBalance: number; totalDebits: number; totalCredits: number } | null>(null);
  const load = useCallback(() => {
    api<typeof data>('statements.patient', { patientId: pid, from, to }).then(setData).catch((e) => toast.error(String(e)));
  }, [pid, from, to]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="skeleton" style={{ height: 260 }} />;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Statement · {code}</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          <span className="muted">→</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          <Button size="sm" icon={<IconPrint size={13} />} onClick={onPrint}>Preview / print</Button>
        </div>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <table className="data dense">
          <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>
            <tr><td colSpan={6}><b>Opening balance</b></td><td className="num"><Money value={data.openingBalance} signed /></td></tr>
            {data.rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>No transactions in this period.</td></tr>}
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="nowrap">{fmtDate(r.effectiveAt)}</td>
                <td>{r.kind === 'invoice' ? 'Invoice' : r.kind === 'payment' ? 'Payment' : 'Adjustment'}</td>
                <td className="tabular">{r.ref}</td>
                <td style={{ userSelect: 'text' }}>{r.description}</td>
                <td className="num">{r.debit ? <Money value={r.debit} /> : ''}</td>
                <td className="num">{r.credit ? <Money value={r.credit} /> : ''}</td>
                <td className="num"><Money value={r.balance} signed /></td>
              </tr>
            ))}
            <tr style={{ background: 'var(--neutral-50)' }}>
              <td colSpan={4}><b>Totals</b></td>
              <td className="num"><Money value={data.totalDebits} /></td>
              <td className="num"><Money value={data.totalCredits} /></td>
              <td />
            </tr>
            <tr style={{ background: 'var(--den-50)' }}>
              <td colSpan={6}><b>Closing balance</b></td>
              <td className="num"><b><Money value={data.closingBalance} signed /></b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- attachments */
function AttachmentsTab({ pid, canEdit }: { pid: number; canEdit: boolean }) {
  interface Att { id: number; title: string; fileName: string; mime: string; sizeBytes: number; createdAt: string; createdBy: string }
  const [items, setItems] = useState<Att[]>([]);
  const [preview, setPreview] = useState<{ title: string; dataUrl: string; mime: string } | null>(null);
  const load = useCallback(() => {
    api<Att[]>('attachments.list', { patientId: pid }).then(setItems).catch((e) => toast.error(String(e)));
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const addFile = async () => {
    const picked = await api<{ path: string | null }>('dialog.pickFile', {
      filters: [{ name: 'Documents & images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'docx', 'xlsx'] }]
    });
    if (!picked.path) return;
    const mime = picked.path.toLowerCase().endsWith('.pdf') ? 'application/pdf'
      : /\.(png|jpe?g|webp)$/.test(picked.path.toLowerCase()) ? picked.path.toLowerCase().endsWith('.png') ? 'image/png' : picked.path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg'
      : /\.(txt)$/.test(picked.path.toLowerCase()) ? 'text/plain'
      : /\.(csv)$/.test(picked.path.toLowerCase()) ? 'text/csv'
      : /\.(docx)$/.test(picked.path.toLowerCase()) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      await api('attachments.add', { patientId: pid, sourcePath: picked.path, opts: { title: picked.path.split(/[\\/]/).pop(), mime } });
      toast.success('Attachment stored.');
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not store the attachment.'); }
  };

  const openPreview = async (id: number, title: string, mime: string) => {
    try {
      const res = await api<{ meta: { mime: string }; base64: string }>('attachments.read', { id });
      if (mime === 'application/pdf' || mime.startsWith('image/') || mime === 'text/plain') {
        setPreview({ title, dataUrl: `data:${mime};base64,${res.base64}`, mime });
      } else {
        toast.info('Preview is available for PDF, images and plain text files.');
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not read the attachment.'); }
  };

  return (
    <div className="card">
      <div className="card-head"><h3>Attachments</h3>{canEdit && <Button size="sm" variant="primary" onClick={() => void addFile()}>Add file</Button>}</div>
      <div className="card-body" style={{ padding: 0 }}>
        <DataTable dense rows={items} rowKey={(a) => a.id}
          columns={[
            { key: 'title', label: 'Title', render: (a) => <span className="primary-cell">{a.title || a.fileName}</span> },
            { key: 'fileName', label: 'File', render: (a) => <span className="muted">{a.fileName}</span> },
            { key: 'sizeBytes', label: 'Size', num: true, render: (a) => `${(a.sizeBytes / 1024).toFixed(0)} KB` },
            { key: 'createdAt', label: 'Added', render: (a) => fmtDate(a.createdAt) },
            {
              key: 'act', label: '', render: (a) => (
                <span style={{ display: 'flex', gap: 4 }}>
                  <Button size="sm" onClick={() => void openPreview(a.id, a.title || a.fileName, a.mime)}>Preview</Button>
                  {canEdit && <Button size="sm" variant="danger-soft" onClick={async () => {
                    if (!window.confirm(`Remove attachment "${a.title || a.fileName}"? This deletes the stored file.`)) return;
                    await api('attachments.remove', { id: a.id });
                    toast.success('Attachment removed.');
                    load();
                  }}>Remove</Button>}
                </span>
              )
            }
          ]}
          empty={<Empty icon={<IconInvoice size={34} />} title="No attachments" hint="Store X-rays, consent forms and lab files against this patient. Files are hashed, integrity-checked and included in backups." />} />
      </div>
      {preview && (
        <Dialog title={preview.title} size="lg" onClose={() => setPreview(null)}>
          {preview.mime.startsWith('image/') && <img src={preview.dataUrl} alt={preview.title} style={{ maxWidth: '100%' }} />}
          {preview.mime === 'application/pdf' && <iframe src={preview.dataUrl} title={preview.title} style={{ width: '100%', height: 560, border: 'none' }} />}
          {preview.mime === 'text/plain' && <pre style={{ userSelect: 'text', whiteSpace: 'pre-wrap', fontSize: 12 }}>{atob(preview.dataUrl.split(',')[1])}</pre>}
        </Dialog>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- timeline */
function TimelineTab({ pid }: { pid: number }) {
  const [items, setItems] = useState<Array<{ at: string; kind: string; refId: number; title: string; detail: string }>>([]);
  useEffect(() => {
    api<typeof items>('patients.timeline', { patientId: pid }).then(setItems).catch((e) => toast.error(String(e)));
  }, [pid]);
  if (!items.length) return <Empty icon={<IconVisit size={34} />} title="No history yet" hint="The clinical timeline builds itself chronologically from visits, prescriptions and appointments." />;
  return (
    <div className="card"><div className="card-body">
      <div className="timeline">
        {items.map((e, i) => (
          <div key={i} className="tl-item">
            <div className="when">{fmtDateTime(e.at)}</div>
            <div className="what">{e.title}</div>
            {e.detail && <div className="detail">{e.detail}</div>}
          </div>
        ))}
      </div>
    </div></div>
  );
}
