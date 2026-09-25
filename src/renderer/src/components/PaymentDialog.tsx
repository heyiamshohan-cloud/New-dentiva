import React, { useEffect, useMemo, useState } from 'react';
import { api, uuid } from '../api';
import { Button, Dialog, Field, Input, Select, Textarea, Money, toast } from './ui';
import { PatientPicker } from './PatientPicker';
import type { PatientSummary } from '@shared/types';

export function PaymentDialog(props: {
  patientId?: number;
  invoiceId?: number;
  invoiceDue?: number;
  onClose: () => void;
  onSaved: (paymentId: number) => void;
}) {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [invoices, setInvoices] = useState<Array<{ id: number; number: string; total: number; due: number }>>([]);
  const [invoiceId, setInvoiceId] = useState<string>(props.invoiceId != null ? String(props.invoiceId) : '');
  const [amount, setAmount] = useState(props.invoiceDue != null && props.invoiceDue > 0 ? (props.invoiceDue / 100).toFixed(2) : '');
  const [methods, setMethods] = useState<Array<{ id: number; name: string }>>([]);
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const clientRef = useMemo(() => uuid(), []);

  useEffect(() => {
    api<Array<{ id: number; name: string }>>('paymentMethods.list').then((list) => {
      setMethods(list.filter((m) => m as unknown as { active: boolean }).map((m) => ({ id: m.id, name: m.name })));
      if (list.length) setMethod((list[0] as unknown as { name: string }).name);
    }).catch(() => setMethods([{ id: 0, name: 'Cash' }]));
  }, []);

  useEffect(() => {
    const pid = props.patientId ?? patient?.id;
    if (!pid || props.invoiceId != null) { setInvoices([]); return; }
    api<{ rows: Array<{ id: number; number: string; total: number; computed: { totalDue: number; status: string } }> }>('invoices.list', { patientId: pid, pageSize: 200 })
      .then((res) => setInvoices(res.rows.filter((i) => i.computed.status !== 'void' && i.computed.status !== 'draft').map((i) => ({ id: i.id, number: i.number, total: i.total, due: i.computed.totalDue }))))
      .catch(() => setInvoices([]));
  }, [patient, props.patientId, props.invoiceId]);

  const selectedDue = props.invoiceDue ?? invoices.find((i) => i.id === Number(invoiceId))?.due ?? null;
  const amountPaisa = Math.round(Number(amount || '0') * 100);
  const overpay = selectedDue != null && amountPaisa > selectedDue && selectedDue >= 0 && amountPaisa > 0;

  const save = async () => {
    if (saving) return;
    const pid = props.patientId ?? patient?.id;
    if (!pid) { setError('Please choose a patient.'); return; }
    if (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Enter an amount greater than zero.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api<{ payment: { id: number; receiptNo: string }; remainingDue: number; duplicate: boolean }>('payments.record', {
        input: {
          patientId: pid,
          invoiceId: invoiceId ? Number(invoiceId) : null,
          amount, method, reference, notes, clientRef
        }
      });
      toast.success(`Payment recorded — receipt ${res.payment.receiptNo}.`);
      props.onSaved(res.payment.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the payment.');
      setSaving(false);
    }
  };

  return (
    <Dialog title="Record payment" onClose={props.onClose} footer={
      <>
        {overpay && <span className="muted" style={{ marginRight: 'auto', fontSize: 12, color: 'var(--warning)' }}>Amount exceeds due — the extra will sit as a credit on the statement.</span>}
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>Record payment</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      <div className="form-grid">
        {!props.patientId && <Field label="Patient" required width={12}><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>}
        {props.invoiceId == null && (
          <Field label="Invoice (optional)" width={12} helper="Leave empty to record an account-level payment.">
            <Select value={invoiceId} onChange={(e) => {
              setInvoiceId(e.target.value);
              const inv = invoices.find((i) => i.id === Number(e.target.value));
              if (inv && inv.due > 0) setAmount((inv.due / 100).toFixed(2));
            }}>
              <option value="">— No specific invoice —</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{`${i.number} · due ${(i.due / 100).toFixed(2)}`}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Amount" required width={4} error={amount && Number(amount) <= 0 ? 'Must be greater than zero' : undefined}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus={!!props.patientId} />
        </Field>
        <Field label="Method" required width={4}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Reference" width={4} helper="Transaction id, cheque no"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Notes" width={12}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        A receipt number is issued once the payment is safely stored. Double-clicking this button cannot create a duplicate payment (idempotency key: {clientRef.slice(0, 8)}…).
      </div>
    </Dialog>
  );
}
