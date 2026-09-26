import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './session';
import { Shell } from './components/shell';
import { CommandPalette } from './components/CommandPalette';
import { LoginPage } from './pages/Login';
import { ActivationPage } from './pages/Activation';
import { SetupWizard } from './pages/Setup';
import { LockScreen } from './pages/Lock';
import { DashboardPage } from './pages/Dashboard';
import { PatientsPage } from './pages/Patients';
import { Patient360Page } from './pages/Patient360';
import { AppointmentsPage } from './pages/Appointments';
import { QueuePage } from './pages/Queue';
import { TreatmentsPage } from './pages/Treatments';
import { PrescriptionsPage } from './pages/Prescriptions';
import { InvoicesPage } from './pages/Invoices';
import { PaymentsPage } from './pages/Payments';
import { InventoryPage } from './pages/Inventory';
import { AccountingPage } from './pages/Accounting';
import { ReportsPage } from './pages/Reports';
import { StaffPage } from './pages/Staff';
import { AuditPage } from './pages/Audit';
import { BackupPage } from './pages/Backup';
import { SettingsPage } from './pages/Settings';
import { DiagnosticsPage } from './pages/Diagnostics';

export default function App() {
  const { status, locked } = useSession();

  if (status === 'booting') {
    return (
      <div className="center-screen">
        <div className="empty"><div className="skeleton" style={{ width: 220, height: 16 }} /></div>
      </div>
    );
  }
  if (status === 'activating') return <ActivationPage />;
  if (status === 'setup') return <SetupWizard />;
  if (status === 'signedOut') return <LoginPage />;

  return (
    <>
      <Shell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/patients/:id" element={<Patient360Page />} />
          <Route path="/appointments" element={<AppointmentsPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/treatments" element={<TreatmentsPage />} />
          <Route path="/prescriptions" element={<PrescriptionsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/accounting" element={<AccountingPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
      <CommandPalette />
      {locked && <LockScreen />}
    </>
  );
}
