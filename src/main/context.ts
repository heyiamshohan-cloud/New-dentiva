import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { openDatabase, DbHandle } from './db/database';
import { SessionManager } from './security/session';
import { AuditService } from './services/audit';
import { SettingsService } from './services/settings';
import { ClinicService } from './services/clinic';
import { UserService } from './services/users';
import { DentistService } from './services/dentists';
import { StaffService, PaymentMethodService } from './services/staff';
import { NumberingService } from './services/counters';
import { PatientService } from './services/patients';
import { AppointmentService } from './services/appointments';
import { QueueService } from './services/queue';
import { VisitService } from './services/visits';
import { ChartService } from './services/chart';
import { TreatmentService } from './services/treatments';
import { PlanService } from './services/plans';
import { PrescriptionService } from './services/prescriptions';
import { BillingService } from './services/billing';
import { StatementService } from './services/statements';
import { InventoryService } from './services/inventory';
import { AccountingService } from './services/accounting';
import { DashboardService, ReportService } from './services/reports';
import { NotificationService } from './services/notifications';
import { SearchService } from './services/search';
import { AttachmentService } from './services/attachments';
import { BackupService, DbProvider } from './services/backup';
import { DataTransferService } from './services/dataTransfer';
import { DiagnosticsService } from './services/diagnostics';
import { AuthService } from './services/auth';

export interface ServiceContainer {
  audit: AuditService;
  settings: SettingsService;
  clinic: ClinicService;
  users: UserService;
  dentists: DentistService;
  staff: StaffService;
  paymentMethods: PaymentMethodService;
  numbering: NumberingService;
  patients: PatientService;
  appointments: AppointmentService;
  queue: QueueService;
  visits: VisitService;
  chart: ChartService;
  treatments: TreatmentService;
  plans: PlanService;
  prescriptions: PrescriptionService;
  billing: BillingService;
  statements: StatementService;
  inventory: InventoryService;
  accounting: AccountingService;
  dashboard: DashboardService;
  reports: ReportService;
  notifications: NotificationService;
  search: SearchService;
  attachments: AttachmentService;
  dataTransfer: DataTransferService;
  diagnostics: DiagnosticsService;
  auth: AuthService;
}

/**
 * Application context: owns the database handle and the service graph.
 * restore swaps the underlying DB file; `reopen()` rebuilds every service so
 * nothing keeps a stale handle (spec: recovery-safe restore).
 */
export class AppContext implements DbProvider {
  readonly dataDir: string;
  readonly attachmentsDir: string;
  readonly backupDir: string;
  readonly session = new SessionManager();
  readonly backup: BackupService;
  private handle: DbHandle;
  services!: ServiceContainer;

  private static resolveDirectory(dataDir: string, envKey: string, fallbackName: string): string {
    const override = process.env[envKey];
    if (override && override.trim()) {
      const resolved = path.resolve(override.trim());
      const banned = ['\\', '/', '..', ':'].some((s) => override.includes('..'));
      if (banned) throw new Error(`${envKey} must not contain parent-directory segments.`);
      return resolved;
    }
    return path.join(dataDir, fallbackName);
  }

  constructor(dataDir: string, private appVersion = '1.0.0') {
    this.dataDir = dataDir;
    this.attachmentsDir = AppContext.resolveDirectory(dataDir, 'DENTIVA_ATTACHMENTS_DIR', 'attachments');
    this.backupDir = AppContext.resolveDirectory(dataDir, 'DENTIVA_BACKUP_DIR', 'backups');
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.handle = openDatabase(dataDir);
    this.backup = new BackupService(this, () => this.services.audit, this.dataDir, this.attachmentsDir, this.backupDir, appVersion);
    this.buildServices();
  }

  current(): Database.Database {
    return this.handle.db;
  }

  get db(): Database.Database {
    return this.handle.db;
  }

  close(): void {
    try {
      this.handle.db.close();
    } catch {
      // idempotent — close may be called after a failed swap
    }
  }

  reopen(): void {
    this.handle = openDatabase(this.dataDir);
    this.buildServices();
  }

  private buildServices(): void {
    const db = this.handle.db;
    const audit = new AuditService(db);
    const settings = new SettingsService(db);
    const clinic = new ClinicService(db, audit);
    const numbering = new NumberingService(db);
    const users = new UserService(db, audit);
    const dentists = new DentistService(db, audit);
    const staff = new StaffService(db, audit);
    const paymentMethods = new PaymentMethodService(db);
    paymentMethods.seedDefaults();
    const tz = () => clinic.get().timezone || 'Asia/Dhaka';
    const attachmentsAttach = new AttachmentService(db, audit, this.attachmentsDir, settings.get('attachmentMaxMb') * 1024 * 1024);
    const patients = new PatientService(db, audit, numbering, tz);
    const appointments = new AppointmentService(db, audit, numbering);
    const queue = new QueueService(db, audit);
    const visits = new VisitService(db, audit, numbering);
    const chart = new ChartService(db, audit);
    const treatments = new TreatmentService(db, audit);
    const plans = new PlanService(db, audit);
    const prescriptions = new PrescriptionService(db, audit, numbering);
    const billing = new BillingService(db, audit, numbering);
    const statements = new StatementService(db);
    const inventory = new InventoryService(db, audit, tz);
    const accounting = new AccountingService(db, audit);
    const dashboard = new DashboardService(db, tz);
    const reports = new ReportService(db);
    const notifications = new NotificationService(db, tz);
    const searchSvc = new SearchService(db);
    const dataTransfer = new DataTransferService(db, audit, patients, reports);
    const diagnostics = new DiagnosticsService(db, attachmentsAttach);
    const auth = new AuthService(users, this.session, audit);
    this.services = {
      audit, settings, clinic, users, dentists, staff, paymentMethods, numbering,
      patients, appointments, queue, visits, chart, treatments, plans, prescriptions,
      billing, statements, inventory, accounting, dashboard, reports, notifications,
      search: searchSvc, attachments: attachmentsAttach, dataTransfer, diagnostics, auth
    };
    this.session.setIdleTimeout(settings.get('lockTimeoutMinutes'));
  }
}
