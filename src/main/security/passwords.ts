import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, ERR } from '@shared/types';

/**
 * Password storage: scrypt with per-user salt, format `scrypt:N:r:p:salt:hash`
 * (base64). Never store plaintext; never log passwords (spec: Authentication,
 * Privacy).
 */
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  assertPasswordStrength(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nS, rS, pS, saltB64, hashB64] = stored.split(':');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(nS),
      r: Number(rS),
      p: Number(pS)
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError(ERR.VALIDATION, 'Password must be at least 8 characters long.');
  }
  if (password.length > 200) {
    throw new AppError(ERR.VALIDATION, 'Password is too long.');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError(ERR.VALIDATION, 'Password must contain both letters and numbers.');
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
