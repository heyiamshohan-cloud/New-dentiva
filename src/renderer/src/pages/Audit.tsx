import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Button, DataTable, Empty, Input, toast } from '../components/ui';
import { IconAudit } from '../icons';

interface AuditRow { id: number; at: string; actor: string; action: string; entity: string; entityId: string; detail: string }

export function AuditPage() {
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: AuditRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const LIMIT = 100;

  const load = useCallback(async () => {
    try {
      setData(await api<{ rows: AuditRow[]; total: number }>('audit.list', {
        actor: actor || undefined, entity: entity || undefined, from: from || undefined, to: to || undefined,
        limit: LIMIT, offset
      }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load the audit log.'); }
  }, [actor, entity, from, to, offset]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Audit Log</h1><div className="sub">Append-only record of every significant action — who, what, when. The log cannot be altered from the UI.</div></div>
        <Input placeholder="Filter user…" value={actor} onChange={(e) => { setActor(e.target.value); setOffset(0); }} style={{ width: 150 }} />
        <Input placeholder="Filter entity (e.g. invoices)…" value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }} style={{ width: 190 }} />
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} style={{ width: 145 }} aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} style={{ width: 145 }} aria-label="To date" />
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 300 }} />}
      {data && (
        <>
          <DataTable dense rows={data.rows} rowKey={(r) => r.id}
            columns={[
              { key: 'at', label: 'When', render: (r) => <span className="nowrap">{fmtDateTime(r.at)}</span> },
              { key: 'actor', label: 'User', render: (r) => <span className="primary-cell">{r.actor}</span> },
              { key: 'action', label: 'Action', render: (r) => <code style={{ fontSize: 11 }}>{r.action}</code> },
              { key: 'entity', label: 'Entity', render: (r) => <span className="muted">{r.entity}{r.entityId ? `#${r.entityId}` : ''}</span> },
              { key: 'detail', label: 'Details', render: (r) => <span className="muted" style={{ userSelect: 'text', fontSize: 11 }}>{r.detail || ''}</span> }
            ]}
            empty={<Empty icon={<IconAudit size={34} />} title="No audit events match" hint="Every create, update, status change, void and security event lands here." />} />
          <div className="table-foot">
            <span className="tabular">{data.total} events</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
              <span className="muted tabular" style={{ alignSelf: 'center' }}>{offset + 1}–{Math.min(offset + LIMIT, data.total)}</span>
              <Button size="sm" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>Next</Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
