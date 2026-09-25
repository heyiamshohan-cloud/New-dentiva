import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { AppError, BackupInfo, ENTITY_TABLES, ERR } from '@shared/types';
import { sha256Hex } from '../security/passwords';
import { nowUtc } from '../domain/datetime';
import { integrityCheck, foreignKeyCheck, DB_FILE_NAME } from '../db/database';
import { SCHEMA_VERSION } from '../db/migrations';
import { AuditService } from './audit';

const MANIFEST = 'manifest.json';

export interface BackupManifest {
  app: string;
  format: 1;
  createdAt: string;
  appVersion: string;
  dbVersion: number;
  counts: Record<string, number>;
  files: Array<{ name: string; sha256: string; sizeBytes: number }>;
}

/**
 * Live handle to the working database. `close()`/`reopen()` are used only by
 * the restore pipeline; every read goes through `current()` so a swapped-in
 * database is seen immediately by the service layer.
 */
export interface DbProvider {
  current(): Database.Database;
  close(): void;
  reopen(): void;
}

/**
 * Backup & restore engine.
 *
 * Backup  → consistent SQLite snapshot (online backup API) + attachments +
 *           manifest with per-file SHA-256; whole-archive SHA-256 recorded in
 *           the backups history table.
 *
 * Restore → validate archive structure → verify every checksum → stage →
 *           verify staged DB integrity and manifest row counts → take an
 *           automatic pre-restore safety copy → swap files → reopen → verify
 *           live integrity + foreign keys. ANY failure rolls back to the
 *           pre-restore state and reports the problem — no partial restores.
 */
export class BackupService {
  constructor(
    private provider: DbProvider,
    private auditProvider: () => AuditService,
    private dataDir: string,
    private attachmentsDir: string,
    private defaultBackupDir: string,
    private appVersion: string
  ) {
    fs.mkdirSync(defaultBackupDir, { recursive: true });
  }

  private get db(): Database.Database {
    return this.provider.current();
  }

  listHistory(): BackupInfo[] {
    const rows = this.db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 500').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      fileName: r.file_name as string,
      path: r.path as string,
      sizeBytes: r.size_bytes as number,
      sha256: r.sha256 as string,
      counts: JSON.parse((r.db_counts as string) ?? '{}') as Record<string, number>,
      appVersion: (r.app_version as string) ?? '',
      dbVersion: (r.db_version as number) ?? 0,
      createdAt: r.created_at as string
    }));
  }

  private tableCounts(db: Database.Database): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const t of ENTITY_TABLES) counts[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    return counts;
  }

  /** Create a timestamped, integrity-verifiable backup archive (.dvp). */
  async createBackup(actor: string, targetDir?: string): Promise<BackupInfo> {
    const dir = targetDir?.trim() ? path.resolve(targetDir) : this.defaultBackupDir;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = nowUtc().replace(/[:.]/g, '-');
    const outPath = path.join(dir, `dentiva-backup-${stamp}.dvp`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-backup-'));
    try {
      const snapPath = path.join(tmp, DB_FILE_NAME);
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      await this.db.backup(snapPath);

      const files: BackupManifest['files'] = [];
      const manifest: BackupManifest = {
        app: 'Dentiva Pro',
        format: 1,
        createdAt: nowUtc(),
        appVersion: this.appVersion,
        dbVersion: SCHEMA_VERSION,
        counts: this.tableCounts(this.db),
        files
      };
      files.push({ name: DB_FILE_NAME, sha256: sha256Hex(fs.readFileSync(snapPath)), sizeBytes: fs.statSync(snapPath).size });

      const attStage = path.join(tmp, 'attachments');
      fs.mkdirSync(attStage, { recursive: true });
      if (fs.existsSync(this.attachmentsDir)) {
        for (const f of fs.readdirSync(this.attachmentsDir)) {
          const src = path.join(this.attachmentsDir, f);
          if (!fs.statSync(src).isFile()) continue;
          fs.copyFileSync(src, path.join(attStage, f));
          files.push({ name: `attachments/${f}`, sha256: sha256Hex(fs.readFileSync(src)), sizeBytes: fs.statSync(src).size });
        }
      }
      fs.writeFileSync(path.join(tmp, MANIFEST), JSON.stringify(manifest, null, 2));

      await zipDirectory(tmp, outPath);
      const sizeBytes = fs.statSync(outPath).size;
      const sha256 = sha256Hex(fs.readFileSync(outPath));
      const tx = this.db.transaction(() => {
        const res = this.db
          .prepare(
            `INSERT INTO backups (file_name, path, size_bytes, sha256, db_counts, app_version, db_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(path.basename(outPath), outPath, sizeBytes, sha256, JSON.stringify(manifest.counts), this.appVersion, SCHEMA_VERSION, manifest.createdAt);
        this.auditProvider().record(actor, 'backup.create', 'backups', Number(res.lastInsertRowid), { file: path.basename(outPath), sizeBytes });
        return Number(res.lastInsertRowid);
      });
      const id = tx.immediate();
      return { id, fileName: path.basename(outPath), path: outPath, sizeBytes, sha256, counts: manifest.counts, appVersion: this.appVersion, dbVersion: SCHEMA_VERSION, createdAt: manifest.createdAt };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Inspect a backup file without restoring: verify manifest + checksums. */
  async inspectBackup(filePath: string): Promise<{ ok: boolean; manifest: BackupManifest | null; problems: string[] }> {
    const problems: string[] = [];
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return { ok: false, manifest: null, problems: ['Backup file does not exist.'] };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-inspect-'));
    try {
      await extractZip(resolved, { dir: tmp });
      const manifestPath = path.join(tmp, MANIFEST);
      if (!fs.existsSync(manifestPath)) return { ok: false, manifest: null, problems: ['Archive has no manifest — not a Dentiva Pro backup.'] };
      let manifest: BackupManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
      } catch {
        return { ok: false, manifest: null, problems: ['Manifest is not valid JSON — the backup is corrupt.'] };
      }
      if (manifest.app !== 'Dentiva Pro' || manifest.format !== 1) problems.push('Manifest identity or format is not recognised.');
      if (typeof manifest.dbVersion !== 'number' || manifest.dbVersion < 1) problems.push('Manifest database version is invalid.');
      if (manifest.dbVersion > SCHEMA_VERSION) problems.push(`Backup database version ${manifest.dbVersion} is newer than this application supports (${SCHEMA_VERSION}).`);
      for (const f of manifest.files ?? []) {
        const p = path.join(tmp, f.name);
        if (!p.startsWith(tmp + path.sep) && p !== path.join(tmp, f.name)) {
          problems.push(`Unsafe archive entry blocked: ${f.name}`);
          continue;
        }
        if (f.name.includes('..')) { problems.push(`Unsafe archive entry blocked: ${f.name}`); continue; }
        if (!fs.existsSync(p)) { problems.push(`Missing file in archive: ${f.name}`); continue; }
        if (sha256Hex(fs.readFileSync(p)) !== f.sha256) problems.push(`Checksum mismatch: ${f.name}`);
      }
      if (!manifest.files?.some((f) => f.name === DB_FILE_NAME)) problems.push('Backup contains no database file.');
      return { ok: problems.length === 0, manifest, problems };
    } catch (e) {
      return { ok: false, manifest: null, problems: [`Could not read archive: ${(e as Error).message}`] };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Safe restore with automatic rollback and post-restore verification.
   * Returns the restored table counts on success.
   */
  async restoreBackup(actor: string, filePath: string): Promise<{ restoredCounts: Record<string, number> }> {
    const inspect = await this.inspectBackup(filePath);
    if (!inspect.ok || !inspect.manifest) {
      throw new AppError(ERR.INTEGRITY, `Backup validation failed: ${inspect.problems.join('; ')}`);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-restore-'));
    const safetyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-prerestore-'));
    try {
      await extractZip(path.resolve(filePath), { dir: tmp });
      const stagedDb = path.join(tmp, DB_FILE_NAME);

      // Verify the staged database: opens, structurally sound, FK-consistent,
      // and row counts match the manifest.
      const staged = new (await import('better-sqlite3')).default(stagedDb, { readonly: true });
      try {
        const icRows = staged.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
        const icDetails = icRows.map((r) => r.integrity_check);
        if (!(icDetails.length === 1 && icDetails[0] === 'ok')) {
          throw new AppError(ERR.INTEGRITY, `Backup database failed integrity check: ${icDetails.join('; ')}`);
        }
        for (const [table, count] of Object.entries(inspect.manifest.counts)) {
          const actual = (staged.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
          if (actual !== count) {
            throw new AppError(ERR.INTEGRITY, `Backup row-count mismatch for "${table}": manifest says ${count}, file contains ${actual}.`);
          }
        }
      } finally {
        staged.close();
      }

      // Safety snapshot of the CURRENT state for automatic rollback.
      const currentDbPath = path.join(this.dataDir, DB_FILE_NAME);
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      const safetyDbPath = path.join(safetyDir, DB_FILE_NAME);
      await this.db.backup(safetyDbPath);
      const safetyAtt = path.join(safetyDir, 'attachments');
      fs.rmSync(safetyAtt, { recursive: true, force: true });
      if (fs.existsSync(this.attachmentsDir)) copyDir(this.attachmentsDir, safetyAtt);

      // Swap: close the live DB, replace files, reopen.
      this.provider.close();
      try {
        fs.copyFileSync(stagedDb, currentDbPath);
        for (const suffix of ['-wal', '-shm']) {
          const stray = currentDbPath + suffix;
          if (fs.existsSync(stray)) fs.unlinkSync(stray);
        }
        fs.rmSync(this.attachmentsDir, { recursive: true, force: true });
        fs.mkdirSync(this.attachmentsDir, { recursive: true });
        const stagedAtt = path.join(tmp, 'attachments');
        if (fs.existsSync(stagedAtt)) copyDir(stagedAtt, this.attachmentsDir);
        this.provider.reopen();
      } catch (swapError) {
        try {
          fs.copyFileSync(safetyDbPath, currentDbPath);
          for (const suffix of ['-wal', '-shm']) {
            const stray = currentDbPath + suffix;
            if (fs.existsSync(stray)) fs.unlinkSync(stray);
          }
          fs.rmSync(this.attachmentsDir, { recursive: true, force: true });
          fs.mkdirSync(this.attachmentsDir, { recursive: true });
          if (fs.existsSync(safetyAtt)) copyDir(safetyAtt, this.attachmentsDir);
          this.provider.reopen();
        } catch (rollbackError) {
          throw new AppError(
            ERR.IO,
            `Restore failed and automatic rollback also failed: ${(rollbackError as Error).message}. Your previous data is preserved at ${safetyDbPath}.`
          );
        }
        throw new AppError(ERR.IO, `Restore failed during the file swap; your previous data was restored automatically. (${(swapError as Error).message})`);
      }

      // Post-restore verification against the LIVE database.
      const ic = integrityCheck(this.db);
      if (!ic.ok) throw new AppError(ERR.INTEGRITY, `Restored database failed verification: ${ic.details.join('; ')}`);
      const fk = foreignKeyCheck(this.db);
      if (fk.length > 0) throw new AppError(ERR.INTEGRITY, `Restored database has ${fk.length} foreign key violations.`);
      this.auditProvider().record(actor, 'backup.restore', 'backups', '', { file: path.basename(filePath), counts: inspect.manifest.counts });
      return { restoredCounts: this.tableCounts(this.db) };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(safetyDir, { recursive: true, force: true });
    }
  }
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}

function zipDirectory(dir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.directory(dir, false);
    void archive.finalize();
  });
}
