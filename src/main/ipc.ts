import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppError, ERR, IpcResult } from '@shared/types';
import { Permission } from '@shared/permissions';
import { roleHas } from '@shared/permissions';
import { Actor } from './security/session';
import { AppContext } from './context';
import { PatientInput } from './services/patients';
import { AppointmentInput } from './services/appointments';
import { VisitInput } from './services/visits';
import { PlanInput } from './services/plans';
import { PrescriptionInput } from './services/prescriptions';
import { InvoiceInput } from './services/billing';
import { TreatmentInput } from './services/treatments';
import { InventoryItemInput } from './services/inventory';
import { StaffInput } from './services/staff';
import { DentistInput } from './services/dentists';
import {
  buildPrescriptionHtml, buildInvoiceHtml, buildReceiptHtml, buildStatementHtml, PaperSize
} from './documents/templates';
import { htmlToPdf, printHtml } from './documents/pdf';
import { sha256Hex, verifyPassword } from './security/passwords';

type Handler = (ctx: AppContext, actor: Actor, payload: Record<string, unknown>) => unknown | Promise<unknown>;

interface Route {
  permission: Permission | 'open' | 'auth';
  handler: Handler;
}

/** filesystem paths must never arrive from the renderer — exe-root paths are server-side only. */
function serverExeRoot(): string {
  // Portable/installed: the folder holding the exe; dev: the project root.
  return app.isPackaged ? path.dirname(process.execPath) : process.cwd();
}

function defaultExportPath(name: string): string {
  return path.join(serverExeRoot(), name);
}

function defaultBackupTarget(): string {
  return path.join(serverExeRoot(), 'backups');
}

function sanitizeFileName(s: string): string {
  return String(s).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file';
}

const routes: Record<string, Route> = {
  // ------------------------------------------------------------- auth/setup
  'auth.status': {
    permission: 'open',
    handler: (ctx) => ({
      ...ctx.services.auth.status(),
      userCount: ctx.services.users.count(),
      setupComplete: ctx.services.settings.get('setupComplete'),
      clinicName: ctx.services.clinic.get().name,
      exeRoot: serverExeRoot()
    })
  },
  'auth.login': { permission: 'open', handler: (ctx, _a, p) => ctx.services.auth.login(String(p.username ?? ''), String(p.password ?? '')) },
  'auth.logout': { permission: 'auth', handler: (ctx) => { ctx.services.auth.logout(); return { ok: true }; } },
  'auth.lock': { permission: 'auth', handler: (ctx) => { ctx.services.auth.lock(); return { ok: true }; } },
  'auth.unlock': { permission: 'open', handler: (ctx, _a, p) => ctx.services.auth.unlock(String(p.token ?? ''), String(p.password ?? '')) },
  'auth.changePassword': {
    permission: 'auth',
    handler: (ctx, actor, p) => {
      const target = Number(p.userId ?? actor.userId);
      if (target !== actor.userId && actor.role !== 'administrator') throw new AppError(ERR.FORBIDDEN, 'Only administrators can change other passwords.');
      if (target === actor.userId) {
        const u = ctx.services.users.getByUsername(actor.username);
        if (!u || !verifyPassword(String(p.currentPassword ?? ''), u.password_hash)) throw new AppError(ERR.UNAUTHENTICATED, 'Current password is incorrect.');
      }
      ctx.services.users.changePassword(actor.username, target, String(p.newPassword ?? ''));
      return { ok: true };
    }
  },
  'setup.complete': {
    permission: 'open',
    handler: (ctx, _a, p) => {
      // First-launch wizard: atomic — clinic profile + administrator account +
      // optional first dentist + settings flag commit together or not at all.
      if (ctx.services.users.count() > 0 || ctx.services.settings.get('setupComplete')) {
        throw new AppError(ERR.CONFLICT, 'First-run setup is already complete. Sign in instead.');
      }
      const clinic = p.clinic as { name?: string; phone?: string; address?: string; email?: string; registrationNo?: string; documentFooterNote?: string } | undefined;
      const admin = p.admin as { username?: string; displayName?: string; password?: string } | undefined;
      const dentist = p.dentist as { name?: string; credentials?: string; specialization?: string; phone?: string } | undefined;
      const clinicName = clinic?.name?.trim() ?? '';
      const adminUsername = admin?.username?.trim() ?? '';
      const adminPassword = admin?.password ?? '';
      if (!clinicName) throw new AppError(ERR.VALIDATION, 'A clinic name is required.');
      if (!adminUsername || !adminPassword) throw new AppError(ERR.VALIDATION, 'An administrator username and password are required.');
      const clinicData = clinic ?? {};
      const tx = ctx.db.transaction(() => {
        ctx.services.clinic.update('setup', {
          name: clinicName,
          phone: String(clinicData.phone ?? ''),
          address: String(clinicData.address ?? ''),
          email: String(clinicData.email ?? ''),
          registrationNo: String(clinicData.registrationNo ?? ''),
          documentFooterNote: String(clinicData.documentFooterNote ?? '')
        });
        ctx.services.users.create('setup', {
          username: adminUsername,
          displayName: String(admin?.displayName ?? adminUsername).trim(),
          role: 'administrator',
          password: adminPassword
        });
        if (dentist?.name?.trim()) {
          ctx.services.dentists.create('setup', {
            name: dentist.name.trim(),
            credentials: String(dentist.credentials ?? ''),
            designation: String(dentist.specialization ?? ''),
            phone: String(dentist.phone ?? '')
          });
        }
        ctx.services.settings.set('setupComplete', true);
        ctx.services.audit.record('setup', 'setup.complete', 'settings', 'setupComplete', {});
      });
      tx.immediate();
      return { ok: true };
    }
  },

  // ---------------------------------------------------------- clinic/config
  'clinic.get': { permission: 'settings.read', handler: (ctx) => ctx.services.clinic.get() },
  'clinic.update': { permission: 'settings.update', handler: (ctx, actor, p) => ctx.services.clinic.update(actor.username, p.patch as never) },
  'clinic.logoDataUrl': {
    permission: 'settings.read',
    handler: (ctx) => ({ logoDataUrl: clinicPayload(ctx).logoDataUrl })
  },
  'clinic.setLogo': {
    permission: 'settings.update',
    handler: (ctx, actor, p) => {
      // The renderer reads the chosen image itself and ships a bounded data-URL;
      // main validates the payload, persists it under dataDir and re-points the profile.
      const dataUrl = String(p.dataUrl ?? '');
      const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) throw new AppError(ERR.VALIDATION, 'Logo must be a PNG/JPEG image selected through the app.');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 2 * 1024 * 1024) throw new AppError(ERR.VALIDATION, 'Logo file must be under 2 MB.');
      const sniffPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
      const sniffJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
      if (!sniffPng && !sniffJpg) throw new AppError(ERR.VALIDATION, 'The chosen file is not a valid PNG/JPEG image.');
      const ext = sniffPng ? 'png' : 'jpg';
      const logoPath = path.join(ctx.dataDir, `clinic-logo.${ext}`);
      fs.writeFileSync(logoPath, buf);
      ctx.services.clinic.update(actor.username, { logoPath });
      return { ok: true };
    }
  },
  'settings.get': { permission: 'settings.read', handler: (ctx) => ctx.services.settings.all() },
  'settings.update': {
    permission: 'settings.update',
    handler: (ctx, actor, p) => {
      const patch = p.patch as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        ctx.services.settings.set(k as never, v as never);
      }
      ctx.services.audit.record(actor.username, 'settings.update', 'settings', '', patch);
      return ctx.services.settings.all();
    }
  },

  // -------------------------------------------------------- users/staff dir
  'users.list': { permission: 'users.manage', handler: (ctx) => ctx.services.users.list() },
  'users.create': { permission: 'users.manage', handler: (ctx, actor, p) => ctx.services.users.create(actor.username, p as never) },
  'users.update': { permission: 'users.manage', handler: (ctx, actor, p) => ctx.services.users.update(actor.username, Number(p.id), p.patch as never) },
  'dentists.list': { permission: 'staff.read', handler: (ctx, _a, p) => ctx.services.dentists.list(!!p.includeInactive) },
  'dentists.create': { permission: 'staff.manage', handler: (ctx, actor, p) => ctx.services.dentists.create(actor.username, p.input as DentistInput) },
  'dentists.update': { permission: 'staff.manage', handler: (ctx, actor, p) => ctx.services.dentists.update(actor.username, Number(p.id), p.patch as Partial<DentistInput>) },
  'staff.list': { permission: 'staff.read', handler: (ctx, _a, p) => ctx.services.staff.list(!!p.includeInactive) },
  'staff.create': { permission: 'staff.manage', handler: (ctx, actor, p) => ctx.services.staff.create(actor.username, p.input as StaffInput) },
  'staff.update': { permission: 'staff.manage', handler: (ctx, actor, p) => ctx.services.staff.update(actor.username, Number(p.id), p.patch as Partial<StaffInput>) },
  'paymentMethods.list': { permission: 'settings.read', handler: (ctx) => ctx.services.paymentMethods.list(false) },
  'paymentMethods.add': { permission: 'settings.update', handler: (ctx, _a, p) => { ctx.services.paymentMethods.add(String(p.name ?? '')); return { ok: true }; } },
  'paymentMethods.setActive': { permission: 'settings.update', handler: (ctx, _a, p) => { ctx.services.paymentMethods.setActive(Number(p.id), !!p.active); return { ok: true }; } },

  // ----------------------------------------------------------------- patient
  'patients.search': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.patients.search(p as never) },
  'patients.select': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.patients.select(String(p.text ?? ''), Number(p.limit ?? 50)) },
  'patients.get': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.patients.getById(Number(p.id)) },
  'patients.duplicates': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.patients.findDuplicates(p.input as PatientInput, p.excludeId ? Number(p.excludeId) : undefined) },
  'patients.create': { permission: 'patients.create', handler: (ctx, actor, p) => ctx.services.patients.create(actor.username, p.input as PatientInput, { skipDuplicateCheck: !!p.skipDuplicateCheck }) },
  'patients.update': { permission: 'patients.update', handler: (ctx, actor, p) => ctx.services.patients.update(actor.username, Number(p.id), p.input as PatientInput) },
  'patients.archive': { permission: 'patients.archive', handler: (ctx, actor, p) => ctx.services.patients.setArchived(actor.username, Number(p.id), !!p.archived) },
  'patients.timeline': {
    permission: 'visits.read',
    handler: (ctx, _a, p) => ctx.services.visits.timeline(Number(p.patientId), Number(p.page ?? 1), Number(p.pageSize ?? 60))
  },
  'patients.financials': { permission: 'statements.read', handler: (ctx, _a, p) => ctx.services.billing.patientFinancials(Number(p.patientId)) },
  'patients.summary360': {
    permission: 'patients.read',
    handler: (ctx, _a, p) => {
      const pid = Number(p.patientId);
      const db = ctx.db;
      const cnt = (sql: string) => (db.prepare(sql).get(pid) as { c: number }).c;
      const first = (db.prepare('SELECT MIN(visit_at) m FROM visits WHERE patient_id = ?').get(pid) as { m: string | null }).m;
      const last = (db.prepare('SELECT MAX(visit_at) m FROM visits WHERE patient_id = ?').get(pid) as { m: string | null }).m;
      return {
        patient: ctx.services.patients.getById(pid),
        counts: {
          visits: cnt('SELECT COUNT(*) c FROM visits WHERE patient_id = ?'),
          prescriptions: cnt('SELECT COUNT(*) c FROM prescriptions WHERE patient_id = ?'),
          appointments: cnt('SELECT COUNT(*) c FROM appointments WHERE patient_id = ?'),
          invoices: cnt('SELECT COUNT(*) c FROM invoices WHERE patient_id = ?'),
          payments: cnt('SELECT COUNT(*) c FROM payments WHERE patient_id = ? AND void = 0'),
          plans: cnt('SELECT COUNT(*) c FROM treatment_plans WHERE patient_id = ?'),
          attachments: cnt('SELECT COUNT(*) c FROM attachments WHERE patient_id = ?')
        },
        firstVisit: first,
        latestVisit: last,
        financials: ctx.services.billing.patientFinancials(pid)
      };
    }
  },

  // ------------------------------------------------------------ appointments
  'appointments.range': { permission: 'appointments.read', handler: (ctx, _a, p) => ctx.services.appointments.listRange(String(p.from), String(p.to), p as never) },
  'appointments.forPatient': { permission: 'appointments.read', handler: (ctx, _a, p) => ctx.services.appointments.listForPatient(Number(p.patientId), Number(p.page ?? 1), Number(p.pageSize ?? 50)) },
  'appointments.create': { permission: 'appointments.create', handler: (ctx, actor, p) => ctx.services.appointments.create(actor.username, p.input as AppointmentInput, { allowConflict: !!p.allowConflict }) },
  'appointments.update': { permission: 'appointments.update', handler: (ctx, actor, p) => ctx.services.appointments.update(actor.username, Number(p.id), p.patch as Partial<AppointmentInput>, { allowConflict: !!p.allowConflict }) },
  'appointments.setStatus': { permission: 'appointments.update', handler: (ctx, actor, p) => ctx.services.appointments.setStatus(actor.username, Number(p.id), p.status as never) },

  // -------------------------------------------------------------------- queue
  'queue.day': { permission: 'queue.read', handler: (ctx, _a, p) => ctx.services.queue.listDay(String(p.day)) },
  'queue.add': { permission: 'queue.manage', handler: (ctx, actor, p) => ctx.services.queue.add(actor.username, p.input as never) },
  'queue.setStatus': { permission: 'queue.manage', handler: (ctx, actor, p) => ctx.services.queue.setStatus(actor.username, Number(p.id), p.status as never) },

  // -------------------------------------------------------------------- visits
  'visits.get': { permission: 'visits.read', handler: (ctx, _a, p) => ctx.services.visits.get(Number(p.id)) },
  'visits.forPatient': { permission: 'visits.read', handler: (ctx, _a, p) => ctx.services.visits.listForPatient(Number(p.patientId), Number(p.page ?? 1), Number(p.pageSize ?? 50)) },
  'visits.create': { permission: 'visits.create', handler: (ctx, actor, p) => ctx.services.visits.create(actor.username, p.input as VisitInput) },
  'visits.update': { permission: 'visits.update', handler: (ctx, actor, p) => ctx.services.visits.update(actor.username, Number(p.id), p.input as VisitInput) },
  'visits.followUpsDue': { permission: 'visits.read', handler: (ctx, _a, p) => ctx.services.visits.followUpsDue(String(p.day)) },
  'chart.get': { permission: 'chart.read', handler: (ctx, _a, p) => ctx.services.chart.getChart(Number(p.patientId)) },
  'chart.set': { permission: 'chart.update', handler: (ctx, actor, p) => ctx.services.chart.setTooth(actor.username, Number(p.patientId), Number(p.toothFdi), String(p.state), String(p.notes ?? ''), p.visitId != null ? Number(p.visitId) : null) },
  'chart.setMany': { permission: 'chart.update', handler: (ctx, actor, p) => { ctx.services.chart.setMany(actor.username, Number(p.patientId), (p.teeth as number[]) ?? [], String(p.state), String(p.notes ?? '')); return { ok: true }; } },

  // ---------------------------------------------------------------- treatments
  'treatments.list': { permission: 'treatments.read', handler: (ctx, _a, p) => ctx.services.treatments.list(!!p.includeInactive) },
  'treatments.create': { permission: 'treatments.manage', handler: (ctx, actor, p) => ctx.services.treatments.create(actor.username, p.input as TreatmentInput) },
  'treatments.update': { permission: 'treatments.manage', handler: (ctx, actor, p) => ctx.services.treatments.update(actor.username, Number(p.id), p.patch as Partial<TreatmentInput>) },

  // --------------------------------------------------------------------- plans
  'plans.get': { permission: 'plans.read', handler: (ctx, _a, p) => ctx.services.plans.get(Number(p.id)) },
  'plans.forPatient': { permission: 'plans.read', handler: (ctx, _a, p) => ctx.services.plans.listForPatient(Number(p.patientId)) },
  'plans.create': { permission: 'plans.create', handler: (ctx, actor, p) => ctx.services.plans.create(actor.username, p.input as PlanInput) },
  'plans.update': { permission: 'plans.update', handler: (ctx, actor, p) => ctx.services.plans.update(actor.username, Number(p.id), p.patch as Partial<PlanInput>) },
  'plans.setStatus': { permission: 'plans.update', handler: (ctx, actor, p) => ctx.services.plans.setStatus(actor.username, Number(p.id), p.status as never) },
  'plans.setItemStatus': { permission: 'plans.update', handler: (ctx, actor, p) => ctx.services.plans.setItemStatus(actor.username, Number(p.itemId), p.status as never) },

  // ------------------------------------------------------------- prescriptions
  'prescriptions.get': { permission: 'prescriptions.read', handler: (ctx, _a, p) => ctx.services.prescriptions.get(Number(p.id)) },
  'prescriptions.list': {
    permission: 'prescriptions.read',
    handler: (ctx, _a, p) => {
      const pid = Number(p.patientId ?? 0) || null;
      const search = String(p.search ?? '').trim();
      const page = Math.max(1, Number(p.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(p.pageSize ?? 50)));
      const where: string[] = [];
      const args: unknown[] = [];
      if (pid) { where.push('r.patient_id = ?'); args.push(pid); }
      if (search) {
        where.push('(r.number LIKE ? OR p2.full_name LIKE ? OR p2.code LIKE ? OR EXISTS (SELECT 1 FROM prescription_items i WHERE i.prescription_id = r.id AND i.medicine_name LIKE ?))');
        const kw = `%${search}%`;
        args.push(kw, kw, kw, kw);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (ctx.db.prepare(
        `SELECT COUNT(*) c FROM prescriptions r JOIN patients p2 ON p2.id = r.patient_id ${w}`
      ).get(...args) as { c: number }).c;
      const ids = ctx.db.prepare(
        `SELECT r.id FROM prescriptions r JOIN patients p2 ON p2.id = r.patient_id ${w} ORDER BY r.prescribed_at DESC, r.id DESC LIMIT ? OFFSET ?`
      ).all(...args, pageSize, (page - 1) * pageSize) as Array<{ id: number }>;
      const rows = ids.map((row) => ctx.services.prescriptions.get(row.id));
      return { rows, total, page, pageSize };
    }
  },
  'prescriptions.forPatient': { permission: 'prescriptions.read', handler: (ctx, _a, p) => ctx.services.prescriptions.listForPatient(Number(p.patientId), Number(p.page ?? 1), Number(p.pageSize ?? 50)) },
  'prescriptions.create': { permission: 'prescriptions.create', handler: (ctx, actor, p) => ctx.services.prescriptions.create(actor.username, p.input as PrescriptionInput) },

  // ------------------------------------------------------------------- billing
  'invoices.get': { permission: 'invoices.read', handler: (ctx, _a, p) => ctx.services.billing.getInvoice(Number(p.id)) },
  'invoices.list': { permission: 'invoices.read', handler: (ctx, _a, p) => ctx.services.billing.listInvoices(p as never) },
  'invoices.create': { permission: 'invoices.create', handler: (ctx, actor, p) => ctx.services.billing.createInvoice(actor.username, p.input as InvoiceInput) },
  'invoices.void': { permission: 'invoices.void', handler: (ctx, actor, p) => ctx.services.billing.voidInvoice(actor.username, Number(p.id), String(p.reason ?? '')) },
  'invoices.issueDraft': { permission: 'invoices.update', handler: (ctx, actor, p) => ctx.services.billing.issueDraft(actor.username, Number(p.id)) },
  'payments.get': { permission: 'payments.read', handler: (ctx, _a, p) => ctx.services.billing.getPayment(Number(p.id)) },
  'payments.list': { permission: 'payments.read', handler: (ctx, _a, p) => ctx.services.billing.listPayments(p as never) },
  'payments.record': { permission: 'payments.create', handler: (ctx, actor, p) => ctx.services.billing.recordPayment(actor.username, p.input as never) },
  'payments.void': { permission: 'payments.void', handler: (ctx, actor, p) => ctx.services.billing.voidPayment(actor.username, Number(p.id), String(p.reason ?? '')) },
  'adjustments.record': { permission: 'payments.create', handler: (ctx, actor, p) => ctx.services.billing.recordAdjustment(actor.username, p.input as never) },
  'statements.patient': { permission: 'statements.read', handler: (ctx, _a, p) => ctx.services.statements.statement(Number(p.patientId), String(p.from), String(p.to)) },

  // ----------------------------------------------------------------- inventory
  'inventory.list': { permission: 'inventory.read', handler: (ctx, _a, p) => ctx.services.inventory.list(p as never) },
  'inventory.get': { permission: 'inventory.read', handler: (ctx, _a, p) => ctx.services.inventory.get(Number(p.id)) },
  'inventory.create': { permission: 'inventory.manage', handler: (ctx, actor, p) => ctx.services.inventory.createItem(actor.username, p.input as never) },
  'inventory.update': { permission: 'inventory.manage', handler: (ctx, actor, p) => ctx.services.inventory.updateItem(actor.username, Number(p.id), p.patch as Partial<InventoryItemInput>) },
  'inventory.movement': { permission: 'inventory.manage', handler: (ctx, actor, p) => ctx.services.inventory.recordMovement(actor.username, p.input as never) },
  'inventory.movements': { permission: 'inventory.read', handler: (ctx, _a, p) => ctx.services.inventory.movementsFor(Number(p.itemId), Number(p.page ?? 1), Number(p.pageSize ?? 50)) },

  // ---------------------------------------------------------------- accounting
  'accounting.summary': { permission: 'accounting.read', handler: (ctx, _a, p) => ctx.services.accounting.summary(String(p.from), String(p.to)) },
  'accounting.addExpense': { permission: 'accounting.manage', handler: (ctx, actor, p) => ctx.services.accounting.addExpense(actor.username, p.input as never) },
  'accounting.expenses': { permission: 'accounting.read', handler: (ctx, _a, p) => ctx.services.accounting.listExpenses(p as never) },

  // --------------------------------------------------------------- dashboard
  'dashboard.overview': { permission: 'notifications.read', handler: (ctx) => ctx.services.dashboard.overview() },

  // ------------------------------------------------------------------ reports
  'reports.run': { permission: 'reports.read', handler: (ctx, _a, p) => ctx.services.reports.run(p.kind as never, p.filters as never) },

  // ------------------------------------------------------------- notifications
  'notifications.refresh': { permission: 'notifications.read', handler: (ctx) => { ctx.services.notifications.refresh(); return ctx.services.notifications.unreadCount(); } },
  'notifications.list': { permission: 'notifications.read', handler: (ctx, _a, p) => ctx.services.notifications.list(!!p.unreadOnly, Number(p.limit ?? 100)) },
  'notifications.markRead': { permission: 'notifications.read', handler: (ctx, _a, p) => { ctx.services.notifications.markRead(Number(p.id)); return { ok: true }; } },
  'notifications.markAllRead': { permission: 'notifications.read', handler: (ctx) => { ctx.services.notifications.markAllRead(); return { ok: true }; } },

  // ------------------------------------------------------------------- search
  'search.global': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.search.global(String(p.text ?? '')) },

  // --------------------------------------------------------------- audit/diag
  'audit.list': { permission: 'audit.read', handler: (ctx, _a, p) => ctx.services.audit.list(p as never) },
  'diagnostics.run': { permission: 'diagnostics.read', handler: (ctx) => ctx.services.diagnostics.run() },

  // -------------------------------------------------------------- attachments
  'attachments.list': { permission: 'patients.read', handler: (ctx, _a, p) => ctx.services.attachments.listForPatient(Number(p.patientId)) },
  'attachments.add': { permission: 'patients.update', handler: (ctx, actor, p) => ctx.services.attachments.add(actor.username, Number(p.patientId), String(p.sourcePath), p.opts as never) },
  'attachments.read': {
    permission: 'patients.read',
    handler: (ctx, _a, p) => {
      const { meta, data } = ctx.services.attachments.read(Number(p.id));
      return { meta, base64: data.toString('base64') };
    }
  },
  'attachments.remove': { permission: 'patients.update', handler: (ctx, actor, p) => { ctx.services.attachments.remove(actor.username, Number(p.id)); return { ok: true }; } },

  // ------------------------------------------------------------------- backup
  'backup.list': { permission: 'backup.create', handler: (ctx) => ctx.backup.listHistory() },
  'backup.create': {
    permission: 'backup.create',
    handler: async (ctx, actor, p) => {
      // Default lives next to the executable; an explicit directory comes from
      // the native folder picker in the Backup screen.
      const target = p.targetDir != null ? String(p.targetDir) : defaultBackupTarget();
      const info = await ctx.backup.createBackup(actor.username, target);
      ctx.services.settings.set('backupDirectory', path.dirname(info.path));
      return info;
    }
  },
  'backup.inspect': { permission: 'backup.restore', handler: (ctx, _a, p) => ctx.backup.inspectBackup(String(p.path)) },
  'backup.restore': {
    permission: 'backup.restore',
    handler: async (ctx, actor, p) => ctx.backup.restoreBackup(actor.username, String(p.path))
  },

  // ----------------------------------------------------------------- transfer
  'data.importPatients': { permission: 'data.import', handler: (ctx, actor, p) => ctx.services.dataTransfer.importPatientsCsv(actor.username, String(p.path), { allowDuplicates: !!p.allowDuplicates }) },
  'data.exportPatients': {
    permission: 'data.export',
    handler: (ctx, actor, p) => {
      const out = p.path != null ? String(p.path) : defaultExportPath(`patients-export-${dateStamp()}.csv`);
      return ctx.services.dataTransfer.exportPatientsCsv(actor.username, out, !!p.includeArchived);
    }
  },
  'data.exportReport': {
    permission: 'data.export',
    handler: (ctx, actor, p) => {
      const out = p.path != null ? String(p.path) : defaultExportPath(`report-${String(p.kind)}-${dateStamp()}.csv`);
      return ctx.services.dataTransfer.exportReportCsv(actor.username, p.kind as never, p.filters as never, out);
    }
  },

  // ----------------------------------------------------------------- documents
  'documents.prescriptionHtml': {
    permission: 'documents.print',
    handler: (ctx, _a, p) => {
      const rx = ctx.services.prescriptions.get(Number(p.id));
      const patient = ctx.services.patients.getById(rx.patientId);
      return buildPrescriptionHtml({ ...clinicPayload(ctx), rx, patientSex: patient.sex, patientAge: patient.age }, (p.size as PaperSize) ?? 'A5');
    }
  },
  'documents.invoiceHtml': {
    permission: 'documents.print',
    handler: (ctx, _a, p) => {
      const invoice = ctx.services.billing.getInvoice(Number(p.id));
      return buildInvoiceHtml({ ...clinicPayload(ctx), invoice }, (p.size as PaperSize) ?? 'A4');
    }
  },
  'documents.receiptHtml': {
    permission: 'documents.print',
    handler: (ctx, _a, p) => {
      const payment = ctx.services.billing.getPayment(Number(p.id));
      const remainingDue = payment.invoiceId != null ? ctx.services.billing.getInvoice(payment.invoiceId).computed.totalDue : ctx.services.billing.patientFinancials(payment.patientId).totalDue;
      return buildReceiptHtml({ ...clinicPayload(ctx), payment, remainingDue }, (p.size as PaperSize) ?? '80mm');
    }
  },
  'documents.statementHtml': {
    permission: 'documents.print',
    handler: (ctx, _a, p) => {
      const patient = ctx.services.patients.getById(Number(p.patientId));
      const st = ctx.services.statements.statement(Number(p.patientId), String(p.from), String(p.to));
      return buildStatementHtml({ ...clinicPayload(ctx), patientName: patient.fullName, patientCode: patient.code, from: String(p.from), to: String(p.to), statement: st }, (p.size as PaperSize) ?? 'A4');
    }
  },

  // ------------------------------------------------------------ activation
  'activation.status': {
    permission: 'open',
    handler: (ctx) => ctx.activation.status()
  },
  'activation.activate': {
    permission: 'open',
    handler: (ctx, _a, p) => {
      try {
        const out = ctx.activation.activate(typeof p.serial === 'string' ? p.serial : '');
        ctx.services.audit.record('system', 'activation.completed', 'activation', '', {});
        return out;
      } catch (e) {
        // Audit the attempt, never the input: messages above are constant.
        ctx.services.audit.record('system', 'activation.rejected', 'activation', '', { reason: e instanceof AppError ? e.code : 'error' });
        throw e;
      }
    }
  },

  // ------------------------------------------------------------- misc (info)
};

/** Channels reachable before activation completes (nothing may read or
 *  write clinic data until the product is activated on this machine). */
export const ACTIVATION_EXEMPT = new Set<string>(['activation.status', 'activation.activate', 'app.info']);

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function clinicPayload(ctx: AppContext) {
  const clinic = ctx.services.clinic.get();
  let logoDataUrl: string | null = null;
  if (clinic.logoPath && fs.existsSync(clinic.logoPath)) {
    const ext = path.extname(clinic.logoPath).toLowerCase() === '.png' ? 'png' : 'jpeg';
    logoDataUrl = `data:image/${ext};base64,${fs.readFileSync(clinic.logoPath).toString('base64')}`;
  }
  return { clinic, logoDataUrl };
}

/**
 * Shared gate for the two document-render channels that live outside the
 * routes table because they need Electron facilities (print dialog, PDF).
 * They are permission-checked exactly like `documents.*Html` (defense in
 * depth against a compromised/anonymous renderer) and ALWAYS rebuild the
 * document HTML server-side from the database — raw HTML from the renderer
 * is never trusted, which also keeps preview and PDF byte-identical in
 * structure (one template, two outputs).
 */
function docActorFor(ctx: AppContext, payload: Record<string, unknown>): Actor {
  const token = typeof payload?.token === 'string' ? payload.token : undefined;
  const actor = ctx.session.requireActor(token);
  if (!roleHas(actor.role, 'documents.print')) {
    ctx.services.audit.record(actor.username, 'security.forbidden', 'documents', '', { required: 'documents.print' });
    throw new AppError(ERR.FORBIDDEN, 'Your role does not permit document printing.');
  }
  return actor;
}

async function withDocPdf(ctx: AppContext, payload: Record<string, unknown>): Promise<IpcResult<unknown>> {
  docActorFor(ctx, payload);
  const channel = String(payload.docKind ?? '');
  const html = await buildDocHtml(ctx, channel, payload);
  if (!html) return { ok: false, error: { code: ERR.VALIDATION, message: 'Unknown document kind.' } };
  const size = (payload.size as PaperSize) ?? 'A4';
  const suggestedName = sanitizeFileName(String(payload.suggestedName ?? `${channel}-${dateStamp()}.pdf`));
  let outPath = payload.path != null ? String(payload.path) : defaultExportPath(suggestedName);
  if (!outPath.toLowerCase().endsWith('.pdf')) outPath += '.pdf';
  const docLabel = channel.charAt(0).toUpperCase() + channel.slice(1);
  const buf = await htmlToPdf(html, size, docLabel);
  await fs.promises.writeFile(outPath, buf);
  return { ok: true, data: { path: outPath, sha256: sha256Hex(buf), bytes: buf.length } };
}

async function withDocPrint(ctx: AppContext, payload: Record<string, unknown>): Promise<IpcResult<unknown>> {
  docActorFor(ctx, payload);
  const channel = String(payload.docKind ?? '');
  const html = await buildDocHtml(ctx, channel, payload);
  if (!html) return { ok: false, error: { code: ERR.VALIDATION, message: 'Unknown document kind.' } };
  const res = await printHtml(html, (payload.size as PaperSize) ?? 'A4');
  if (!res.printed) throw new AppError(ERR.IO, `Printing did not complete: ${res.reason ?? 'cancelled'}`);
  return ok({ printed: true });
}

async function buildDocHtml(ctx: AppContext, docKind: string, payload: Record<string, unknown>): Promise<string | null> {
  switch (docKind) {
    case 'prescription': {
      const rx = ctx.services.prescriptions.get(Number(payload.id));
      const patient = ctx.services.patients.getById(rx.patientId);
      return buildPrescriptionHtml({ ...clinicPayload(ctx), rx, patientSex: patient.sex, patientAge: patient.age }, (payload.size as PaperSize) ?? 'A5');
    }
    case 'invoice': {
      const invoice = ctx.services.billing.getInvoice(Number(payload.id));
      return buildInvoiceHtml({ ...clinicPayload(ctx), invoice }, (payload.size as PaperSize) ?? 'A4');
    }
    case 'receipt': {
      const payment = ctx.services.billing.getPayment(Number(payload.id));
      const remainingDue = payment.invoiceId != null ? ctx.services.billing.getInvoice(payment.invoiceId).computed.totalDue : ctx.services.billing.patientFinancials(payment.patientId).totalDue;
      return buildReceiptHtml({ ...clinicPayload(ctx), payment, remainingDue }, (payload.size as PaperSize) ?? '80mm');
    }
    case 'statement': {
      const patient = ctx.services.patients.getById(Number(payload.patientId));
      const st = ctx.services.statements.statement(Number(payload.patientId), String(payload.from), String(payload.to));
      return buildStatementHtml({ ...clinicPayload(ctx), patientName: patient.fullName, patientCode: patient.code, from: String(payload.from), to: String(payload.to), statement: st }, (payload.size as PaperSize) ?? 'A4');
    }
    default:
      return null;
  }
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

async function pickFile(win: BrowserWindow | null, payload: Record<string, unknown>): Promise<{ path: string | null }> {
  if (!win) return { path: null };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: (payload.filters as Electron.FileFilter[]) ?? [{ name: 'All Files', extensions: ['*'] }]
  });
  return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
}

async function saveFile(win: BrowserWindow | null, payload: Record<string, unknown>): Promise<{ path: string | null }> {
  if (!win) return { path: null };
  const res = await dialog.showSaveDialog(win, {
    defaultPath: String(payload.defaultName ?? payload.defaultPath ?? 'export'),
    filters: (payload.filters as Electron.FileFilter[]) ?? [{ name: 'All Files', extensions: ['*'] }]
  });
  return { path: res.canceled || !res.filePath ? null : res.filePath };
}

async function pickDir(win: BrowserWindow | null, payload: Record<string, unknown>): Promise<{ path: string | null }> {
  if (!win) return { path: null };
  const res = await dialog.showOpenDialog(win, {
    title: typeof payload.title === 'string' ? payload.title : undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
}

/** Channels handled in registration because they need BrowserWindow/dialogs. */
export function registerIpc(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  // Boot-time info the renderer needs before any session exists.
  ipcMain.handle('app.info', () => ok({
    name: 'Dentiva Pro',
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    exeRoot: serverExeRoot()
  }));

  ipcMain.handle('invoke', async (_event, channel: string, payload: Record<string, unknown>): Promise<IpcResult<unknown>> => {
    try {
      if (typeof channel !== 'string') return { ok: false, error: { code: ERR.VALIDATION, message: 'Malformed invocation.' } };

      // Product activation gate — enforced HERE, in the main process, so a
      // compromised or pre-login renderer cannot reach ANY business channel
      // until this installation is activated (spec: Serial Activation).
      if (!ctx.activation.isActivated() && !ACTIVATION_EXEMPT.has(channel)) {
        return { ok: false, error: { code: ERR.NOT_ACTIVATED, message: 'Dentiva Pro is not activated on this computer yet.' } };
      }

      // Async document I/O routes needing Electron facilities.
      if (channel === 'documents.pdf') return await withDocPdf(ctx, payload);
      if (channel === 'documents.printDoc') return await withDocPrint(ctx, payload);
      if (channel === 'dialog.pickFile') return ok(await pickFile(getWindow(), payload));
      if (channel === 'dialog.pickDir') return ok(await pickDir(getWindow(), payload));
      if (channel === 'dialog.saveFile') return ok(await saveFile(getWindow(), payload));

      const route = routes[channel];
      if (!route) return { ok: false, error: { code: ERR.NOT_FOUND, message: `Unknown channel "${channel}".` } };

      if (route.permission === 'open') {
        const res = await route.handler(ctx, { userId: 0, username: 'anonymous', displayName: '', role: 'receptionist' }, payload ?? {});
        return ok(res);
      }

      const token = typeof payload?.token === 'string' ? payload.token : undefined;
      if (route.permission === 'auth') {
        const actor = ctx.session.peekActor(token);
        const res = await route.handler(ctx, actor, payload ?? {});
        return ok(res);
      }

      const actor = ctx.session.requireActor(token);
      if (!roleHas(actor.role, route.permission)) {
        ctx.services.audit.record(actor.username, 'security.forbidden', channel, '', { required: route.permission });
        return { ok: false, error: { code: ERR.FORBIDDEN, message: 'Your role does not permit this action.' } };
      }

      const res = await route.handler(ctx, actor, payload ?? {});
      return ok(res);
    } catch (e) {
      if (e instanceof AppError) {
        const detail = e.details ? ` ${JSON.stringify(e.details)}` : '';
        return { ok: false, error: { code: e.code, message: `${e.message}${detail}`.slice(0, 600) } };
      }
      console.error('[ipc] unhandled error on', channel, e);
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred. The operation was not completed.' } };
    }
  });
}
