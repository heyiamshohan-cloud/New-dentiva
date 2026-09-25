import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDateTime, todayLocalDate } from '../api';
import { useSession } from '../session';
import { Stat, Button, StatusBadge, Empty } from '../components/ui';
import { Money } from '../components/ui';
import { IconPatients, IconCalendar, IconQueue, IconPlus } from '../icons';

interface DashboardData {
  today: string;
  appointmentsToday: Array<{ id: number; number: string; startAt: string; endAt: string; status: string; patientName: string; patientCode: string; dentistName: string }>;
  queue: { waiting: number; called: number; inProgress: number; completedToday: number };
  visitsToday: number;
  revenueToday: number;
  paymentsToday: number;
  outstandingTotal: number;
  followUpsDue: number;
  lowStockCount: number;
  expiringCount: number;
  newPatientsThisWeek: number;
  recentActivity: Array<{ at: string; actor: string; action: string; entity: string; entityId: string }>;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { can } = useSession();

  const load = async () => {
    try {
      setData(await api<DashboardData>('dashboard.overview'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    }
  };
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  if (error) return <div className="alert-strip danger">{error} <Button size="sm" onClick={() => void load()}>Retry</Button></div>;
  if (!data) {
    return (
      <div>
        <div className="stat-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 86 }} />)}</div>
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{greeting}</h1>
          <div className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <div className="page-actions">
          {can('patients.create') && <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate('/patients?new=1')}>New patient</Button>}
          {can('appointments.create') && <Button icon={<IconCalendar size={15} />} onClick={() => navigate('/appointments?new=1')}>New appointment</Button>}
          {can('queue.manage') && <Button icon={<IconQueue size={15} />} onClick={() => navigate('/queue')}>Queue</Button>}
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Appointments today" value={data.appointmentsToday.length} tone="accent" sub={`${data.appointmentsToday.filter((a) => !['completed', 'cancelled', 'no_show'].includes(a.status)).length} upcoming`} />
        <Stat label="In queue now" value={data.queue.waiting + data.queue.called + data.queue.inProgress} tone="accent" sub={`${data.queue.waiting} waiting · ${data.queue.inProgress} in progress`} />
        <Stat label="Visits today" value={data.visitsToday} tone="good" />
        {can('accounting.read') || can('invoices.read') ? <Stat label="Payments today" money value={<Money value={data.paymentsToday} />} tone="good" sub={`billed ${''}`} /> : null}
        {can('invoices.read') && <Stat label="Outstanding balances" money value={<Money value={data.outstandingTotal} />} tone={data.outstandingTotal > 0 ? 'warn' : 'good'} />}
        {can('visits.read') && <Stat label="Follow-ups due" value={data.followUpsDue} tone={data.followUpsDue > 0 ? 'warn' : undefined} sub="patients to recall" />}
        {can('inventory.read') && <Stat label="Stock alerts" value={data.lowStockCount} tone={data.lowStockCount > 0 ? 'bad' : undefined} sub={`${data.expiringCount} expiring soon`} />}
        {can('patients.read') && <Stat label="New patients (7 days)" value={data.newPatientsThisWeek} />}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Today’s appointments</h3><Button size="sm" onClick={() => navigate('/appointments')}>View all</Button></div>
          <div className="card-body" style={{ padding: 0 }}>
            {data.appointmentsToday.length === 0 ? (
              <Empty icon={<IconCalendar size={30} />} title="No appointments today" hint="Schedule the first appointment of the day to see it here."
                action={can('appointments.create') ? <Button variant="primary" size="sm" onClick={() => navigate('/appointments?new=1')}><IconPlus size={13} /> New appointment</Button> : undefined} />
            ) : (
              data.appointmentsToday.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--divider)' }}>
                  <div className="tabular" style={{ fontWeight: 700, color: 'var(--den-800)', width: 66 }}>{new Date(a.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{a.patientName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.patientCode}{a.dentistName ? ` · ${a.dentistName}` : ''}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Recent activity</h3>{can('audit.read') && <Button size="sm" onClick={() => navigate('/audit')}>Audit log</Button>}</div>
          <div className="card-body" style={{ padding: 0 }}>
            {data.recentActivity.length === 0 ? (
              <Empty icon={<IconPatients size={30} />} title="No activity yet" hint={`Create your first patient to start building the clinic's records. Today is ${todayLocalDate()}.`} />
            ) : (
              data.recentActivity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 16px', borderBottom: '1px solid var(--divider)', fontSize: 12 }}>
                  <span className="muted nowrap tabular">{fmtDateTime(a.at)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{a.actor}</b> · {a.action}
                  </span>
                  <span className="muted">{a.entity}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
