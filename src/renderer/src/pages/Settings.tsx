import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Button, Badge, Field, Input, Select, Textarea, Tabs, toast, Dialog } from '../components/ui';
import { IconSettings } from '../icons';
import type { ClinicProfile } from '@shared/types';

type TabId = 'clinic' | 'methods' | 'preferences' | 'data';

export function SettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<TabId>('clinic');
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [methods, setMethods] = useState<Array<{ id: number; name: string; active: boolean; builtIn: boolean }>>([]);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s, m] = await Promise.all([
        api<ClinicProfile>('clinic.get'),
        api<Record<string, unknown>>('settings.get'),
        api<Array<{ id: number; name: string; active: boolean; builtIn: boolean }>>('paymentMethods.list', { includeInactive: true })
      ]);
      setProfile(p); setSettings(s); setMethods(m);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load settings.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveClinic = async () => {
    if (!profile) return;
    try {
      await api('clinic.update', { patch: profile });
      toast.success('Clinic profile saved.');
      setDirty(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed.'); }
  };

  const savePreferences = async (patch: Record<string, unknown>) => {
    try {
      const next = await api<Record<string, unknown>>('settings.update', { patch });
      setSettings(next);
      toast.success('Preference saved.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed.'); }
  };

  const setLogo = async () => {
    const picked = await api<{ path: string | null }>('dialog.pickFile', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!picked.path) return;
    try {
      await api('clinic.setLogo', { path: picked.path });
      toast.success('Logo updated — it now appears on documents.');
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Logo failed.'); }
  };

  const tabs = [
    { id: 'clinic', label: 'Clinic Profile' },
    { id: 'methods', label: 'Payment Methods' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'data', label: 'Import / Export' }
  ];

  if (error) return <div className="alert-strip danger">{error}</div>;
  if (!profile || !settings) return <div className="skeleton" style={{ height: 400 }} />;

  const upd = (k: keyof ClinicProfile, v: string) => { setProfile({ ...profile, [k]: v }); setDirty(true); };

  return (
    <div>
      <div className="page-head">
        <div><h1>Settings</h1><div className="sub">Clinic identity, payment methods, preferences and data interchange. Everything is stored locally in the database.</div></div>
        {tab === 'clinic' && dirty && can('settings.update') && <Button variant="primary" onClick={() => void saveClinic()}>Save clinic profile</Button>}
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />

      {tab === 'clinic' && (
        <div className="grid-2">
          <div className="card"><div className="card-head"><h3>Identity</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field label="Clinic name" required><Input value={profile.name} onChange={(e) => upd('name', e.target.value)} disabled={!can('settings.update')} /></Field>
              <Field label="Legal / trading name"><Input value={profile.legalName} onChange={(e) => upd('legalName', e.target.value)} disabled={!can('settings.update')} /></Field>
              <Field label="Address"><Textarea rows={2} value={profile.address} onChange={(e) => upd('address', e.target.value)} disabled={!can('settings.update')} /></Field>
              <div className="form-grid">
                <Field label="Phone" width={6}><Input value={profile.phone} onChange={(e) => upd('phone', e.target.value)} disabled={!can('settings.update')} /></Field>
                <Field label="Email" width={6}><Input value={profile.email} onChange={(e) => upd('email', e.target.value)} disabled={!can('settings.update')} /></Field>
                <Field label="Website" width={6}><Input value={profile.website} onChange={(e) => upd('website', e.target.value)} disabled={!can('settings.update')} /></Field>
                <Field label="Registration no." width={6}><Input value={profile.registrationNo} onChange={(e) => upd('registrationNo', e.target.value)} disabled={!can('settings.update')} /></Field>
              </div>
              <Field label="Professional info" hint="shown under the clinic name on prescriptions"><Input value={profile.professionalInfo} onChange={(e) => upd('professionalInfo', e.target.value)} disabled={!can('settings.update')} /></Field>
            </div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card"><div className="card-head"><h3>Documents</h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Field label="Header note" hint="top of invoices/statements"><Textarea rows={2} value={profile.documentHeaderNote} onChange={(e) => upd('documentHeaderNote', e.target.value)} disabled={!can('settings.update')} /></Field>
                <Field label="Footer note" hint="bottom of all documents"><Textarea rows={2} value={profile.documentFooterNote} onChange={(e) => upd('documentFooterNote', e.target.value)} disabled={!can('settings.update')} /></Field>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <Button size="sm" onClick={() => void setLogo()} disabled={!can('settings.update')}>{profile.logoPath ? 'Change logo' : 'Set logo'}</Button>
                  {profile.logoPath && <Badge tone="success">logo set</Badge>}
                  {!profile.logoPath && <span className="muted" style={{ fontSize: 12 }}>PNG/JPG up to 2 MB — appears on printed documents.</span>}
                </div>
              </div></div>
            <div className="card"><div className="card-head"><h3>Locale & currency</h3></div>
              <div className="card-body">
                <dl className="kv-list">
                  <dt>Timezone</dt><dd>{profile.timezone} (Asia/Dhaka)</dd>
                  <dt>Currency</dt><dd>{profile.currencyCode} ({profile.currencySymbol}) — Bangladeshi Taka</dd>
                  <dt>Date format</dt><dd>{profile.dateFormat}</dd>
                </dl>
                <div className="grid-2" style={{ marginTop: 8 }}>
                  <Field label="Currency symbol" width={6}><Input value={profile.currencySymbol} onChange={(e) => upd('currencySymbol', e.target.value)} disabled={!can('settings.update')} /></Field>
                  <Field label="Date format" width={6} hint="e.g. DD MMM YYYY"><Input value={profile.dateFormat} onChange={(e) => upd('dateFormat', e.target.value)} disabled={!can('settings.update')} /></Field>
                </div>
              </div></div>
          </div>
        </div>
      )}

      {tab === 'methods' && <MethodsTab methods={methods} canEdit={can('settings.update')} onChanged={load} />}

      {tab === 'preferences' && (
        <div className="grid-2">
          <div className="card"><div className="card-head"><h3>Security</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Auto-lock after inactivity (minutes)" hint="the lock screen requires the signed-in user's password">
                <Input type="number" min={1} max={120} value={String(settings.lockTimeoutMinutes ?? 10)}
                  disabled={!can('settings.update')}
                  onChange={(e) => setSettings({ ...settings, lockTimeoutMinutes: Number(e.target.value) })} />
              </Field>
              {can('settings.update') && <div><Button size="sm" onClick={() => void savePreferences({ lockTimeoutMinutes: Math.max(1, Math.min(120, Number(settings.lockTimeoutMinutes) || 10)) })}>Save</Button></div>}
            </div></div>
          <div className="card"><div className="card-head"><h3>Attachments</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Maximum attachment size (MB)">
                <Input type="number" min={1} max={200} value={String(settings.attachmentMaxMb ?? 25)}
                  disabled={!can('settings.update')}
                  onChange={(e) => setSettings({ ...settings, attachmentMaxMb: Number(e.target.value) })} />
              </Field>
              {can('settings.update') && <div><Button size="sm" onClick={() => void savePreferences({ attachmentMaxMb: Math.max(1, Math.min(200, Number(settings.attachmentMaxMb) || 25)) })}>Save</Button></div>}
            </div></div>
        </div>
      )}

      {tab === 'data' && <DataTab canImport={can('data.import')} canExport={can('data.export')} />}
    </div>
  );
}

function MethodsTab({ methods, canEdit, onChanged }: { methods: Array<{ id: number; name: string; active: boolean; builtIn: boolean }>; canEdit: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-head"><h3>Payment methods</h3>{canEdit && <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add method</Button>}</div>
      <div className="card-body" style={{ padding: 0 }}>
        <table className="data dense">
          <thead><tr><th>Method</th><th>Status</th><th style={{ width: 120 }}></th></tr></thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.id}>
                <td><span className="primary-cell">{m.name}</span>{m.builtIn && <span className="muted"> (built-in)</span>}</td>
                <td>{m.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">hidden</Badge>}</td>
                <td>
                  {canEdit && (
                    <Button size="sm" variant={m.active ? 'danger-soft' : 'secondary'} onClick={async () => {
                      await api('paymentMethods.setActive', { id: m.id, active: !m.active });
                      onChanged();
                    }}>{m.active ? 'Hide' : 'Show'}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Dialog title="Add payment method" size="sm" onClose={() => setAdding(false)} footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" onClick={async () => {
              setError('');
              try {
                await api('paymentMethods.add', { name });
                toast.success('Payment method added.');
                setAdding(false); setName('');
                onChanged();
              } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the method.'); }
            }}>Add</Button>
          </>
        }>
          {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
          <Field label="Method name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. City Bank POS" /></Field>
        </Dialog>
      )}
    </div>
  );
}

function DataTab({ canImport, canExport }: { canImport: boolean; canExport: boolean }) {
  const [importResult, setImportResult] = useState<{ inserted: number; skippedDuplicates: number; failed: Array<{ line: number; reason: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  const doImport = async (allowDuplicates: boolean) => {
    const picked = await api<{ path: string | null }>('dialog.pickFile', { filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!picked.path) return;
    setBusy(true);
    try {
      const res = await api<{ inserted: number; skippedDuplicates: number; failed: Array<{ line: number; reason: string }> }>('data.importPatients', { path: picked.path, allowDuplicates });
      setImportResult(res);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setBusy(false); }
  };

  const doExportPatients = async () => {
    const picked = await api<{ path: string | null }>('dialog.saveFile', { defaultPath: 'patients-export.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!picked.path) return;
    setBusy(true);
    try {
      const res = await api<{ rows: number }>('data.exportPatients', { path: picked.path, includeArchived: true });
      toast.success(`Exported ${res.rows} patients (including archived) to CSV.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid-2">
      <div className="card"><div className="card-head"><h3>Import patients (CSV)</h3></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Columns: fullName, preferredName, sex, dob, phone, alternatePhone, email, address, occupation, allergies, medicalHistory, notes.
            Each row gets a new unique Patient Code — codes in the file are never reused. Rows that fail validation are <b>reported explicitly with line numbers</b>;
            nothing is silently dropped or truncated. Possible duplicates are skipped unless you override.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" busy={busy} disabled={!canImport} onClick={() => void doImport(false)}>Import (skip duplicates)</Button>
            <Button busy={busy} disabled={!canImport} onClick={() => void doImport(true)}>Import (override duplicates)</Button>
          </div>
          {importResult && (
            <div className="alert-strip ok" style={{ userSelect: 'text' }}>
              <span>
                <b>Import complete:</b> {importResult.inserted} inserted · {importResult.skippedDuplicates} skipped as duplicates · {importResult.failed.length} failed.
                {importResult.failed.length > 0 && (
                  <>
                    <br />Failed lines:
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {importResult.failed.slice(0, 20).map((f, i) => <li key={i}>line {f.line}: {f.reason}</li>)}
                      {importResult.failed.length > 20 && <li>…and {importResult.failed.length - 20} more (all were rejected, none partially imported)</li>}
                    </ul>
                  </>
                )}
              </span>
            </div>
          )}
        </div></div>
      <div className="card"><div className="card-head"><h3>Export patients (CSV)</h3></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Exports the complete patient directory (including archived rows) with every exported column written out — no pagination, no silent truncation.
            Patient Codes are included so exported data can be reconciled against the system.
          </p>
          <div><Button variant="primary" busy={busy} disabled={!canExport} onClick={() => void doExportPatients()}>Export patients…</Button></div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>For full-fidelity backups (all entities + attachments), use <b>Backup & Restore</b> instead — CSV is an interchange format, not a backup.</p>
        </div></div>
    </div>
  );
}
