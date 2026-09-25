import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Button, Badge, Empty, DataTable, toast } from '../components/ui';
import { IconDiagnostics, IconCheck } from '../icons';

interface DiagnosticIssue { area: string; severity: 'error' | 'warning'; message: string }
interface DiagResult { ok: boolean; issues: DiagnosticIssue[]; checkedAt: string }

export function DiagnosticsPage() {
  const [result, setResult] = useState<DiagResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ name: string; version: string; dataDir: string } | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setError('');
    try {
      setResult(await api<DiagResult>('diagnostics.run'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Diagnostics failed to run.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void run();
    api<{ name: string; version: string; dataDir: string }>('app.info').then(setInfo).catch(() => setInfo(null));
  }, [run]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Diagnostics</h1><div className="sub">Integrity probe of the database, foreign keys, counters, attachments and settings. Read-only — it changes nothing.</div></div>
        <Button variant="primary" busy={busy} onClick={() => void run()}>Run diagnostics</Button>
      </div>

      {info && (
        <dl className="kv-list" style={{ marginBottom: 14 }}>
          <dt>Application</dt><dd>{info.name} v{info.version}</dd>
          <dt>Data directory</dt><dd style={{ wordBreak: 'break-all', userSelect: 'text' }}>{info.dataDir}</dd>
        </dl>
      )}
      {error && <div className="alert-strip danger">{error}</div>}
      {busy && <div className="skeleton" style={{ height: 200 }} />}

      {result && !busy && (
        <>
          <div className={`alert-strip ${result.ok ? 'ok' : 'danger'}`} style={{ marginBottom: 14 }}>
            <span>
              {result.ok
                ? <>All checks passed — the database is structurally sound and every probe came back clean. Checked {fmtDateTime(result.checkedAt)}.</>
                : <><b>{result.issues.filter((i) => i.severity === 'error').length} errors, {result.issues.filter((i) => i.severity === 'warning').length} warnings</b> — review the findings below before continuing daily work. Checked {fmtDateTime(result.checkedAt)}.</>}
            </span>
          </div>
          {result.issues.length === 0 && (
            <Empty icon={<IconCheck size={34} />} title="No findings" hint="Integrity check, foreign-key audit, counter sanity, attachment hashes and settings were all verified." />
          )}
          {result.issues.length > 0 && (
            <DataTable dense rows={result.issues} rowKey={(i, idx) => idx}
              columns={[
                { key: 'severity', label: 'Severity', render: (i) => <Badge tone={i.severity === 'error' ? 'danger' : 'warning'}>{i.severity}</Badge> },
                { key: 'area', label: 'Area', render: (i) => <span className="primary-cell">{i.area}</span> },
                { key: 'message', label: 'Finding', render: (i) => <span style={{ userSelect: 'text' }}>{i.message}</span> }
              ]} />
          )}
          <div style={{ marginTop: 12 }}>
            <Button size="sm" onClick={() => {
              const text = [`Dentiva Pro diagnostics — ${result.checkedAt}`, ...(result.issues.length ? result.issues.map((i) => `[${i.severity}] ${i.area}: ${i.message}`) : ['All checks passed.'])].join('\n');
              void navigator.clipboard.writeText(text).then(() => toast.success('Diagnostics copied to clipboard.')).catch(() => toast.error('Clipboard unavailable.'));
            }}>Copy report</Button>
          </div>
        </>
      )}
    </div>
  );
}
