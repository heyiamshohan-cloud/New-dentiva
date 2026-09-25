import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Button, Badge, DataTable, Money, Empty, toast, Dialog, Field, Input, Textarea } from '../components/ui';
import { IconTooth, IconPlus } from '../icons';

interface Treatment { id: number; code: string; name: string; description: string; standardPrice: number; active: boolean; createdAt: string }

function paisa(s: string): number {
  const n = Number(String(s).replace(/[,৳\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function TreatmentsPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<Treatment[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Treatment | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api<Treatment[]>('treatments.list', { includeInactive: true })); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load treatments.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Treatment Catalog</h1><div className="sub">Standard services and prices. Plan and invoice lines can always override per patient.</div></div>
        {can('treatments.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New treatment</Button>}
      </div>
      {error && <div className="alert-strip danger">{error}</div>}
      {!rows && !error && <div className="skeleton" style={{ height: 300 }} />}
      {rows && (
        <>
          <DataTable rows={rows} rowKey={(t) => t.id}
            onRowClick={(t) => can('treatments.manage') && setEditing(t)}
            columns={[
              { key: 'code', label: 'Code', render: (t) => <span className="tabular primary-cell">{t.code}</span> },
              { key: 'name', label: 'Name', render: (t) => t.name },
              { key: 'description', label: 'Description', render: (t) => <span className="muted">{t.description || '—'}</span> },
              { key: 'standardPrice', label: 'Standard price', num: true, render: (t) => <Money value={t.standardPrice} /> },
              { key: 'active', label: 'Status', render: (t) => t.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">disabled</Badge> }
            ]}
            empty={<Empty icon={<IconTooth size={34} />} title="No treatments yet" hint="Build a catalog of standard services to speed up plans and invoices." />} />
          <div className="table-foot"><span className="tabular">{rows.length} treatments</span></div>
        </>
      )}
      {(creating || editing) && (
        <TreatmentDialog treatment={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); void load(); }} />
      )}
    </div>
  );
}

function TreatmentDialog({ treatment, onClose, onSaved }: { treatment: Treatment | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(treatment?.name ?? '');
  const [code, setCode] = useState(treatment?.code ?? '');
  const [description, setDescription] = useState(treatment?.description ?? '');
  const [price, setPrice] = useState(treatment ? (treatment.standardPrice / 100).toFixed(2) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      if (treatment) {
        await api('treatments.update', { id: treatment.id, patch: { name, code, description, standardPrice: paisa(price || '0') } });
        toast.success('Treatment updated.');
      } else {
        await api('treatments.create', { input: { name, code, description, standardPrice: paisa(price || '0') } });
        toast.success('Treatment added to the catalog.');
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    if (!treatment) return;
    await api('treatments.update', { id: treatment.id, patch: { active: !treatment.active } });
    toast.success(treatment.active ? 'Treatment disabled.' : 'Treatment enabled.');
    onSaved();
  };

  return (
    <Dialog title={treatment ? `Edit ${treatment.code}` : 'New treatment'} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {treatment && <Button variant={treatment.active ? 'danger-soft' : 'secondary'} onClick={() => void toggleActive()}>{treatment.active ? 'Disable' : 'Enable'}</Button>}
        <Button variant="primary" busy={busy} onClick={() => void save()}>{treatment ? 'Save changes' : 'Add treatment'}</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <Field label="Treatment name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Composite filling — posterior" /></Field>
      <div className="form-grid">
        <Field label="Code" width={6} hint="Short unique code, e.g. COMP-POST"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Standard price (৳)" width={6}><Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Dialog>
  );
}
