import { contextBridge, ipcRenderer } from 'electron';

/**
 * Secure preload: the renderer gets a single audited invoke surface. No Node
 * APIs, no raw IpcRenderer, no channel enumeration beyond the allowlist.
 * Sandboxed + context-isolated (spec: Electron Security).
 */
const CHANNEL_ALLOWLIST = new Set([
  'auth.status', 'auth.login', 'auth.logout', 'auth.lock', 'auth.unlock', 'auth.changePassword',
  'activation.status', 'activation.activate',
  'setup.complete',
  'clinic.get', 'clinic.update', 'clinic.setLogo', 'clinic.logoDataUrl',
  'settings.get', 'settings.update',
  'users.list', 'users.create', 'users.update',
  'dentists.list', 'dentists.create', 'dentists.update',
  'staff.list', 'staff.create', 'staff.update',
  'paymentMethods.list', 'paymentMethods.add', 'paymentMethods.setActive',
  'patients.search', 'patients.select', 'patients.get', 'patients.duplicates', 'patients.create',
  'patients.update', 'patients.archive', 'patients.timeline', 'patients.financials', 'patients.summary360',
  'appointments.range', 'appointments.forPatient', 'appointments.create', 'appointments.update', 'appointments.setStatus',
  'queue.day', 'queue.add', 'queue.setStatus',
  'visits.get', 'visits.forPatient', 'visits.create', 'visits.update', 'visits.followUpsDue',
  'chart.get', 'chart.set', 'chart.setMany',
  'treatments.list', 'treatments.create', 'treatments.update',
  'plans.get', 'plans.forPatient', 'plans.create', 'plans.update', 'plans.setStatus', 'plans.setItemStatus',
  'prescriptions.get', 'prescriptions.list', 'prescriptions.forPatient', 'prescriptions.create',
  'invoices.get', 'invoices.list', 'invoices.create', 'invoices.void', 'invoices.issueDraft',
  'payments.get', 'payments.list', 'payments.record', 'payments.void',
  'adjustments.record', 'statements.patient',
  'inventory.list', 'inventory.get', 'inventory.create', 'inventory.update', 'inventory.movement', 'inventory.movements',
  'accounting.summary', 'accounting.addExpense', 'accounting.expenses',
  'dashboard.overview',
  'reports.run',
  'notifications.refresh', 'notifications.list', 'notifications.markRead', 'notifications.markAllRead',
  'search.global',
  'audit.list', 'diagnostics.run',
  'attachments.list', 'attachments.add', 'attachments.read', 'attachments.remove',
  'backup.list', 'backup.create', 'backup.inspect', 'backup.restore',
  'data.importPatients', 'data.exportPatients', 'data.exportReport',
  'documents.prescriptionHtml', 'documents.invoiceHtml', 'documents.receiptHtml', 'documents.statementHtml',
  'documents.pdf', 'documents.printDoc',
  'dialog.pickFile', 'dialog.saveFile', 'dialog.pickDir'
]);

export interface DentivaBridge {
  invoke<T = unknown>(channel: string, payload?: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } }>;
  appInfo(): Promise<{ name: string; version: string; dataDir: string }>;
}

const bridge: DentivaBridge = {
  invoke: (channel, payload = {}) => {
    if (typeof channel !== 'string' || !CHANNEL_ALLOWLIST.has(channel)) {
      return Promise.resolve({ ok: false as const, error: { code: 'FORBIDDEN', message: 'Blocked IPC channel.' } });
    }
    return ipcRenderer.invoke('invoke', channel, payload);
  },
  appInfo: () => ipcRenderer.invoke('app.info')
};

contextBridge.exposeInMainWorld('dentiva', bridge);
