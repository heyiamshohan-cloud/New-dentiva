import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, todayLocalDate } from '../api';
import { useSession } from '../session';
import { Button, DataTable, Money, Empty, Input, Select, Dialog, Field, Textarea, Stat, toast } from '../components/ui';
import { IconAccounting, IconPlus } from '../icons';

interface Summary {
  revenueBilled: number; paymentsReceived: number; refundsAndCredits: number; expenses: number;
  netCash: number; outstandingDue: number; invoicesIssued: number; paymentsCount: number;
}
interface ExpenseRow {
  id: number; category: string; description: string; amount: number; method: string;
  reference: string; spentAt: string; createdBy: string; createdAt: string;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function AccountingPage() {
  const { can } = useSession();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayLocalDate());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<{ rows: ExpenseRow[]; total: number } | null>(null);
  const [expPage, setExpPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, x] = await Promise.all([
        api<Summary>('accounting.summary', { from, to }),
        api<{ rows: ExpenseRow[]; total: number }>('accounting.expenses', { from, to, page: expPage, pageSize: 15 })
      ]);
      setSummary(s);
      setExpenses(x);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load accounting data.'); }
  }, [from, to, expPage]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Accounting</h1><div className="sub">Clinic-level money view — completely separate from patient clinical records.</div></div>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setExpPage(1); }} style={{ width: 150 }} aria-label="From date" />
        <span className="muted">→</span>
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setExpPage(1); }} style={{ width: 150 }} aria-label="To date" />
        {can('accounting.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setAdding(true)}>Add expense</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!summary && !error && <div className="skeleton" style={{ height: 140 }} />}
      {summary && (
        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <Stat label="Revenue billed" value={<Money value={summary.revenueBilled} />} sub={`${summary.invoicesIssued} invoices issued`} tone="default" />
          <Stat label="Payments received" value={<Money value={summary.paymentsReceived} />} sub={`${summary.paymentsCount} payments`} tone="success" />
          <Stat label="Refunds & credits" value={<Money value={summary.refundsAndCredits} signed />} sub="negative adjustments" tone="warning" />
          <Stat label="Expenses" value={<Money value={summary.expenses} />} sub="this period" tone="danger" />
          <Stat label="Net cash in" value={<Money value={summary.netCash} signed />} sub="payments − expenses" tone={summary.netCash >= 0 ? 'success' : 'danger'} />
          <Stat label="Outstanding due" value={<Money value={summary.outstandingDue} signed />} sub="all-time billed − received" tone="default" />
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Expenses ({expenses?.total ?? 0})</h3></div>
        <div className="card-body" style={{ padding: 0 }}>
          <DataTable dense rows={expenses?.rows ?? []} rowKey={(x) => x.id}
            columns={[
              { key: 'spentAt', label: 'Date', render: (x) => fmtDate(x.spentAt) },
              { key: 'category', label: 'Category', render: (x) => x.category || '—' },
              { key: 'description', label: 'Description', render: (x) => <span style={{ userSelect: 'text' }}>{x.description}</span> },
              { key: 'method', label: 'Method', render: (x) => x.method || '—' },
              { key: 'reference', label: 'Reference', render: (x) => <span className="muted">{x.reference || '—'}</span> },
              { key: 'createdBy', label: 'By', render: (x) => <span className="muted">{x.createdBy}</span> },
              { key: 'amount', label: 'Amount', num: true, render: (x) => <Money value={x.amount} /> }
            ]}
            empty={<Empty icon={<IconAccounting size={34} />} title="No expenses in this period" hint="Record clinic outgoings — rent, materials, utilities — to keep the net cash picture honest." />} />
          {expenses && expenses.total > 15 && (
            <div className="table-foot">
              <span className="tabular">{expenses.total} expenses</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" disabled={expPage <= 1} onClick={() => setExpPage(expPage - 1)}>Previous</Button>
                <Button size="sm" disabled={expPage * 15 >= expenses.total} onClick={() => setExpPage(expPage + 1)}>Next</Button>
              </span>
            </div>
          )}
        </div>
      </div>

      {adding && <ExpenseDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </div>
  );
}

function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState('Supplies');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [spentAt, setSpentAt] = useState(todayLocalDate());
  const [methods, setMethods] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Array<{ id: number; name: string }>>('paymentMethods.list').then((ms) => setMethods(ms.map((m) => m.name))).catch(() => setMethods([]));
  }, []);

  const save = async () => {
    if (!description.trim()) { setError('A description is required.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) { setError('Enter a valid amount, e.g. 1500 or 1500.50.'); return; }
    setBusy(true); setError('');
    try {
      await api('accounting.addExpense', { input: { category, description, amount, method, reference, spentAt } });
      toast.success('Expense recorded.');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title="Add expense" size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>Record expense</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="form-grid">
        <Field label="Category" width={6}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {['Supplies', 'Lab fees', 'Rent', 'Utilities', 'Salaries', 'Equipment', 'Marketing', 'Other'].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Amount (৳)" required width={6}><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Date" width={6}><Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} /></Field>
        <Field label="Method" width={6}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {(methods.length ? methods : ['Cash']).map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Description" required><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus placeholder="e.g. Composite resin restock from PharmaHouse" /></Field>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="bill / receipt no" /></Field>
    </Dialog>
  );
}
