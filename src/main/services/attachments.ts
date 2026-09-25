import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppError, ERR } from '@shared/types';
import { sha256Hex } from '../security/passwords';
import { nowUtc } from '../domain/datetime';
import { AuditService } from './audit';

export interface AttachmentRow {
  id: number;
  patientId: number;
  visitId: number | null;
  title: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  notes: string;
  createdBy: string;
  createdAt: string;
}

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

/**
 * Attachment storage: files live under <dataDir>/attachments with random
 * stored names; the original name is metadata only. User-supplied paths are
 * never joined into storage paths, which makes path traversal impossible by
 * construction. Contents are hashed for integrity verification.
 */
export class AttachmentService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    private attachmentsDir: string,
    private maxBytes: number
  ) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }

  private resolveStored(storedName: string): string {
    // Defence in depth: storedName must be a plain file name we generated.
    if (!/^[A-Za-z0-9_-]+$/.test(storedName)) throw new AppError(ERR.INTEGRITY, 'Corrupt attachment record (invalid stored name).');
    const p = path.join(this.attachmentsDir, storedName);
    if (path.dirname(p) !== this.attachmentsDir) throw new AppError(ERR.INTEGRITY, 'Attachment path violation blocked.');
    return p;
  }

  listForPatient(patientId: number): AttachmentRow[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE patient_id = ? ORDER BY id DESC')
      .all(patientId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      patientId: r.patient_id as number,
      visitId: (r.visit_id as number) ?? null,
      title: (r.title as string) ?? '',
      fileName: r.file_name as string,
      mime: r.mime as string,
      sizeBytes: r.size_bytes as number,
      sha256: r.sha256 as string,
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string
    }));
  }

  get(id: number): AttachmentRow {
    const r = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new AppError(ERR.NOT_FOUND, 'Attachment not found.');
    return {
      id: r.id as number,
      patientId: r.patient_id as number,
      visitId: (r.visit_id as number) ?? null,
      title: (r.title as string) ?? '',
      fileName: r.file_name as string,
      mime: r.mime as string,
      sizeBytes: r.size_bytes as number,
      sha256: r.sha256 as string,
      notes: (r.notes as string) ?? '',
      createdBy: (r.created_by as string) ?? '',
      createdAt: r.created_at as string
    };
  }

  /** Store bytes originating from a validated file dialog selection. */
  add(actor: string, patientId: number, sourcePath: string, opts: { title?: string; notes?: string; visitId?: number | null; mime?: string }): AttachmentRow {
    const patient = this.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new AppError(ERR.VALIDATION, 'The selected patient does not exist.');
    const src = path.resolve(sourcePath);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new AppError(ERR.VALIDATION, 'The selected file could not be read.');
    const data = fs.readFileSync(src);
    if (data.length === 0) throw new AppError(ERR.VALIDATION, 'The selected file is empty.');
    if (data.length > this.maxBytes) {
      throw new AppError(ERR.VALIDATION, `File is too large (${Math.round(data.length / 1e6)} MB). The limit is ${Math.round(this.maxBytes / 1e6)} MB.`);
    }
    const mime = opts.mime || 'application/octet-stream';
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError(ERR.VALIDATION, `File type "${mime}" is not permitted. Allowed: PDF, images, plain text, CSV, Word, Excel.`);
    }
    const originalName = path.basename(src).slice(0, 160);
    const storedName = `${Date.now().toString(36)}${randomBytes(9).toString('hex')}`;
    const sha = sha256Hex(data);
    const tx = this.db.transaction(() => {
      fs.writeFileSync(this.resolveStored(storedName), data, { mode: 0o600 });
      const res = this.db
        .prepare(
          `INSERT INTO attachments (patient_id, visit_id, title, file_name, stored_name, mime, size_bytes, sha256, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(patientId, opts.visitId ?? null, opts.title?.slice(0, 200) ?? '', originalName, storedName, mime, data.length, sha, opts.notes ?? '', actor, nowUtc());
      this.audit.record(actor, 'attachment.add', 'attachments', Number(res.lastInsertRowid), { fileName: originalName, size: data.length });
      return Number(res.lastInsertRowid);
    });
    return this.get(tx.immediate());
  }

  /** Read bytes for preview/download after an integrity re-check. */
  read(id: number): { meta: AttachmentRow; data: Buffer } {
    const meta = this.get(id);
    const stored = this.db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(id) as { stored_name: string };
    const p = this.resolveStored(stored.stored_name);
    if (!fs.existsSync(p)) throw new AppError(ERR.INTEGRITY, 'Attachment file is missing from storage.');
    const data = fs.readFileSync(p);
    if (sha256Hex(data) !== meta.sha256) throw new AppError(ERR.INTEGRITY, 'Attachment file failed its integrity check.');
    return { meta, data };
  }

  remove(actor: string, id: number): void {
    const meta = this.get(id);
    const stored = this.db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(id) as { stored_name: string };
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      this.audit.record(actor, 'attachment.remove', 'attachments', id, { fileName: meta.fileName });
    });
    tx.immediate();
    const p = this.resolveStored(stored.stored_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  /** Verify every stored attachment exists and matches its hash (diagnostics). */
  verifyAll(): { checked: number; problems: string[] } {
    const rows = this.db.prepare('SELECT id, stored_name, sha256 FROM attachments').all() as Array<{ id: number; stored_name: string; sha256: string }>;
    const problems: string[] = [];
    for (const r of rows) {
      try {
        const p = this.resolveStored(r.stored_name);
        if (!fs.existsSync(p)) {
          problems.push(`attachment ${r.id}: file missing (${r.stored_name})`);
          continue;
        }
        if (sha256Hex(fs.readFileSync(p)) !== r.sha256) problems.push(`attachment ${r.id}: checksum mismatch`);
      } catch (e) {
        problems.push(`attachment ${r.id}: ${(e as Error).message}`);
      }
    }
    return { checked: rows.length, problems };
  }
}
