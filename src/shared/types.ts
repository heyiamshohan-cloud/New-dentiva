/**
 * Dentiva Pro — shared contracts between main and renderer processes.
 * All monetary values are integers denominated in the currency's minor unit
 * (BDT poisha; 1 BDT = 100 poisha). Never pass floats for money.
 */

export type Paisa = number; // integer minor units
export type ISODateTime = string; // UTC ISO-8601
export type LocalDate = string; // YYYY-MM-DD (clinic-local civil date)

export type Role = 'administrator' | 'dentist' | 'assistant' | 'receptionist' | 'accountant';

export type Sex = 'male' | 'female' | 'other';

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type QueueStatus = 'waiting' | 'called' | 'in_progress' | 'completed' | 'skipped' | 'cancelled';

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';

export type InventoryMovementType =
  | 'purchase'
  | 'stock_in'
  | 'stock_out'
  | 'adjustment'
  | 'return'
  | 'correction';

export type AdjustmentKind = 'refund' | 'write_off' | 'discount_correction' | 'rounding' | 'manual_credit' | 'manual_debit';

export type TreatmentPlanStatus = 'draft' | 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';

export type Dentition = 'adult' | 'primary';

export type PaymentMethodBuiltin = 'Cash' | 'Bank' | 'Card' | 'bKash' | 'Nagad' | 'Rocket' | 'Upay';

export interface SessionInfo {
  token: string;
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  loginAt: ISODateTime;
  locked: boolean;
}

export interface ClinicProfile {
  id: number;
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationNo: string;
  professionalInfo: string;
  timezone: string;
  currencyCode: string;
  currencySymbol: string;
  dateFormat: string;
  documentHeaderNote: string;
  documentFooterNote: string;
  logoPath: string | null;
  updatedAt: ISODateTime;
}

export interface PatientSummary {
  id: number;
  code: string;
  fullName: string;
  preferredName: string;
  sex: Sex;
  dob: string | null;
  age: number | null;
  phone: string;
  email: string;
  archived: boolean;
  createdAt: ISODateTime;
}

export interface Patient extends PatientSummary {
  alternatePhone: string;
  address: string;
  occupation: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  referralSource: string;
  tags: string[];
  customFields: Record<string, string>;
  medicalHistory: string;
  dentalHistory: string;
  allergies: string;
  currentMedications: string;
  chronicConditions: string;
  riskInfo: string;
  notes: string;
  updatedAt: ISODateTime;
}

export interface DuplicateCandidate {
  patient: PatientSummary;
  reasons: string[];
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FinancialSummary {
  totalBilled: Paisa;
  totalPaid: Paisa;
  totalDue: Paisa; // negative = credit balance
}

export interface InvoiceComputed extends FinancialSummary {
  status: InvoiceStatus;
}

export interface BackupInfo {
  id: number;
  fileName: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  counts: Record<string, number>;
  appVersion: string;
  dbVersion: number;
  createdAt: ISODateTime;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  entity: string;
  entityId: number | null;
  read: boolean;
  createdAt: ISODateTime;
}

export interface AuditEvent {
  id: number;
  at: ISODateTime;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Standard error codes surfaced through IPC. */
export const ERR = {
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_LOCKED: 'SESSION_LOCKED',
  INTEGRITY: 'INTEGRITY',
  IO: 'IO',
  INTERNAL: 'INTERNAL'
} as const;
export type ErrCode = (typeof ERR)[keyof typeof ERR];

export class AppError extends Error {
  constructor(
    public code: ErrCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Table names included in backups/integrity counts. Order is stable. */
export const ENTITY_TABLES = [
  'clinic',
  'users',
  'dentists',
  'staff',
  'payment_methods',
  'counters',
  'patients',
  'appointments',
  'queue_entries',
  'visits',
  'tooth_records',
  'treatments',
  'treatment_plans',
  'treatment_plan_items',
  'prescriptions',
  'prescription_items',
  'invoices',
  'invoice_items',
  'payments',
  'adjustments',
  'inventory_items',
  'inventory_movements',
  'expenses',
  'attachments',
  'notifications',
  'backups',
  'settings',
  'audit_log'
] as const;
