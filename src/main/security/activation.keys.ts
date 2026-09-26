/**
 * Embedded activation keyring — generated once at release time, NOT editable.
 *
 * SECURITY MODEL (why this is safe to ship inside the app bundle):
 *  - The commercial activation serial appears NOWHERE in this file, in any
 *    source tree, doc, log, or artifact. Only a keyed HMAC-SHA256 digest of it
 *    is stored, and keyed digests are one-way: recovering the serial from
 *    `expectedDigest` requires a brute-force over the full serial space with
 *    the HMAC key in hand.
 *  - Verification is `HMAC(hmacKey, "dentiva.pro.activation.v1|" + normalized(input))`
 *    compared to `expectedDigest` in constant time (see activation.ts).
 *  - `stateKey` signs the per-machine activation state so a copied state file
 *    cannot be replayed on another machine; `hmacKey` never leaves this file.
 *  - Rotating or revoking serials requires a signed app update: rebuild with
 *    a fresh keyring (scripts/activation-keygen.mjs, deliberately not shipped).
 */
import type { ActivationKeyring } from "./activation";

export const PRODUCTION_ACTIVATION_KEYRING: ActivationKeyring = {
  hmacKey: "ea43aa4034171ef452725836709ed62b1eda7ff82ee0b1b558cbb5ca13226d65",
  stateKey: "bcbaaeaf3655410e53fa792a1a6608260840d634f83ac9c3dede3ad71d29c466",
  expectedDigest: "7fd2d0f166923ee8d67c03c8bd97c7d3bb7e8c7350b876c7764a2d74ebd4fe27"
};
