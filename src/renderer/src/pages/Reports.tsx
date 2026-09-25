import React, { useCallback, useEffect, useState } from 'react';
import { api, todayLocalDate } from '../api';
import { useSession } from '../session';
import { Button, Badge, DataTable, Empty, Input, Select, toast } from '../components/ui';
import { IconReports, IconStar } from '../icons';

interface ReportDef { kind: string; title: string; hint: string }
const REPORTS: ReportDef[] = [
  { kind: 'patients', title: 'Patient Register', hint: 'All patients with demographics and registration dates.' },
  { kind: 'appointments', title: 'Appointments', hint: 'Appointments in range with status and dentist load.' },
  { kind: 'visits', title: 'Visits', hint: 'Clinical visits in range with dentists and diagnoses.' },
  { kind: 'treatments', title: 'Treatment Activity', hint: 'Catalog treatments performed, with volumes and value.' },
  { kind: 'revenue', title: 'Revenue (billed)', hint: 'Invoices issued in range — billed revenue, not cash.' },
  { kind: 'payments', title: 'Collections', hint: 'Payments received in range, grouped by method and day.' },
  { kind: 'outstanding', title: 'Outstanding Balances', hint: 'Every patient with an open balance, with aging.' },
  { kind: 'inventory', title: 'Inventory Valuation', hint: 'Stock on hand, unit costs, valuation and alerts.' },
  { kind: 'staff_activity', title: 'Staff Activity', hint: 'Who did what — per-user action counts.' },
  { kind: 'audit', title: 'Audit Log Extract', hint: 'Audit events in range for compliance review.' }
];

interface Fav { kind: string; from?: string; to?: string }

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ReportsPage() {
  const { can } = useSession();
  const [kind, setKind] = useState('revenue');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayLocalDate());
  const [result, setResult] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [displayCount] = useState(200);
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<Fav[]>([]);
  const [error, setError] = useState('');

  const loadFavorites = useCallback(async () => {
    try {
      const s = await api<{ reportFavorites?: Fav[] }>('settings.get');
      setFavorites(Array.isArray(s.reportFavorites) ? s.reportFavorites : []);
    } catch { /* favorites are best-effort */ }
  }, []);
  useEffect(() => { void loadFavorites(); }, [loadFavorites]);

  const run = async (k = kind, f = from, t = to) => {
    setBusy(true); setError('');
    try {
      setResult(await api<{ columns: string[]; rows: unknown[][] }>('reports.run', { kind: k, filters: { from: f, to: t } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed.');
      setResult(null);
    } finally { setBusy(false); }
  };

  const saveFavorite = async () => {
    const fav: Fav = { kind, from, to };
    const next = [...favorites.filter((f) => !(f.kind === kind && f.from === from && f.to === to)), fav];
    try {
      await api('settings.update', { patch: { reportFavorites: next } });
      setFavorites(next);
      toast.success('Favorite saved.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save favorite.'); }
  };

  const removeFavorite = async (fav: Fav) => {
    const next = favorites.filter((f) => !(f.kind === fav.kind && f.from === fav.from && f.to === fav.to));
    try {
      await api('settings.update', { patch: { reportFavorites: next } });
      setFavorites(next);
    } catch (e) { toast.error(String(e)); }
  };

  const exportCsv = async () => {
    try {
      const def = REPORTS.find((r) => r.kind === kind);
      const picked = await api<{ path: string | null }>('dialog.saveFile', {
        defaultPath: `${kind}-report-${from}-to-${to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (!picked.path) return;
      const res = await api<{ rows: number }>('data.exportReport', { kind, filters: { from, to }, path: picked.path });
      toast.success(`Exported ${res.rows} rows — the export always contains the complete result set, not just what is displayed.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed.'); }
    void kind;
  };

  const def = REPORTS.find((r) => r.kind === kind);
  const shown = result ? result.rows.slice(0, displayCount) : [];

  return (
    <div>
      <div className="page-head">
        <div><h1>Reports</h1><div className="sub">Reports never modify data. Exports contain the full result set without truncation.</div></div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 210 }}>
          {REPORTS.map((r) => <option key={r.kind} value={r.kind}>{r.title}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} aria-label="To date" />
        <Button variant="primary" busy={busy} onClick={() => void run()}>Run report</Button>
        {can('data.export') && result && <Button onClick={() => void exportCsv()}>Export CSV</Button>}
        {can('settings.update') && <Button onClick={() => void saveFavorite()} icon={<IconStar size={13} />}>Save favorite</Button>}
      </div>

      {favorites.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {favorites.map((f, i) => {
            const fd = REPORTS.find((r) => r.kind === f.kind);
            return (
              <Badge key={i} tone="info">
                <button
                  type="button" className="linklike"
                  onClick={() => { setKind(f.kind); if (f.from) setFrom(f.from); if (f.to) setTo(f.to); void run(f.kind, f.from ?? from, f.to ?? to); }}
                  title={`${f.from ?? ''} → ${f.to ?? ''}`}
                >
                  ★ {fd?.title ?? f.kind} ({f.from ?? '…'} → {f.to ?? '…'})
                </button>
                {can('settings.update') && (
                  <button type="button" className="linklike" aria-label="Remove favorite" onClick={() => void removeFavorite(f)} style={{ marginLeft: 4 }}>×</button>
                )}
              </Badge>
            );
          })}
        </div>
      )}

      {def && !result && !busy && !error && (
        <div className="alert-strip info"><span><b>{def.title}:</b> {def.hint} Choose a date range and run the report.</span></div>
      )}
      {error && <div className="alert-strip danger">{error}</div>}
      {busy && <div className="skeleton" style={{ height: 300 }} />}

      {result && !busy && (
        <div className="card">
          <div className="card-head">
            <h3>{def?.title}</h3>
            <span className="tabular muted">{result.rows.length} rows{result.rows.length > shown.length ? ` (displaying first ${shown.length} — export for the full set)` : ''}</span>
          </div>
          <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
            {result.rows.length === 0 ? (
              <Empty icon={<IconReports size={34} />} title="No rows in this range" hint="Try widening the date range or choosing a different report." />
            ) : (
              <table className="data dense">
                <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>{r.map((cell, j) => <td key={j} style={{ userSelect: 'text' }}>{cell == null ? '' : String(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
