/**
 * Activation gate regression suite. Uses fixture keyrings only — the
 * commercial production serial must never appear in this file, in tests, or
 * in any committed artifact. The fixture keyrings exercise the exact mechanism
 * production relies on: HMAC-digest verification, constant-time compare,
 * lockout, atomic state, machine binding, tamper rejection.
 */
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivationManager, normalizeSerial, machineFingerprint, type ActivationKeyring } from '../src/main/security/activation';
import { PRODUCTION_ACTIVATION_KEYRING } from '../src/main/security/activation.keys';

/** Build a keyring for a chosen (test) serial — mirrors how the production
 *  keyring was generated, without any real serial material in the repo. */
function buildKeyring(serial: string): ActivationKeyring {
  const norm = normalizeSerial(serial);
  const hmacKey = crypto.randomBytes(32).toString('hex');
  const stateKey = crypto.randomBytes(32).toString('hex');
  const expectedDigest = crypto
    .createHmac('sha256', Buffer.from(hmacKey, 'hex'))
    .update('dentiva.pro.activation.v1|' + norm)
    .digest('hex');
  return { hmacKey, stateKey, expectedDigest };
}

interface Harness { dir: string; keyring: ActivationKeyring; serial: string; norm: string; clock: { now: () => number; advance: (ms: number) => void } }

function harness(serial = 'DENTIVA-7742-1188-3590', fingerprint = 'fixture-machine-A'): { h: Harness; mgr: ActivationManager } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'den-act-'));
  let t = 1_700_000_000_000;
  const keyring = buildKeyring(serial);
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const mgr = new ActivationManager(dir, keyring, { now: clock.now, fingerprint: () => fingerprint });
  return { h: { dir, keyring, serial, norm: normalizeSerial(serial), clock }, mgr };
}

function reopen(h: Harness, fingerprint = 'fixture-machine-A'): ActivationManager {
  return new ActivationManager(h.dir, h.keyring, { now: h.clock.now, fingerprint: () => fingerprint });
}

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) {
    const dir = cleanup.pop()!;
    for (let i = 0; i < 6; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch {
        // Windows EBUSY (AV scanners / late handles): back off and retry.
        const until = Date.now() + 80 * (i + 1);
        while (Date.now() < until) { /* spin */ }
      }
    }
  }
});

describe('activation: normalization + validation', () => {
  it('uppercase, strips spacing/dashes', () => {
    expect(normalizeSerial(' dent-iva 7742-1188-3590 ')).toBe('DENTIVA774211883590');
    expect(normalizeSerial('')).toBe('');
    expect(normalizeSerial('a'.repeat(40))).toBe('A'.repeat(40)); // shape gate rejects later
  });

  it('empty or malformed input is refused without touching the state file', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    for (const bad of ['', '   ', 'short', '1'.repeat(40)]) {
      expect(() => mgr.activate(bad)).toThrowError(/serial/i);
    }
    expect(fs.existsSync(path.join(h.dir, 'activation-state.json'))).toBe(false);
  });
});

describe('activation: verify', () => {
  it('starts unactivated with a support-safe installation id', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    const s = mgr.status();
    expect(s.activated).toBe(false);
    expect(s.reason).toBe('none');
    expect(s.installationId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(s.installationId).not.toBe('0000-0000');
  });

  it('every wrong guess gets the identical, non-revealing message', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    const guesses = ['0000-0000-0000-0000', 'DENTIVA77421188359', 'DENTIVA-7742-1188-3591', 'CANARYCANARYCANARY', 'dentiva7742118835900'];
    const msgs = guesses.map((g) => {
      try { mgr.activate(g); return 'ACCEPTED'; } catch (e) { return (e as Error).message; }
    });
    expect(new Set(msgs).size).toBe(1);
    expect(msgs[0]).toBe('This activation serial is not valid for Dentiva Pro.');
    expect(msgs[0]).not.toMatch(/7742|CANARY/);
  });

  it('the correct serial activates; case/spacing variants too', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    expect(() => mgr.activate(' dentiva 7742 1188 3590 ')).not.toThrow();
    expect(mgr.isActivated()).toBe(true);
    const s = mgr.status();
    expect(s.reason).toBe('');
    expect(s.lockedUntil).toBeNull();
  });

  it('state file persists across restart and holds no serial material', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    mgr.activate(h.serial);
    const raw = fs.readFileSync(path.join(h.dir, 'activation-state.json'), 'utf8');
    expect(raw).not.toContain(h.norm);
    expect(raw).not.toContain('7742');
    expect(raw).not.toContain('DENTIVA');
    expect(reopen(h).isActivated()).toBe(true);
  });

  it('lockout: 5 failures → 60s refusal window that survives restart', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    for (let i = 0; i < 5; i++) {
      try { mgr.activate(`nope${i}${'x'.repeat(8)}`); } catch { /* expected */ }
    }
    const persisted = reopen(h);
    let msg = '';
    try { persisted.activate(h.serial); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/too many/i);
    h.clock.advance(59_000);
    expect(() => reopen(h).activate(h.serial)).toThrow(/too many/i);
    h.clock.advance(2_000);
    expect(() => reopen(h).activate(h.serial)).not.toThrow();
  });

  it('success resets the failure budget', () => {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    for (let i = 0; i < 4; i++) { try { mgr.activate(`bad${i}${'y'.repeat(10)}`); } catch { /* expected */ } }
    mgr.activate(h.serial);
    expect(reopen(h).isActivated()).toBe(true);
  });
});

describe('activation: tamper / corruption / machine binding', () => {
  function activated() {
    const { h, mgr } = harness(); cleanup.push(h.dir);
    mgr.activate(h.serial);
    return { h, stateFile: path.join(h.dir, 'activation-state.json') };
  }

  it('tampered token → tampered, not activated', () => {
    const { h, stateFile } = activated();
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.writeFileSync(stateFile, JSON.stringify({ ...st, token: '00'.repeat(32) }));
    const s = reopen(h).status();
    expect(s.activated).toBe(false);
    expect(s.reason).toBe('tampered');
  });

  it('garbage file → corrupt, not activated, no crash', () => {
    const { h, stateFile } = activated();
    fs.writeFileSync(stateFile, 'not json {{{');
    expect(reopen(h).status().reason).toBe('corrupt');
  });

  it('missing file → none', () => {
    const { h, stateFile } = activated();
    fs.rmSync(stateFile);
    expect(reopen(h).status().reason).toBe('none');
  });

  it('state replayed on another machine → mismatch; re-activation works there', () => {
    const { h } = activated();
    const other = reopen(h, 'fixture-machine-B');
    expect(other.status().activated).toBe(false);
    expect(other.status().reason).toBe('machine-mismatch');
    expect(() => other.activate(h.serial)).not.toThrow();
    expect(other.isActivated()).toBe(true);
  });

  it('activation survives a userData file-copy (backup/restore of app data)', () => {
    const { h, stateFile } = activated();
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'den-act-copy-')); cleanup.push(copyDir);
    fs.copyFileSync(stateFile, path.join(copyDir, 'activation-state.json'));
    const copy = new ActivationManager(copyDir, h.keyring, { now: h.clock.now, fingerprint: () => 'fixture-machine-A' });
    expect(copy.isActivated()).toBe(true);
  });
});

describe('activation: production hygiene', () => {
  it('production keyring is hex-only — no plaintext serial patterns in source', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/main/security/activation.keys.ts'), 'utf8');
    // Outside hex key material there must be no long digit runs (a real
    // serial would be one). Hex strings legitimately contain digits.
    const withoutHex = src.replace(/"[0-9a-f]{32,}"/g, '""');
    expect(withoutHex).not.toMatch(/\d{12,}/);
    const values = [...src.matchAll(/:\s*"([0-9a-f]+)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(v).toMatch(/^[0-9a-f]{64}$/);
  });

  it('production keyring rejects arbitrary guesses (spot checks, no secret probing)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'den-act-prod-')); cleanup.push(dir);
    const mgr = new ActivationManager(dir, PRODUCTION_ACTIVATION_KEYRING, { now: () => Date.now(), fingerprint: () => 'spot-check' });
    for (const g of ['', '000000000000', '1111111111111111', '1234567890123456', '0'.repeat(16)]) {
      expect(mgr.matchesCommercialSerial(g)).toBe(false);
    }
    expect(mgr.matchesCommercialSerial('not even close 9999999999')).toBe(false);
  });

  it('machine fingerprint is stable within a process', () => {
    expect(machineFingerprint()).toBe(machineFingerprint());
  });
});
