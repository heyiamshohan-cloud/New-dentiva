import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { Button, Dialog, Field, Input, Select, Textarea, Money, toast } from './ui';
import { PatientPicker } from './PatientPicker';
import type { PatientSummary } from '@shared/types';
import { uuid } from '../api';

interface LineRow {
  description: string; toothFdi: string; qty: string; unitPrice: string; discount: string; tax: string; treatmentId: number | null;
}
const emptyLine = (): LineRow => ({ description: '', toothFdi: '', qty: '1', unitPrice: '', discount: '', tax: '', treatmentId: null });

function paisa(s: string): number {
  if (!s.trim()) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function InvoiceDialog(props: {
  patientId?: number;
  treatments: Array<{ id: number; name: string; code: string; standardPrice: number }>;
  prefillLines?: Array<{ description: string; unitPrice: number; qty?: number; toothFdi?: string }>;
  planId?: number | null;
  onClose: () => void;
  onSaved: (invoiceId: number) => void;
}) {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [lines, setLines] = useState<LineRow[]>(
    props.prefillLines?.map((l) => ({ description: l.description, toothFdi: l.toothFdi ?? '', qty: String(l.qty ?? 1), unitPrice: (l.unitPrice / 100).toFixed(2), discount: '', tax: '', treatmentId: null })) ?? [emptyLine()]
  );
  const [discount, setDiscount] = useState('');
  const [tax, setTax] = useState('');
  const [notes, setNotes] = useState('');
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useMemo(() => uuid(), []); // one per dialog instance

  const setLine = (i: number, patch: Partial<LineRow>) => setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    let sub = 0;
    for (const l of lines) {
      const qty = Math.max(0, parseInt(l.qty) || 0);
      sub += qty * paisa(l.unitPrice) - paisa(l.discount) + paisa(l.tax);
    }
    const total = Math.max(0, sub - paisa(discount) + paisa(tax));
    return { sub, total };
  }, [lines, discount, tax]);

  const save = async () => {
    if (saving) return;
    const pid = props.patientId ?? patient?.id;
    if (!pid) { setError('Please choose a patient.'); return; }
    if (lines.some((l) => !l.description.trim())) { setError('Every line needs a description.'); return; }
    setSaving(true);
    setError('');
    try {
      const inv = await api<{ id: number; number: string }>('invoices.create', {
        input: {
          patientId: pid,
          treatmentPlanId: props.planId ?? null,
          discount: discount || '0',
          tax: tax || '0',
          notes,
          saveAsDraft,
          items: lines.map((l) => ({
            treatmentId: l.treatmentId, description: l.description.trim(), toothFdi: l.toothFdi,
            qty: parseInt(l.qty) || 1, unitPrice: l.unitPrice || '0', discount: l.discount || '0', tax: l.tax || '0'
          }))
        }
      });
      toast.success(saveAsDraft ? `Draft invoice ${inv.number} saved.` : `Invoice ${inv.number} issued.`);
      props.onSaved(inv.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the invoice.');
      setSaving(false);
    }
  };

  return (
    <Dialog title="New invoice" size="xl" onClose={props.onClose} footer={
      <>
        <label className="checkbox-row" style={{ marginRight: 'auto' }}>
          <input type="checkbox" checked={saveAsDraft} onChange={(e) => setSaveAsDraft(e.target.checked)} /> Save as draft (not yet issued)
        </label>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>Create invoice</Button>
      </>
    }>
      {error && <div className="dlg-error">{error}</div>}
      <input type="hidden" value={idempotencyKey} />
      {!props.patientId && <Field label="Patient" required width={12}><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>}

      <fieldset style={{ marginTop: 12 }}>
        <legend>Line items</legend>
        <table className="data dense">
          <thead><tr>
            <th style={{ width: '34%' }}>Description</th><th>Tooth</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Tax</th><th className="num">Amount</th><th></th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Root canal — molar" list={`treat-list-${i}`} />
                  <datalist id={`treat-list-${i}`}>
                    {props.treatments.map((t) => <option key={t.id} value={t.name} />)}
                  </datalist>
                </td>
                <td style={{ width: 70 }}><Input value={l.toothFdi} onChange={(e) => setLine(i, { toothFdi: e.target.value })} placeholder="36" /></td>
                <td style={{ width: 70 }}><Input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                <td style={{ width: 110 }}><Input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0.00" /></td>
                <td style={{ width: 100 }}><Input inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} placeholder="0.00" /></td>
                <td style={{ width: 100 }}><Input inputMode="decimal" value={l.tax} onChange={(e) => setLine(i, { tax: e.target.value })} placeholder="0.00" /></td>
                <td className="num" style={{ width: 110 }}>
                  <Money value={Math.max(0, (parseInt(l.qty) || 0) * paisa(l.unitPrice) - paisa(l.discount) + paisa(l.tax))} />
                </td>
                <td><Button size="sm" variant="danger-soft" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>×</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button size="sm" onClick={() => setLines([...lines, emptyLine()])}>+ Add line</Button>
          {props.treatments.length > 0 && (
            <Select style={{ width: 260 }} value="" onChange={(e) => {
              const t = props.treatments.find((x) => x.id === Number(e.target.value));
              if (t) setLines([...lines, { ...emptyLine(), description: t.name, unitPrice: (t.standardPrice / 100).toFixed(2), treatmentId: t.id }]);
            }}>
              <option value="">+ From treatment catalog…</option>
              {props.treatments.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select>
          )}
        </div>
      </fieldset>

      <div style={{ display: 'flex', gap: 24, marginTop: 14, alignItems: 'flex-start' }}>
        <div className="form-grid" style={{ flex: 1 }}>
          <Field label="Invoice discount" width={6}><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Invoice tax" width={6}><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Notes" width={12}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div style={{ width: 250, background: 'var(--neutral-50)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-2)' }}>
            <span>Lines subtotal</span><Money value={totals.sub} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-2)' }}>
            <span>Invoice adjustments</span><Money value={-paisa(discount) + paisa(tax)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <span>Total</span><Money value={totals.total} />
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>Saved idempotency key prevents duplicate invoices on double-click.</div>
        </div>
      </div>
    </Dialog>
  );
}
