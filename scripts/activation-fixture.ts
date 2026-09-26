/**
 * Test-only activation keyring factory (mirrors the offline generator used for
 * the production keyring). Lets the smoke suite exercise the FULL activation
 * round-trip — positive and negative paths — without any production secret
 * material ever touching the repository.
 */
import crypto from 'node:crypto';

export interface FixtureKeyring {
  hmacKey: string;
  stateKey: string;
  expectedDigest: string;
}

export function buildKeyringFor(serial: string): FixtureKeyring {
  const norm = String(serial).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hmacKey = crypto.randomBytes(32).toString('hex');
  const stateKey = crypto.randomBytes(32).toString('hex');
  const expectedDigest = crypto
    .createHmac('sha256', Buffer.from(hmacKey, 'hex'))
    .update('dentiva.pro.activation.v1|' + norm)
    .digest('hex');
  return { hmacKey, stateKey, expectedDigest };
}
