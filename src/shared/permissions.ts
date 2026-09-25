import type { Role } from './types';

export const PERMISSIONS = [
  'patients.read',
  'patients.create',
  'patients.update',
  'patients.archive',
  'appointments.read',
  'appointments.create',
  'appointments.update',
  'queue.read',
  'queue.manage',
  'visits.read',
  'visits.create',
  'visits.update',
  'chart.read',
  'chart.update',
  'treatments.read',
  'treatments.manage',
  'plans.read',
  'plans.create',
  'plans.update',
  'prescriptions.read',
  'prescriptions.create',
  'prescriptions.update',
  'invoices.read',
  'invoices.create',
  'invoices.update',
  'invoices.void',
  'payments.read',
  'payments.create',
  'payments.void',
  'receipts.read',
  'statements.read',
  'inventory.read',
  'inventory.manage',
  'accounting.read',
  'accounting.manage',
  'reports.read',
  'staff.read',
  'staff.manage',
  'users.manage',
  'settings.read',
  'settings.update',
  'backup.create',
  'backup.restore',
  'data.import',
  'data.export',
  'audit.read',
  'diagnostics.read',
  'documents.print',
  'notifications.read'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const DENTIST: Permission[] = [
  'patients.read', 'patients.create', 'patients.update',
  'appointments.read', 'appointments.create', 'appointments.update',
  'queue.read', 'queue.manage',
  'visits.read', 'visits.create', 'visits.update',
  'chart.read', 'chart.update',
  'treatments.read',
  'plans.read', 'plans.create', 'plans.update',
  'prescriptions.read', 'prescriptions.create', 'prescriptions.update',
  'invoices.read', 'payments.read', 'receipts.read', 'statements.read',
  'reports.read', 'staff.read', 'settings.read',
  'data.export', 'documents.print', 'notifications.read', 'diagnostics.read'
];

const ASSISTANT: Permission[] = [
  'patients.read',
  'appointments.read',
  'queue.read', 'queue.manage',
  'visits.read',
  'chart.read',
  'treatments.read',
  'prescriptions.read',
  'settings.read',
  'documents.print', 'notifications.read'
];

const RECEPTIONIST: Permission[] = [
  'patients.read', 'patients.create', 'patients.update', 'patients.archive',
  'appointments.read', 'appointments.create', 'appointments.update',
  'queue.read', 'queue.manage',
  'visits.read',
  'treatments.read',
  'prescriptions.read',
  'invoices.read', 'invoices.create', 'invoices.update',
  'payments.read', 'payments.create',
  'receipts.read', 'statements.read',
  'inventory.read',
  'reports.read', 'staff.read', 'settings.read',
  'data.import', 'data.export',
  'backup.create',
  'documents.print', 'notifications.read'
];

const ACCOUNTANT: Permission[] = [
  'patients.read',
  'appointments.read',
  'queue.read',
  'visits.read',
  'treatments.read',
  'invoices.read', 'invoices.create', 'invoices.update', 'invoices.void',
  'payments.read', 'payments.create', 'payments.void',
  'receipts.read', 'statements.read',
  'inventory.read',
  'accounting.read', 'accounting.manage',
  'reports.read',
  'staff.read', 'settings.read',
  'data.export',
  'backup.create',
  'documents.print', 'notifications.read'
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  administrator: new Set(ALL),
  dentist: new Set(DENTIST),
  assistant: new Set(ASSISTANT),
  receptionist: new Set(RECEPTIONIST),
  accountant: new Set(ACCOUNTANT)
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  administrator: 'Administrator',
  dentist: 'Dentist',
  assistant: 'Assistant',
  receptionist: 'Receptionist',
  accountant: 'Accountant'
};
