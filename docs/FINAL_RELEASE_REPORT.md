# Final Release Report — Dentiva Pro 1.0.0

**Report date:** 2026-09-25 (Asia/Dhaka)
**Branch / commit target:** `arena/01a0d800-new-dentiva`
**Assessment:** **Alpha-candidate (unsigned), blocked on Windows packaging host** — all engineering gates pass; distribution artifacts must still be rebuilt from this commit on a network-enabled Windows/Wine host, then clean-machine verified (see Blockers).

---

## 1. Executed verification (evidence)

| Check | Command | Outcome (2026-09-25) |
| --- | --- | --- |
| Static types | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Test suite | `npx vitest run` | 81/81 (13 files): auth, backup, billing, clinical, dataTransfer, documents, financial, inventory, money, patients, perf, race, schema |
| Clinic-day E2E | `npx tsx scripts/smoke.ts` | 13/13 PASS — setup→login→RBAC→patients→appointment conflict→visit/chart→plan (no auto-invoice)→prescription (financial-free)→invoice→issue→idempotent payment/receipt→statement→inventory negative-stock refusal→attachment byte-integrity→backup→wipe→restore→audit anchor |
| Source security audit | `npx tsx scripts/static-audit.ts` | CLEAN — 8 gates: no network calls, no embedded secrets, no placeholders, no float money parsing, parameterized SQL only (with proven-safe constant fragments), renderer↔main via allowlisted bridge only, IPC route parity, Electron hardening flags present |
| Latency budgets | `npx tsx scripts/perf.ts` | all hot paths ≤ budget (worst 5.3 ms on 2k-patient dataset) |
| Scale 10k | `npx tsx scripts/scale-test.ts 10000 3` | budgets met; worst path 11.3 ms |
| Scale 100k | `npx tsx scripts/scale-test.ts 100000 3` | budgets met; worst path 39.5 ms (typeahead); financial rollup exact over 200-invoice long-history patient; db 86 MB |
| Production bundle | `npx electron-vite build` | clean; renderer 364 kB JS + 23 kB CSS |

Numeric claims above come from direct tool output on the stated date, not estimates.

## 2. Spec compliance highlights

- **Money:** integer paisa everywhere (`Paisa`); arithmetic via `src/main/domain/money.ts`; totals proven across 100k-scale rollups and idempotent payment replays.
- **Patient identity:** random-unique codes at insert (collision-retried), stable across edits/restores; duplicate detection warns — never auto-merges.
- **Separation of concerns:** prescriptions verified to contain no financial keys at the service payload level; treatment plans verified to never create invoices.
- **Data safety:** backup archives carry a SHA-256 file manifest; restore stages, verifies, and rejects corrupt archives outright (`inspectBackup` + smoke scenario).
- **Security:** scrypt password hashing, session lock, RBAC enforced in main (`roleHas`), contextIsolation on, nodeIntegration off, CSP via meta tag in renderer HTML, parameterized SQL enforced by the static audit gate.
- **Offline:** static audit asserts zero fetch/XHR/WebSocket usage and no third-party hosts; only user-initiated `shell.openExternal` is permitted.

## 3. Known limitations (honest)

| Item | Impact | Plan |
| --- | --- | --- |
| Windows installer/portable/ZIP not rebuilt in-sandbox (probed: electron binary absent, GitHub asset hosts TLS-blocked) | Artifact may not reflect current source | **Automated**: `.github/workflows/release.yml` builds, checksummes, clean-boot tests and publishes on tag push |
| rcedit icon embedding unavailable without Wine/Windows | Default Electron icon if built on bare Linux | Use Windows runner (or Wine) for packaging |
| Code signing not configured | SmartScreen warning for unsigned installer | Acquire EV/OV cert before commercial distribution |
| Clean-machine protocol not yet executed | Real-world first-run unverified | Execute `docs/RELEASE.md` §5 and record results here |

## 4. Release blockers (must be closed before GA)

1. Rebuild Windows artifacts (installer, portable, ZIP) from this commit + generate `SHA256SUMS.txt`.
2. Execute clean-machine verification on physical Windows 10/11 x64 hardware; paste the step-by-step result table into this file.
3. Code-sign all `.exe` artifacts.

## 5. Sign-off rule

Version `1.0.0` may be tagged only when every blocker in §4 reads **CLOSED** and §1 is re-executed against the release commit with all gates green.
