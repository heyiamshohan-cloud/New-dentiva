import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useSession } from '../session';
import { Button, DataTable, Money, StatusBadge, Empty, Input, Select, Dialog, Field, toast } from '../components/ui';
import { InvoiceDialog } from '../components/InvoiceDialog';
import { PaymentDialog } from '../components/PaymentDialog';
import { DocPreviewDialog } from '../components/DocPreview';
import { PatientPicker } from '../components/PatientPicker';
import { IconInvoice, IconPlus } from '../icons';
import type { Page, PatientSummary } from '@shared/types';

interface InvRow {
  id: number; number: string; issuedAt: string; patientId: number; patientName: string; patientCode: string;
  total: number; notes: string; computed: { status: string; totalPaid: number; totalDue: number };
}

export function InvoicesPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const patientId = patient?.id ?? 0;
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Page<InvRow> | null>(null);
  const [treatments, setTreatments] = useState<Array<{ id: number; name: string; code: string; standardPrice: number }>>([]);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [preview, setPreview] = useState<number | null>(null);
  const [payFor, setPayFor] = useState<{ id: number; patientId: number; due: number } | null>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<InvRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<Page<InvRow>>('invoices.list', {
        patientId: patientId || undefined, status: status || undefined, search: search || undefined, page, pageSize: 25
      }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load invoices.'); }
  }, [patientId, status, search, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<Array<{ id: number; name: string; code: string; standardPrice: number }>>('treatments.list').then(setTreatments).catch(() => setTreatments([]));
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
      await api('invoices.void', { id: voiding.id, reason: voidReason });
      toast.success(`Invoice ${voiding.number} voided.`);
      setVoiding(null); setVoidReason('');
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not void.'); }
  };

  return (
    <div>
      <div className="page-head">
        <div><h1>Invoices</h1><div className="sub">Billing and payments are intentionally separate: invoices are issued explicitly, payments recorded independently.</div></div>
        <div style={{ width: 240 }}><PatientPicker value={patient} onChange={(v) => { setPatient(v); setPage(1); }} /></div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 140 }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option><option value="issued">Issued</option>
          <option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="void">Void</option>
        </Select>
        <Input placeholder="Search number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 170 }} />
        {can('invoices.create') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New invoice</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 300 }} />}
      {data && (
        <>
          <DataTable rows={data.rows} rowKey={(r) => r.id}
            onRowClick={(r) => setPreview(r.id)}
            columns={[
              { key: 'number', label: 'Invoice', render: (r) => <span className="tabular primary-cell">{r.number}</span> },
              { key: 'issuedAt', label: 'Date', render: (r) => fmtDate(r.issuedAt) },
              { key: 'patientName', label: 'Patient', render: (r) => <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.patientId}`); }}>{r.patientName} <span className="muted tabular">{r.patientCode}</span></button> },
              { key: 'total', label: 'Total', num: true, render: (r) => <Money value={r.total} /> },
              { key: 'paid', label: 'Paid', num: true, render: (r) => <Money value={r.computed.totalPaid} /> },
              { key: 'due', label: 'Due', num: true, render: (r) => <Money value={r.computed.totalDue} signed /> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.computed.status} /> },
              {
                key: 'actions', label: '', render: (r) => (
                  <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    {can('payments.create') && r.computed.totalDue > 0 && r.computed.status !== 'void' && r.computed.status !== 'draft' && (
                      <Button size="sm" variant="primary" onClick={() => setPayFor({ id: r.id, patientId: r.patientId, due: r.computed.totalDue })}>Pay</Button>
                    )}
                    {can('invoices.void') && r.computed.status !== 'void' && r.computed.status !== 'draft' && (
                      <Button size="sm" variant="danger-soft" onClick={() => setVoiding(r)}>Void</Button>
                    )}
                  </span>
                )
              }
            ]}
            empty={<Empty icon={<IconInvoice size={34} />} title="No invoices found" hint="Invoices are created explicitly per patient — treatment plans never bill automatically." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} invoices</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="muted tabular" style={{ alignSelf: 'center' }}>Page {page}</span>
              <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}

      {creating && <InvoiceDialog patientId={patientId || undefined} treatments={treatments} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setPreview(id); void load(); }} />}
      {preview != null && <DocPreviewDialog title="Invoice" kind="invoice" payload={{ id: preview }} onClose={() => setPreview(null)} />}
      {payFor && <PaymentDialog patientId={payFor.patientId} invoiceId={payFor.id} invoiceDue={payFor.due} onClose={() => setPayFor(null)} onSaved={(payId) => { setPayFor(null); setReceipt(payId); void load(); }} />}
      {receipt != null && <DocPreviewDialog title="Payment Receipt" kind="receipt" payload={{ id: receipt }} onClose={() => setReceipt(null)} />}
      {voiding && (
        <Dialog title={`Void invoice ${voiding.number}`} size="sm" onClose={() => { setVoiding(null); setVoidReason(''); }} footer={
          <>
            <Button onClick={() => setVoiding(null)}>Keep invoice</Button>
            <Button variant="danger" disabled={!voidReason.trim()} onClick={() => void doVoid()}>Void invoice</Button>
          </>
        }>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>Voiding reverses the invoice in all patient balances. The invoice and its full history remain on record — nothing is deleted.</p>
          <Field label="Reason" required><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus placeholder="e.g. issued in error" /></Field>
        </Dialog>
      )}
    </div>
  );
}
