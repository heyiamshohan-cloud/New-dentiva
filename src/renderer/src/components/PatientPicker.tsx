import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useDebounce } from './ui';
import type { PatientSummary } from '@shared/types';

/**
 * Search-based patient selector — used anywhere a patient is picked (visit,
 * invoice, appointment, rx). No arbitrary record caps: it queries the server.
 */
export function PatientPicker(props: {
  value: PatientSummary | null;
  onChange: (p: PatientSummary | null) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const debounced = useDebounce(text, 200);
  const [options, setOptions] = useState<PatientSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<PatientSummary[]>('patients.select', { text: debounced, limit: 50 })
      .then((rows) => { if (alive) setOptions(rows); })
      .catch(() => { if (alive) setOptions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debounced]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  if (props.value) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="input" style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--neutral-50)' }}>
          <span><b>{props.value.fullName}</b> <span className="muted tabular">· {props.value.code}</span></span>
        </span>
        {!props.disabled && <button className="btn tertiary sm" onClick={() => { props.onChange(null); setText(''); }}>Change</button>}
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input className="input" placeholder="Search by name, Patient Code or phone…" value={text} autoFocus={props.autoFocus}
        disabled={props.disabled}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} />
      {open && (
        <div className="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 280, overflowY: 'auto', zIndex: 50 }}>
          {loading && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-3)' }}>Searching…</div>}
          {!loading && options.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-3)' }}>No patients found. Keep typing to narrow the search.</div>}
          {!loading && options.map((p) => (
            <button key={p.id} onClick={() => { props.onChange(p); setOpen(false); }}>
              <span style={{ fontWeight: 600 }}>{p.fullName}</span>
              <span className="muted tabular" style={{ marginLeft: 'auto', fontSize: 11 }}>{p.code}</span>
              <span className="muted" style={{ fontSize: 11 }}>{p.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
