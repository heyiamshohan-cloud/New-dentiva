import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { useSession } from '../session';
import { Button, Badge, DataTable, Empty, Input, Select, Dialog, Field, Textarea, Tabs, toast } from '../components/ui';
import { IconStaff, IconPlus } from '../icons';
import type { Role } from '@shared/types';

type TabId = 'users' | 'dentists' | 'staff';

interface UserRow { id: number; username: string; displayName: string; role: Role; active: boolean; lastLoginAt: string | null }
interface DentistRow { id: number; name: string; credentials: string; phone: string; email: string; specialization: string; active: boolean }
interface StaffRow { id: number; name: string; phone: string; email: string; roleLabel: string; professionalInfo: string; notes: string; active: boolean }

const ROLE_LABEL: Record<Role, string> = {
  administrator: 'Administrator', dentist: 'Dentist', assistant: 'Assistant', receptionist: 'Receptionist', accountant: 'Accountant'
};

export function StaffPage() {
  const { can, user } = useSession();
  const [tab, setTab] = useState<TabId>(can('users.manage') ? 'users' : 'dentists');
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [dentists, setDentists] = useState<DentistRow[] | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [pwUser, setPwUser] = useState<UserRow | null>(null);
  const [editingDentist, setEditingDentist] = useState<DentistRow | null>(null);
  const [creatingDentist, setCreatingDentist] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffRow | null>(null);
  const [creatingStaff, setCreatingStaff] = useState(false);

  const load = useCallback(async () => {
    try {
      const jobs: Array<Promise<void>> = [];
      if (can('users.manage')) jobs.push(api<UserRow[]>('users.list').then((u) => setUsers(u)));
      if (can('staff.read')) {
        jobs.push(api<DentistRow[]>('dentists.list', { includeInactive: true }).then((d) => setDentists(d)));
        jobs.push(api<StaffRow[]>('staff.list', { includeInactive: true }).then((s) => setStaff(s)));
      }
      await Promise.all(jobs);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load staff data.'); }
  }, [can]);
  useEffect(() => { void load(); }, [load]);

  const tabs = [
    ...(can('users.manage') ? [{ id: 'users', label: `Users (${users?.length ?? 0})` }] : []),
    { id: 'dentists', label: `Dentists (${dentists?.filter((d) => d.active).length ?? 0})` },
    { id: 'staff', label: `Staff (${staff?.filter((s) => s.active).length ?? 0})` }
  ];

  return (
    <div>
      <div className="page-head">
        <div><h1>Staff & Users</h1><div className="sub">Login accounts with roles (RBAC is enforced in the backend), dentist profiles, and clinic staff records.</div></div>
        {tab === 'users' && can('users.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreatingUser(true)}>New user</Button>}
        {tab === 'dentists' && can('staff.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreatingDentist(true)}>New dentist</Button>}
        {tab === 'staff' && can('staff.manage') && <Button variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreatingStaff(true)}>New staff member</Button>}
      </div>

      {error && <div className="alert-strip danger">{error}</div>}
      <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />

      {tab === 'users' && (
        <DataTable rows={users ?? []} rowKey={(u) => u.id}
          onRowClick={(u) => can('users.manage') && setEditingUser(u)}
          columns={[
            { key: 'username', label: 'Username', render: (u) => <span className="tabular primary-cell">{u.username}</span> },
            { key: 'displayName', label: 'Display name' },
            { key: 'role', label: 'Role', render: (u) => <Badge tone={u.role === 'administrator' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge> },
            { key: 'lastLoginAt', label: 'Last login', render: (u) => u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="muted">never</span> },
            { key: 'active', label: 'Status', render: (u) => u.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">disabled</Badge> },
            {
              key: 'actions', label: '', render: (u) => can('users.manage') ? (
                <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => setPwUser(u)}>Reset password</Button>
                </span>
              ) : null
            }
          ]}
          empty={<Empty icon={<IconStaff size={34} />} title="No user accounts" hint="Create accounts for each person; roles decide exactly what they can do." />} />
      )}

      {tab === 'dentists' && (
        <DataTable rows={dentists ?? []} rowKey={(d) => d.id}
          onRowClick={(d) => can('staff.manage') && setEditingDentist(d)}
          columns={[
            { key: 'name', label: 'Name', render: (d) => <span className="primary-cell">{d.name}</span> },
            { key: 'credentials', label: 'Credentials', render: (d) => d.credentials || '—' },
            { key: 'specialization', label: 'Specialization', render: (d) => d.specialization || '—' },
            { key: 'phone', label: 'Phone', render: (d) => d.phone || '—' },
            { key: 'active', label: 'Status', render: (d) => d.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge> }
          ]}
          empty={<Empty icon={<IconStaff size={34} />} title="No dentists on record" hint="Dentist profiles sign prescriptions and carry appointment schedules." />} />
      )}

      {tab === 'staff' && (
        <DataTable rows={staff ?? []} rowKey={(s) => s.id}
          onRowClick={(s) => can('staff.manage') && setEditingStaff(s)}
          columns={[
            { key: 'name', label: 'Name', render: (s) => <span className="primary-cell">{s.name}</span> },
            { key: 'roleLabel', label: 'Role', render: (s) => s.roleLabel || '—' },
            { key: 'phone', label: 'Phone', render: (s) => s.phone || '—' },
            { key: 'email', label: 'Email', render: (s) => s.email || '—' },
            { key: 'active', label: 'Status', render: (s) => s.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge> }
          ]}
          empty={<Empty icon={<IconStaff size={34} />} title="No staff records" hint="Keep receptionists, assistants and other team members on record." />} />
      )}

      {(creatingUser || editingUser) && <UserDialog row={editingUser} meId={user?.userId} onClose={() => { setCreatingUser(false); setEditingUser(null); }} onSaved={() => { setCreatingUser(false); setEditingUser(null); void load(); }} />}
      {pwUser && <PasswordDialog userRow={pwUser} onClose={() => setPwUser(null)} />}
      {(creatingDentist || editingDentist) && <DentistDialog row={editingDentist} onClose={() => { setCreatingDentist(false); setEditingDentist(null); }} onSaved={() => { setCreatingDentist(false); setEditingDentist(null); void load(); }} />}
      {(creatingStaff || editingStaff) && <StaffDialog row={editingStaff} onClose={() => { setCreatingStaff(false); setEditingStaff(null); }} onSaved={() => { setCreatingStaff(false); setEditingStaff(null); void load(); }} />}
    </div>
  );
}

function UserDialog({ row, meId, onClose, onSaved }: { row: UserRow | null; meId?: number; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(row?.username ?? '');
  const [displayName, setDisplayName] = useState(row?.displayName ?? '');
  const [role, setRole] = useState<Role>(row?.role ?? 'receptionist');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (row) {
        await api('users.update', { id: row.id, patch: { displayName, role } });
        toast.success('User updated.');
      } else {
        if (!username.trim() || password.length < 8) { setBusy(false); setError('A username and a password of at least 8 characters are required.'); return; }
        await api('users.create', { username, displayName, role, password });
        toast.success('User account created.');
      }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={row ? `Edit user ${row.username}` : 'New user'} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {row && row.id !== meId && (
          <Button variant={row.active ? 'danger-soft' : 'secondary'} onClick={async () => {
            await api('users.update', { id: row.id, patch: { active: !row.active } });
            toast.success(row.active ? 'User disabled.' : 'User enabled.');
            onSaved();
          }}>{row.active ? 'Disable' : 'Enable'}</Button>
        )}
        <Button variant="primary" busy={busy} onClick={() => void save()}>{row ? 'Save changes' : 'Create user'}</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      {!row && <Field label="Username" required hint="lowercase, unique"><Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></Field>}
      <Field label="Display name" required><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <span className="hint">Backend enforces this role on every request — UI hiding is not the security control.</span>
      </Field>
      {!row && <Field label="Password" required hint="minimum 8 characters"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
    </Dialog>
  );
}

function PasswordDialog({ userRow, onClose }: { userRow: UserRow; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await api('auth.changePassword', { userId: userRow.id, newPassword: password });
      toast.success(`Password reset for ${userRow.username}.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={`Reset password — ${userRow.username}`} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>Reset password</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <Field label="New password" required hint="minimum 8 characters"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
      <Field label="Confirm password" required><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
    </Dialog>
  );
}

function DentistDialog({ row, onClose, onSaved }: { row: DentistRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [credentials, setCredentials] = useState(row?.credentials ?? '');
  const [specialization, setSpecialization] = useState(row?.specialization ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      if (row) await api('dentists.update', { id: row.id, patch: { name, credentials, specialization, phone, email } });
      else await api('dentists.create', { input: { name, credentials, specialization, phone, email } });
      toast.success(row ? 'Dentist updated.' : 'Dentist added.');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={row ? `Edit ${row.name}` : 'New dentist'} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {row && <Button variant={row.active ? 'danger-soft' : 'secondary'} onClick={async () => { await api('dentists.update', { id: row.id, patch: { active: !row.active } }); toast.success(row.active ? 'Dentist deactivated.' : 'Dentist reactivated.'); onSaved(); }}>{row.active ? 'Deactivate' : 'Reactivate'}</Button>}
        <Button variant="primary" busy={busy} onClick={() => void save()}>{row ? 'Save changes' : 'Add dentist'}</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <Field label="Full name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Dr. Jane Rahman" /></Field>
      <div className="form-grid">
        <Field label="Credentials" width={6} hint="shown on prescriptions, e.g. BDS (DU), FCPS"><Input value={credentials} onChange={(e) => setCredentials(e.target.value)} /></Field>
        <Field label="Specialization" width={6}><Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Endodontics" /></Field>
        <Field label="Phone" width={6}><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email" width={6}><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function StaffDialog({ row, onClose, onSaved }: { row: StaffRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [roleLabel, setRoleLabel] = useState(row?.roleLabel ?? 'Receptionist');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [professionalInfo, setProfessionalInfo] = useState(row?.professionalInfo ?? '');
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      const input = { name, roleLabel, phone, email, professionalInfo, notes };
      if (row) await api('staff.update', { id: row.id, patch: input });
      else await api('staff.create', { input });
      toast.success(row ? 'Staff member updated.' : 'Staff member added.');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={row ? `Edit ${row.name}` : 'New staff member'} size="sm" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {row && <Button variant={row.active ? 'danger-soft' : 'secondary'} onClick={async () => { await api('staff.update', { id: row.id, patch: { active: !row.active } }); toast.success(row.active ? 'Marked inactive.' : 'Marked active.'); onSaved(); }}>{row.active ? 'Deactivate' : 'Reactivate'}</Button>}
        <Button variant="primary" busy={busy} onClick={() => void save()}>{row ? 'Save changes' : 'Add member'}</Button>
      </>
    }>
      {error && <div className="dlg-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="form-grid">
        <Field label="Full name" required width={6}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Role label" width={6}><Input value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="e.g. Assistant" /></Field>
        <Field label="Phone" width={6}><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email" width={6}><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      <Field label="Professional info"><Input value={professionalInfo} onChange={(e) => setProfessionalInfo(e.target.value)} /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Dialog>
  );
}
