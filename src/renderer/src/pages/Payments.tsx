import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useSession } from '../session';
import { Button, DataTable, Money, Badge, Empty, Input, Select, Dialog, Field, toast } from '../components/ui';
import { PaymentDialog } from '../components/PaymentDialog';
import { DocPreviewDialog } from '../components/DocPreview';
import { PatientPicker } from '../components/PatientPicker';
import { IconPayment, IconPlus } from '../icons';
import type { Page, PatientSummary } from '@shared/types';

interface PayRow {
  id: number; receiptNo: string; paidAt: string; amount: number; method: string; reference: string;
  void: boolean; voidReason: string; patientId: number; patientName: string; patientCode: string;
  invoiceNumber: string | null; receivedBy: string;
}

export function PaymentsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const patientId = patient?.id ?? 0;
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Page<PayRow> | null>(null);
  const [methods, setMethods] = useState<Array<{ id: number; name: string }>>([]);
  const [recording, setRecording] = useState(params.get('new') === '1');
  const [preview, setPreview] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<PayRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<Page<PayRow>>('payments.list', {
        patientId: patientId || undefined, method: method || undefined, search: search || undefined,
        from: from || undefined, to: to || undefined, includeVoid: true, page, pageSize: 25
      }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load payments.'); }
  }, [patientId, method, search, from, to, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<Array<{ id: number; name: string }>>('paymentMethods.list').then(setMethods).catch(() => setMethods([]));
  }, []);

  useEffect(() => {
    const pid = Number(params.get('patient')) || 0;
    if (pid) {
      api<PatientSummary>('patients.get', { id: pid }).then((p) => setPatient(p)).catch(() => setPatient(null));
    }
    if (params.get('new') === '1') setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doVoid = async () => {
    if (!voiding) return;
    try {
      await api('payments.void', { id: voiding.id, reason: voidReason });
      toast.success(`Payment ${voiding.receiptNo} voided.`);
      setVoiding(null); setVoidReason('');
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not void.'); }
  };

  const totals = (data?.rows ?? []).filter((p) => !p.void).reduce((a, p) => a + p.amount, 0);

  return (
    <div>
      <div className="page-head">
        <div><h1>Payments</h1><div className="sub">Every successful payment issues a receipt. All history — including voids — stays on record for audit.</div></div>
        <div style={{ width: 230 }}><PatientPicker value={patient} onChange={(v) => { setPatient(v); setPage(1); }} /></div>
        <Select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} style={{ width: 130 }}>
          <option value="">All methods</option>
          {methods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ width: 140 }} aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ width: 140 }} aria-label="To date" />
        <Input placeholder="Search receipt…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 160 }} />
        {can('payments.create') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setRecording(true)}>Record payment</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 300 }} />}
      {data && (
        <>
          <div className="alert-strip info" style={{ marginBottom: 10 }}>
            <span>Showing page {page} — received total on this page: <Money value={totals} /> ({data.rows.filter((p) => !p.void).length} non-void payments)</span>
          </div>
          <DataTable rows={data.rows} rowKey={(r) => r.id}
            onRowClick={(r) => setPreview(r.id)}
            columns={[
              { key: 'receiptNo', label: 'Receipt', render: (r) => <span className="tabular primary-cell">{r.receiptNo}</span> },
              { key: 'paidAt', label: 'Date', render: (r) => fmtDate(r.paidAt) },
              { key: 'patientName', label: 'Patient', render: (r) => <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.patientId}`); }}>{r.patientName} <span className="muted tabular">{r.patientCode}</span></button> },
              { key: 'amount', label: 'Amount', num: true, render: (r) => <Money value={r.amount} /> },
              { key: 'method', label: 'Method' },
              { key: 'reference', label: 'Reference', render: (r) => <span className="muted">{r.reference || '—'}</span> },
              { key: 'invoiceNumber', label: 'Invoice', render: (r) => r.invoiceNumber ?? <span className="muted">account</span> },
              { key: 'state', label: 'State', render: (r) => r.void ? <Badge tone="neutral">void</Badge> : <Badge tone="success">received</Badge> },
              {
                key: 'actions', label: '', render: (r) => (
                  <span onClick={(e) => e.stopPropagation()}>
                    {can('payments.void') && !r.void && <Button size="sm" variant="danger-soft" onClick={() => setVoiding(r)}>Void</Button>}
                  </span>
                )
              }
            ]}
            empty={<Empty icon={<IconPayment size={34} />} title="No payments found" hint="Record a payment — the receipt prints only after the payment is safely persisted." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} payments</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="muted tabular" style={{ alignSelf: 'center' }}>Page {page}</span>
              <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}

      {recording && <PaymentDialog patientId={patientId || undefined} onClose={() => setRecording(false)} onSaved={(id) => { setRecording(false); setPreview(id); void load(); }} />}
      {preview != null && <DocPreviewDialog title="Payment Receipt" kind="receipt" payload={{ id: preview }} onClose={() => setPreview(null)} />}
      {voiding && (
        <Dialog title={`Void payment ${voiding.receiptNo}`} size="sm" onClose={() => { setVoiding(null); setVoidReason(''); }} footer={
          <>
            <Button onClick={() => setVoiding(null)}>Keep payment</Button>
            <Button variant="danger" disabled={!voidReason.trim()} onClick={() => void doVoid()}>Void payment</Button>
          </>
        }>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>Voiding removes the payment from balances ({voiding.amount ? '' : ''}the money is no longer counted as received). The complete record is kept for audit.</p>
          <Field label="Reason" required><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus placeholder="e.g. duplicate entry" /></Field>
        </Dialog>
      )}
    </div>
  );
}
