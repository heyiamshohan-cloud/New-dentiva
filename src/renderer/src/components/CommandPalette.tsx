import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { IconSearch } from '../icons';

interface Cmd { id: string; kind: string; label: string; hint?: string; run: () => void }

/** Ctrl+K command palette: actions + live global search. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<Array<{ kind: string; id: number; ref: string; title: string; subtitle: string }>>([]);
  const navigate = useNavigate();
  const { user, can, lock } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setSel(0);
      }
    };
    const onCustom = () => { setOpen(true); setQ(''); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onCustom);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-command-palette', onCustom); };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: typeof results }>('search.global', { text: q });
        if (alive) { setResults(r.results); setSel(0); }
      } catch { /* keep palette open on errors */ }
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  const goto = (kind: string, id: number) => {
    setOpen(false);
    if (kind === 'patient') navigate(`/patients/${id}`);
    else if (kind === 'invoice') navigate(`/invoices?open=${id}`);
    else if (kind === 'prescription') navigate(`/prescriptions?open=${id}`);
    else if (kind === 'appointment') navigate('/appointments');
    else if (kind === 'visit') navigate(`/patients/${id}#visits`);
    else if (kind === 'payment') navigate('/payments');
    else if (kind === 'treatment') navigate('/treatments');
  };

  const commands: Cmd[] = useMemo(() => {
    const list: Cmd[] = [];
    const push = (id: string, kind: string, label: string, run: () => void, hint?: string) => list.push({ id, kind, label, run, hint });
    push('find-patient', 'Go to', 'Find a patient…', () => { document.querySelector<HTMLInputElement>('.palette-input')?.focus(); });
    if (can('patients.create')) push('new-patient', 'Create', 'New patient', () => navigate('/patients?new=1'));
    if (can('appointments.create')) push('new-appointment', 'Create', 'New appointment', () => navigate('/appointments?new=1'));
    if (can('visits.create')) push('new-visit', 'Create', 'New visit (from patient)', () => navigate('/patients'));
    if (can('prescriptions.create')) push('new-rx', 'Create', 'New prescription', () => navigate('/prescriptions?new=1'));
    if (can('invoices.create')) push('new-invoice', 'Create', 'New invoice', () => navigate('/invoices?new=1'));
    if (can('payments.create')) push('record-payment', 'Create', 'Record payment', () => navigate('/payments?new=1'));
    if (can('queue.manage')) push('queue', 'Go to', 'Today’s queue', () => navigate('/queue'));
    if (can('reports.read')) push('reports', 'Go to', 'Reports', () => navigate('/reports'));
    if (can('backup.create')) push('backup', 'System', 'Create backup now', () => navigate('/backup'));
    if (can('settings.read')) push('settings', 'Go to', 'Settings', () => navigate('/settings'));
    if (can('diagnostics.read')) push('diagnostics', 'System', 'Run integrity diagnostics', () => navigate('/diagnostics'));
    push('lock', 'System', 'Lock application', () => void lock());
    void user;
    return list.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  }, [can, navigate, lock, q, user]);

  const flat = useMemo(() => {
    const items: Array<{ kind: string; label: string; sub?: string; run: () => void }> = [];
    commands.forEach((c) => items.push({ kind: c.kind, label: c.label, sub: c.hint, run: () => { setOpen(false); c.run(); } }));
    results.forEach((r) => items.push({ kind: r.kind, label: r.title, sub: r.subtitle, run: () => goto(r.kind, r.id) }));
    return items;
  }, [commands, results]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return (
    <div className="overlay" style={{ paddingTop: '10vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="dialog palette" role="dialog" aria-label="Command palette">
        <input ref={inputRef} className="palette-input" placeholder="Type a command or search patients, invoices, receipts…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); flat[sel].run(); }
            if (e.key === 'Escape') setOpen(false);
          }} />
        <div className="palette-list">
          {flat.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}><IconSearch size={20} style={{ opacity: 0.4, marginBottom: 6 }} /><div>No matching commands or records.</div></div>}
          {flat.slice(0, 40).map((item, i) => (
            <div key={i} className={`palette-item${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onClick={item.run}>
              <span className="kind">{item.kind}</span>
              <span style={{ fontWeight: 600 }}>{item.label}</span>
              {item.sub && <span style={{ color: 'var(--text-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
