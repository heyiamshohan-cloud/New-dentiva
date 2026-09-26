/**
 * Product activation: the app refuses all business operations until a valid
 * commercial serial has been entered on this machine (spec: Serial Activation).
 *
 * Design constraints honored here:
 *  - The valid serial is stored nowhere — validation is a keyed HMAC-SHA256
 *    digest comparison in constant time (see activation.keys.ts).
 *  - No online dependency: verification is entirely local.
 *  - The activation state file lives beside the database in userData and is
 *    machine-bound: copying it to another machine (or reinstalling elsewhere)
 *    requires re-entering the serial. A tampered or corrupt state file is
 *    treated as not-activated, never as activated.
 *  - Repeated failures trigger an exponentially growing lockout that survives
 *    restarts (it is persisted in userData), so brute-forcing is throttled.
 *  - Error messages never reveal whether a prefix, length or character of a
 *    guess was "close" — every wrong serial gets the same outcome.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError, ERR } from '@shared/types';

export interface ActivationKeyring {
  /** hex HMAC key used to verify a candidate serial against the digest. */
  hmacKey: string;
  /** hex key used to sign the per-machine activation state file. */
  stateKey: string;
  /** hex HMAC-SHA256 of the canonical `PREFIX|normalizedSerial`. */
  expectedDigest: string;
}

/** Canonicalization: uppercase, strip every non-alphanumeric character.
 *  "1516-5919 …" style entry, spacing and case are therefore irrelevant. */
export function normalizeSerial(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const SERIAL_SHAPE = /^[A-Z0-9]{12,32}$/;
const DIGEST_PREFIX = 'dentiva.pro.activation.v1|';
const STATE_PREFIX = 'dentiva.pro.activation-state.v1|';
const MAX_FAILURES = 5;
const LOCKOUT_BASE_MS = 60_000;
const LOCKOUT_CAP_MS = 60 * 60_000;

export type ActivationReason = '' | 'none' | 'corrupt' | 'tampered' | 'machine-mismatch';

export interface ActivationStatus {
  activated: boolean;
  reason: ActivationReason;
  /** Short non-sensitive reference for support (first 8 hex of machine hash). */
  installationId: string;
  /** Epoch ms until which activation attempts are locked out, if any. */
  lockedUntil: number | null;
}

export interface ActivationDeps {
  now?: () => number;
  fingerprint?: () => string;
}

/** Best-effort stable hardware identity: machine-id + MAC + hostname + arch.
 *  A partial change makes the install look "mismatched" (recoverable by
 *  re-entering the serial) rather than permanently locked. */
export function machineFingerprint(): string {
  let machineId = '';
  try {
    // os.machineId() exists since Node 18.9 (Linux dbus id / Windows machine
    // GUID / macOS IOPlatformUUID) but is absent from some @types/node revs.
    const mid = (os as unknown as { machineId?: () => string }).machineId;
    if (typeof mid === 'function') machineId = mid();
  } catch {
    machineId = '';
  }
  const mac = Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => !!i && !i.internal && !!i.mac)
    .map((i) => String(i!.mac).toLowerCase())
    .sort()[0] ?? 'nomac';
  return [os.hostname(), os.platform(), os.arch(), machineId, mac].join('|');
}

export class ActivationManager {
  private readonly stateFile: string;
  private readonly now: () => number;
  private readonly fingerprint: () => string;
  private cached: ActivationStatus | null = null;

  constructor(dataDir: string, private keyring: ActivationKeyring, deps: ActivationDeps = {}) {
    this.stateFile = path.join(dataDir, 'activation-state.json');
    this.now = deps.now ?? Date.now;
    this.fingerprint = deps.fingerprint ?? machineFingerprint;
  }

  /** Candidate serial validation only — pure, no state touched. */
  private normalizeChecked(raw: string): string {
    const norm = normalizeSerial(raw);
    if (!norm) throw new AppError(ERR.VALIDATION, 'Enter your activation serial to continue.');
    if (!SERIAL_SHAPE.test(norm)) {
      throw new AppError(ERR.VALIDATION, 'An activation serial is 12 to 32 letters and digits.');
    }
    return norm;
  }

  /** Constant-time digest check against the embedded commercial serial. */
  private serialMatches(norm: string): boolean {
    const candidate = this.hmacHex(this.keyring.hmacKey, DIGEST_PREFIX + norm);
    return this.digestEqual(candidate, this.keyring.expectedDigest);
  }

  private hmacHex(keyHex: string, message: string): string {
    return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(message).digest('hex');
  }

  private digestEqual(a: string, b: string): boolean {
    const A = Buffer.from(a, 'hex');
    const B = Buffer.from(b, 'hex');
    return A.length === 32 && B.length === 32 && crypto.timingSafeEqual(A, B);
  }

  private machineHash(): string {
    return this.hmacHex(this.keyring.stateKey, STATE_PREFIX + this.fingerprint());
  }

  installationId(): string {
    return this.machineHash().slice(0, 8).toUpperCase().replace(/^(.{4})(.*)$/, '$1-$2');
  }

  private stateToken(machineHash: string): string {
    return this.hmacHex(this.keyring.stateKey, STATE_PREFIX + 'ok|' + machineHash);
  }

  private readState(): Record<string, unknown> | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.stateFile, 'utf8');
    } catch {
      return null; // missing → not activated ('none')
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && parsed.v === 1 && typeof parsed.machineHash === 'string') return parsed;
    } catch {
      // fall through
    }
    return { v: 1, machineHash: '', corrupt: true };
  }

  private writeState(state: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }

  /** Fast hot-path check used by the IPC gate; cached after first read.
   *  The cache is dropped whenever this process changes activation state. */
  isActivated(): boolean {
    return this.status().activated;
  }

  status(): ActivationStatus {
    if (this.cached) return this.cached;
    const out = this.computeStatus();
    this.cached = out;
    return out;
  }

  private computeStatus(): ActivationStatus {
    const installationId = this.installationId();
    const st = this.readState();
    const lockUntil = typeof st?.lockUntil === 'number' && st.lockUntil > this.now() ? st.lockUntil : null;
    if (!st) return { activated: false, reason: 'none', installationId, lockedUntil: lockUntil };
    if (st.corrupt === true) return { activated: false, reason: 'corrupt', installationId, lockedUntil: lockUntil };
    if (st.machineHash !== this.machineHash()) {
      return { activated: false, reason: 'machine-mismatch', installationId, lockedUntil: lockUntil };
    }
    if (typeof st.token !== 'string' || !this.digestEqual(st.token, this.stateToken(this.machineHash()))) {
      return { activated: false, reason: 'tampered', installationId, lockedUntil: lockUntil };
    }
    return { activated: true, reason: '', installationId, lockedUntil: null };
  }

  /** Validate + persist activation. Throws AppError on any failure; the
   *  thrown messages never contain anything derived from the serial. */
  activate(raw: string): ActivationStatus {
    const norm = this.normalizeChecked(raw);
    const st = this.readState();
    const lockUntil = typeof st?.lockUntil === 'number' ? st.lockUntil : 0;
    if (lockUntil > this.now()) {
      const mins = Math.max(1, Math.ceil((lockUntil - this.now()) / 60_000));
      throw new AppError(ERR.TOO_MANY_ATTEMPTS, `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    // An expired lockout resets the failure budget for this attempt.
    const carried = lockUntil > 0 && lockUntil <= this.now() ? 0 : typeof st?.failCount === 'number' ? st.failCount : 0;

    if (!this.serialMatches(norm)) {
      const failCount = carried + 1;
      const next: Record<string, unknown> = { v: 1, machineHash: typeof st?.machineHash === 'string' ? st.machineHash : '', failCount };
      if (typeof st?.token === 'string') next.token = st.token;
      if (typeof st?.activatedAt === 'string') next.activatedAt = st.activatedAt;
      if (failCount >= MAX_FAILURES) {
        next.lockUntil = this.now() + Math.min(LOCKOUT_BASE_MS * 2 ** (failCount - MAX_FAILURES), LOCKOUT_CAP_MS);
      }
      this.writeState(next);
      this.cached = null;
      throw new AppError(ERR.FORBIDDEN, 'This activation serial is not valid for Dentiva Pro.');
    }

    const machineHash = this.machineHash();
    this.writeState({ v: 1, machineHash, token: this.stateToken(machineHash), activatedAt: new Date(this.now()).toISOString(), failCount: 0 });
    this.cached = null;
    return this.status();
  }

  /** Whether a candidate string equals the commercial serial (used by the
   *  first-run gate and out-of-band release checks). Input is never retained. */
  matchesCommercialSerial(raw: string): boolean {
    let norm: string;
    try {
      norm = this.normalizeChecked(raw);
    } catch {
      return false;
    }
    return this.serialMatches(norm);
  }
}
