import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { api } from '../api';
import { LogoMark, NAV_ICONS, IconSearch, IconBell, IconLock, IconChevronD } from '../icons';
import { Dropdown } from './ui';
import type { Permission } from '@shared/permissions';

export interface NavDef {
  path: string;
  label: string;
  icon: string;
  perm?: Permission;
  group: string;
}

export const NAV: NavDef[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', group: 'Practice' },
  { path: '/patients', label: 'Patients', icon: 'patients', perm: 'patients.read', group: 'Practice' },
  { path: '/appointments', label: 'Appointments', icon: 'appointments', perm: 'appointments.read', group: 'Practice' },
  { path: '/queue', label: 'Queue', icon: 'queue', perm: 'queue.read', group: 'Practice' },
  { path: '/treatments', label: 'Treatments', icon: 'treatments', perm: 'treatments.read', group: 'Clinical' },
  { path: '/prescriptions', label: 'Prescriptions', icon: 'prescriptions', perm: 'prescriptions.read', group: 'Clinical' },
  { path: '/invoices', label: 'Invoices', icon: 'invoices', perm: 'invoices.read', group: 'Billing' },
  { path: '/payments', label: 'Payments & Receipts', icon: 'payments', perm: 'payments.read', group: 'Billing' },
  { path: '/inventory', label: 'Inventory', icon: 'inventory', perm: 'inventory.read', group: 'Billing' },
  { path: '/accounting', label: 'Accounting', icon: 'accounting', perm: 'accounting.read', group: 'Billing' },
  { path: '/reports', label: 'Reports', icon: 'reports', perm: 'reports.read', group: 'Administration' },
  { path: '/staff', label: 'Staff & Users', icon: 'staff', perm: 'staff.read', group: 'Administration' },
  { path: '/audit', label: 'Audit Log', icon: 'audit', perm: 'audit.read', group: 'Administration' },
  { path: '/backup', label: 'Backup & Restore', icon: 'backup', perm: 'backup.create', group: 'Administration' },
  { path: '/diagnostics', label: 'Diagnostics', icon: 'diagnostics', perm: 'diagnostics.read', group: 'Administration' },
  { path: '/settings', label: 'Settings', icon: 'settings', perm: 'settings.read', group: 'Administration' }
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, clinicName, can, lock, signOut } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const groups = ['Practice', 'Clinical', 'Billing', 'Administration'];

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <LogoMark size={30} />
          {!collapsed && <div className="word">Dentiva<small>PRO</small></div>}
        </div>
        <nav className="nav">
          {groups.map((g) => {
            const items = NAV.filter((n) => n.group === g && (!n.perm || can(n.perm)));
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="group-label">{collapsed ? '·' : g}</div>
                {items.map((n) => {
                  const Icon = NAV_ICONS[n.icon];
                  return (
                    <NavLink key={n.path} to={n.path} end={n.path === '/'} title={n.label}
                      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                      <Icon size={17} />
                      <span className="label">{n.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="foot">
          <button className="btn tertiary sm" onClick={() => setCollapsed(!collapsed)}>{collapsed ? '»' : '« Collapse'}</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="searchbox" role="button" tabIndex={0} onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
            onKeyDown={(e) => e.key === 'Enter' && window.dispatchEvent(new CustomEvent('open-command-palette'))}>
            <IconSearch size={15} />
            <span>Search patients, invoices, anything…</span>
            <kbd>Ctrl K</kbd>
          </div>
          <div className="spacer" />
          <div className="clinic" title={clinicName}>{clinicName}</div>
          <NotificationBell />
          <button className="icon-btn" title="Lock application" onClick={() => void lock()}><IconLock size={17} /></button>
          <Dropdown open={menuOpen} onToggle={setMenuOpen} align="right" width={230} trigger={
            <div className="user-chip" role="button" tabIndex={0}>
              <span className="avatar">{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</span>
              <span>
                <div className="name">{user?.displayName}</div>
                <div className="role">{user?.role}</div>
              </span>
              <IconChevronD size={14} />
            </div>
          }>
            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)' }}>
              Signed in as <b>{user?.username}</b>
            </div>
            <div className="sep" />
            <button onClick={() => { setMenuOpen(false); void lock(); }}><IconLock size={14} /> Lock application</button>
            <button onClick={() => { setMenuOpen(false); void signOut().then(() => navigate('/')); }}>Sign out</button>
          </Dropdown>
        </header>
        <main className="content"><div className="page">{children}</div></main>
      </div>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Array<{ id: number; type: string; title: string; body: string; read: boolean; createdAt: string }>>([]);

  const refresh = async () => {
    try {
      const c = await api<number>('notifications.refresh');
      setCount(c);
      const list = await api<typeof items>('notifications.list', { limit: 30 });
      setItems(list);
    } catch { /* surfaced via global error handling */ }
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <Dropdown open={open} onToggle={setOpen} align="right" width={360} trigger={
      <button className="icon-btn" title="Notifications">
        <IconBell size={17} />
        {count > 0 && <span className="dot">{count > 99 ? '99+' : count}</span>}
      </button>
    }>
      <div className="notif-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--divider)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
          <b style={{ fontSize: 13 }}>Notifications</b>
          <button className="btn tertiary sm" onClick={() => api('notifications.markAllRead').then(refresh)}>Mark all read</button>
        </div>
        {items.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>No notifications. Alerts appear here when real events need attention.</div>}
        {items.map((n) => (
          <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => { api('notifications.markRead', { id: n.id }).then(refresh); }}>
            <div className="t1">{n.title}</div>
            {n.body && <div className="t2">{n.body}</div>}
            <div className="t2" style={{ marginTop: 3 }}>{new Date(n.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
      </div>
    </Dropdown>
  );
}
