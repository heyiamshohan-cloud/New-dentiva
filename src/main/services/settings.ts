import type Database from 'better-sqlite3';

export interface ReportFavorite {
  kind: string;
  from?: string;
  to?: string;
}

export interface AppSettings {
  lockTimeoutMinutes: number;
  backupDirectory: string;
  autoBackupOnExit: boolean;
  autoBackupIntervalHours: number;
  defaultPaymentMethodsSeeded: boolean;
  setupComplete: boolean;
  attachmentMaxMb: number;
  reportFavorites: ReportFavorite[];
}

const DEFAULTS: AppSettings = {
  lockTimeoutMinutes: 10,
  backupDirectory: '',
  autoBackupOnExit: false,
  autoBackupIntervalHours: 24,
  defaultPaymentMethodsSeeded: false,
  setupComplete: false,
  attachmentMaxMb: 25,
  reportFavorites: []
};

/** App-level key/value settings with typed accessors. */
export class SettingsService {
  constructor(private db: Database.Database) {}

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return DEFAULTS[key];
    try {
      return JSON.parse(row.value) as AppSettings[K];
    } catch {
      return DEFAULTS[key];
    }
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  all(): AppSettings {
    return { ...DEFAULTS, ...Object.fromEntries((Object.keys(DEFAULTS) as (keyof AppSettings)[]).map((k) => [k, this.get(k)])) };
  }
}
