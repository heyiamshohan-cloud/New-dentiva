import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { useSession } from '../session';
import { Button, DataTable, Badge, Empty, Dialog, toast, ConfirmDialog } from '../components/ui';
import { IconBackup, IconPlus } from '../icons';
import type { BackupInfo } from '@shared/types';

interface InspectResult { ok: boolean; manifest: { dbVersion?: number; appVersion?: string; createdAt?: string; counts?: Record<string, number> } | null; problems: string[] }

export function BackupPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [inspect, setInspect] = useState<{ path: string; result: InspectResult } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [busyRestore, setBusyRestore] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<BackupInfo[]>('backup.list'));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to list backups.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const picked = await api<{ path: string | null }>('dialog.pickDir', { title: 'Choose the folder for this backup' });
      if (!picked.path) { setCreating(false); return; }
      const info = await api<BackupInfo>('backup.create', { targetDir: picked.path });
      toast.success(`Backup created and verified: ${info.fileName}`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backup failed.');
    } finally { setCreating(false); }
  };

  const inspectFile = async () => {
    const picked = await api<{ path: string | null }>('dialog.pickFile', { filters: [{ name: 'Dentiva backup', extensions: ['zip'] }] });
    if (!picked.path) return;
    try {
      const result = await api<InspectResult>('backup.inspect', { path: picked.path });
      setInspect({ path: picked.path, result });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Inspection failed.');
    }
  };

  const doRestore = async () => {
    if (!restoring) return;
    setBusyRestore(true);
    try {
      const res = await api<{ restoredCounts: Record<string, number> }>('backup.restore', { path: restoring });
      const total = Object.values(res.restoredCounts).reduce((a, b) => a + b, 0);
      toast.success(`Restore completed and verified — ${total} records reloaded. The app will reload its state.`);
      setRestoring(null);
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed — nothing was changed.');
    } finally { setBusyRestore(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Backup & Restore</h1>
          <div className="sub">Backups are SHA-256 checksummed and verified. A restore only swaps the data after the backup passes integrity — no partial restores.</div>
        </div>
        {can('backup.create') && <Button variant="primary" icon={<IconPlus size={14} />} busy={creating} onClick={() => void create()}>Create backup</Button>}
        {can('backup.restore') && <Button onClick={() => void inspectFile()}>Inspect / restore a backup…</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      {!rows && !error && <div className="skeleton" style={{ height: 300 }} />}
      {rows && (
        <DataTable rows={rows} rowKey={(b) => b.id}
          columns={[
            { key: 'fileName', label: 'Backup', render: (b) => <span className="primary-cell">{b.fileName}</span> },
            { key: 'createdAt', label: 'Created', render: (b) => fmtDateTime(b.createdAt) },
            { key: 'sizeBytes', label: 'Size', num: true, render: (b) => `${(b.sizeBytes / 1024 / 1024).toFixed(1)} MB` },
            { key: 'records', label: 'Records', num: true, render: (b) => <span className="tabular">{Object.values(b.counts ?? {}).reduce((a, n) => a + n, 0)}</span> },
            { key: 'dbVersion', label: 'DB v', num: true },
            { key: 'sha256', label: 'Checksum', render: (b) => <code style={{ fontSize: 10 }} title={b.sha256}>{b.sha256.slice(0, 12)}…</code> },
            {
              key: 'actions', label: '', render: (b) => can('backup.restore') ? (
                <Button size="sm" variant="danger-soft" onClick={() => setRestoring(b.path)}>Restore…</Button>
              ) : null
            }
          ]}
          empty={<Empty icon={<IconBackup size={34} />} title="No backups yet" hint="Create the first backup now — it includes the database plus all patient attachments, verified end-to-end." />} />
      )}

      {inspect && (
        <Dialog title="Backup inspection" size="md" onClose={() => setInspect(null)} footer={
          <>
            <Button onClick={() => setInspect(null)}>Close</Button>
            {inspect.result.ok && can('backup.restore') && (
              <Button variant="danger" onClick={() => { setRestoring(inspect.path); setInspect(null); }}>Restore this backup…</Button>
            )}
          </>
        }>
          {inspect.result.ok ? (
            <>
              <div className="alert-strip ok" style={{ marginBottom: 12 }}><span>This backup passed integrity verification (manifest + checksums match).</span></div>
              <dl className="kv-list">
                <dt>File</dt><dd style={{ wordBreak: 'break-all', userSelect: 'text' }}>{inspect.path}</dd>
                <dt>Created</dt><dd>{inspect.result.manifest?.createdAt ? fmtDateTime(inspect.result.manifest.createdAt) : '—'}</dd>
                <dt>App version</dt><dd>{inspect.result.manifest?.appVersion ?? '—'}</dd>
                <dt>DB version</dt><dd>{inspect.result.manifest?.dbVersion ?? '—'}</dd>
                <dt>Record counts</dt>
                <dd style={{ userSelect: 'text' }}>
                  {Object.entries(inspect.result.manifest?.counts ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                </dd>
              </dl>
            </>
          ) : (
            <div className="alert-strip danger">
              <span><b>This backup is not valid.</b> It will not be restored. Problems: {inspect.result.problems.join('; ') || 'unknown'}</span>
            </div>
          )}
        </Dialog>
      )}

      {restoring && (
        <ConfirmDialog
          title="Restore backup"
          danger
          requireText="RESTORE"
          confirmLabel={busyRestore ? 'Restoring…' : 'Restore now'}
          message={
            <>
              <p>Restoring <b style={{ wordBreak: 'break-all' }}>{restoring}</b> replaces <b>all current clinic data</b> with the backup contents.</p>
              <p style={{ marginTop: 8 }}>The current data directory is preserved as a safety copy before the swap, and the restore is only committed after the copied database passes integrity checks. Type <b>RESTORE</b> to proceed.</p>
            </>
          }
          onCancel={() => !busyRestore && setRestoring(null)}
          onConfirm={() => void doRestore()}
        />
      )}
    </div>
  );
}
