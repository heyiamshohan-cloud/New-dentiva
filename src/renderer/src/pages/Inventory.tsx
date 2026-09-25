import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime } from '../api';
import { useSession } from '../session';
import { Button, Badge, DataTable, Money, Empty, Input, Select, Dialog, Field, Textarea, toast } from '../components/ui';
import { IconInventory, IconPlus } from '../icons';
import type { Page, InventoryMovementType } from '@shared/types';

interface ItemRow {
  id: number; sku: string; name: string; category: string; supplier: string; unit: string;
  cost: number; price: number; quantity: number; minQuantity: number; expiryDate: string | null;
  batch: string; active: boolean; notes: string; lowStock: boolean; expiringSoon: boolean;
}
interface MovementRow {
  id: number; itemId: number; type: InventoryMovementType; qty: number; unitCost: number;
  balanceAfter: number; reference: string; notes: string; createdBy: string; createdAt: string;
}

const MOVE_TYPES: Array<{ id: InventoryMovementType; label: string; help: string }> = [
  { id: 'purchase', label: 'Purchase', help: 'Stock received from a supplier.' },
  { id: 'stock_in', label: 'Stock in', help: 'Other stock added (e.g. donated, transferred in).' },
  { id: 'stock_out', label: 'Stock out / usage', help: 'Consumed in clinic use or transferred out.' },
  { id: 'return', label: 'Return to supplier', help: 'Sent back to supplier; reduces stock.' },
  { id: 'correction', label: 'Correction (+/−)', help: 'Signed count change; negative allowed down to zero stock.' },
  { id: 'adjustment', label: 'Adjustment (+/−)', help: 'Signed audit adjustment; negative allowed down to zero stock.' }
];

export function InventoryPage() {
  const { can } = useSession();
  const canManage = can('inventory.manage');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ItemRow> | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<ItemRow | null>(null);
  const [history, setHistory] = useState<ItemRow | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Page<ItemRow>>('inventory.list', {
        search: search || undefined, lowStockOnly: lowOnly || undefined, expiringOnly: expiringOnly || undefined,
        includeInactive: includeInactive || undefined, page, pageSize: 25
      }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load inventory.'); }
  }, [search, lowOnly, expiringOnly, includeInactive, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Inventory</h1><div className="sub">Every stock change is a signed movement — stock can never go below zero.</div></div>
        <Input placeholder="Search item / SKU…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 190 }} />
        <Select value={lowOnly ? 'low' : expiringOnly ? 'exp' : 'all'} onChange={(e) => { setLowOnly(e.target.value === 'low'); setExpiringOnly(e.target.value === 'exp'); setPage(1); }} style={{ width: 150 }}>
          <option value="all">All items</option><option value="low">Low stock only</option><option value="exp">Expiring soon</option>
        </Select>
        <label className="checkbox-row"><input type="checkbox" checked={includeInactive} onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }} /><span>Inactive too</span></label>
        {canManage && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New item</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 300 }} />}
      {data && (
        <>
          <DataTable rows={data.rows} rowKey={(i) => i.id}
            columns={[
              { key: 'sku', label: 'SKU', render: (i) => <span className="tabular primary-cell">{i.sku}</span> },
              { key: 'name', label: 'Item', render: (i) => <span className="primary-cell">{i.name}</span> },
              { key: 'category', label: 'Category', render: (i) => i.category || '—' },
              { key: 'quantity', label: 'Stock', num: true, render: (i) => <span className="tabular" style={{ fontWeight: i.lowStock ? 700 : 400 }}>{i.quantity} <span className="muted">{i.unit}</span></span> },
              { key: 'minQuantity', label: 'Min', num: true },
              { key: 'flags', label: 'Alerts', render: (i) => <span style={{ display: 'flex', gap: 4 }}>{i.lowStock && <Badge tone="danger">low stock</Badge>}{i.expiringSoon && <Badge tone="warning">expiring</Badge>}{!i.active && <Badge tone="neutral">inactive</Badge>}</span> },
              { key: 'expiryDate', label: 'Expiry', render: (i) => (i.expiryDate ? fmtDate(i.expiryDate) : '—') },
              { key: 'cost', label: 'Unit cost', num: true, render: (i) => <Money value={i.cost} /> },
              {
                key: 'actions', label: '', render: (i) => canManage ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Button size="sm" variant="primary" onClick={() => setMoving(i)}>Movement</Button>
                    <Button size="sm" onClick={() => setHistory(i)}>History</Button>
                    <Button size="sm" onClick={() => setEditing(i)}>Edit</Button>
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setHistory(i)}>History</Button>
                )
              }
            ]}
            empty={<Empty icon={<IconInventory size={34} />} title="No inventory items" hint="Track materials and consumables. Each item has a SKU, unit, minimum level and optional expiry." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} items</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="muted tabular" style={{ alignSelf: 'center' }}>Page {page}</span>
              <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}

      {(creating || editing) && <ItemDialog item={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); void load(); }} />}
      {moving && <MovementDialog item={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); void load(); }} />}
      {history && <HistoryDialog item={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function paisa(s: string): number {
  const n = Number(String(s).replace(/[,৳\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function ItemDialog({ item, onClose, onSaved }: { item: ItemRow | null; onClose: () => void; onSaved: () => void }) {
  const [sku, setSku] = useState(item?.sku ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [cost, setCost] = useState(item ? (item.cost / 100).toFixed(2) : '');
  const [price, setPrice] = useState(item ? (item.price / 100).toFixed(2) : '');
  const [minQuantity, setMinQuantity] = useState(item ? String(item.minQuantity) : '0');
  const [expiryDate, setExpiryDate] = useState(item?.expiryDate ?? '');
  const [batch, setBatch] = useState(item?.batch ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [opening, setOpening] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim() || !sku.trim()) { setError('SKU and item name are required.'); return; }
    setBusy(true); setError('');
    try {
      const input = {
        sku: sku.trim(), name: name.trim(), category, supplier, unit, cost: cost || '0', price: price || '0',
        minQuantity: parseInt(minQuantity, 10) || 0, expiryDate: expiryDate || null, batch, notes
      };
      if (item) {
        await api('inventory.update', { id: item.id, patch: input });
        toast.success('Item updated.');
      } else {
        await api('inventory.create', { input: { ...input, openingQuantity: parseInt(opening, 10) || 0 } });
        toast.success('Item created.');
      }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={item ? `Edit ${item.sku}` : 'New inventory item'} size="md" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {item && <Button variant={item.active ? 'danger-soft' : 'secondary'} onClick={async () => { await api('inventory.update', { id: item.id, patch: { active: !item.active } }); toast.success(item.active ? 'Item deactivated.' : 'Item reactivated.'); onSaved(); }}>{item.active ? 'Deactivate' : 'Reactivate'}</Button>}
        <Button variant="primary" busy={busy} onClick={() => void save()}>{item ? 'Save changes' : 'Create item'}</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="form-grid">
        <Field label="SKU" required width={6}><Input value={sku} onChange={(e) => setSku(e.target.value)} autoFocus placeholder="e.g. COMP-A2" /></Field>
        <Field label="Item name" required width={6}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Composite resin A2" /></Field>
        <Field label="Category" width={6}><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Restorative" /></Field>
        <Field label="Supplier" width={6}><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Unit" width={4}><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs / box / ml" /></Field>
        <Field label="Unit cost (৳)" width={4}><Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Min level" width={4}><Input type="number" min={0} value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} /></Field>
        <Field label="Expiry date" width={item ? 6 : 4}><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
        <Field label="Batch / lot" width={item ? 6 : 4}><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
        {!item && <Field label="Opening stock" width={4} hint="Recorded as a stock-in movement at creation."><Input type="number" min={0} value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>}
      </div>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Dialog>
  );
}

function MovementDialog({ item, onClose, onSaved }: { item: ItemRow; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<InventoryMovementType>('purchase');
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signed = type === 'adjustment' || type === 'correction';
  const meta = MOVE_TYPES.find((m) => m.id === type)!;

  const save = async () => {
    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q === 0) { setError(signed ? 'Enter a non-zero integer quantity (negative reduces stock).' : 'Enter a positive whole-number quantity.'); return; }
    if (!signed && q < 0) { setError('Enter a positive quantity for this movement type; choose Correction for a reduction.'); return; }
    if (item.quantity + (signed ? q : (type === 'stock_out' || type === 'return' ? -q : q)) < 0) {
      setError(`This would take stock below zero (current: ${item.quantity} ${item.unit}). Fix the count or use a smaller quantity.`);
      return;
    }
    setBusy(true); setError('');
    try {
      await api('inventory.movement', { input: { itemId: item.id, type, qty: q, unitCost: unitCost || undefined, reference, notes } });
      toast.success(`Movement recorded for ${item.name}.`);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Movement failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={`Stock movement — ${item.name}`} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>Record movement</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="alert-strip info" style={{ marginBottom: 10 }}>
        <span>Current stock: <b className="tabular">{item.quantity} {item.unit}</b></span>
      </div>
      <Field label="Movement type">
        <Select value={type} onChange={(e) => setType(e.target.value as InventoryMovementType)}>
          {MOVE_TYPES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
        <span className="hint">{meta.help}</span>
      </Field>
      <div className="form-grid">
        <Field label={signed ? 'Quantity (+/−)' : 'Quantity'} required width={6}>
          <Input type="number" step={1} value={qty} onChange={(e) => setQty(e.target.value)} min={signed ? undefined : 1} />
        </Field>
        <Field label="Unit cost (৳)" width={6} hint="purchase only"><Input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" /></Field>
      </div>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO no / supplier bill / memo" /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: ItemRow; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<MovementRow> | null>(null);
  useEffect(() => {
    api<Page<MovementRow>>('inventory.movements', { itemId: item.id, page, pageSize: 15 }).then(setData).catch((e) => toast.error(String(e)));
  }, [item.id, page]);
  return (
    <Dialog title={`Movement history — ${item.name}`} size="lg" onClose={onClose}>
      {!data && <div className="skeleton" style={{ height: 200 }} />}
      {data && (
        <>
          <DataTable dense rows={data.rows} rowKey={(m) => m.id}
            columns={[
              { key: 'createdAt', label: 'When', render: (m) => fmtDateTime(m.createdAt) },
              { key: 'type', label: 'Type', render: (m) => <Badge tone={m.qty > 0 ? 'success' : 'neutral'}>{m.type.replace('_', ' ')}</Badge> },
              { key: 'qty', label: 'Qty', num: true, render: (m) => <span className="tabular">{m.qty > 0 ? `+${m.qty}` : m.qty}</span> },
              { key: 'balanceAfter', label: 'Balance after', num: true, render: (m) => <span className="tabular">{m.balanceAfter}</span> },
              { key: 'reference', label: 'Reference', render: (m) => m.reference || '—' },
              { key: 'notes', label: 'Notes', render: (m) => <span className="muted">{m.notes || ''}</span> },
              { key: 'createdBy', label: 'By', render: (m) => <span className="muted">{m.createdBy}</span> }
            ]}
            empty={<Empty icon={<IconInventory size={30} />} title="No movements yet" hint="Every purchase, usage and correction appears here with the resulting balance." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} movements</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}
