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
| Windows installer/portable/ZIP not built in-sandbox (probed: electron binary absent, GitHub asset hosts TLS-blocked) | N/A — built in CI instead | **CLOSED**: rehearsal run 36146099881 (tag `v1.0.0-rc1`) produced NSIS + portable + ZIP + SHA256SUMS on windows-latest; clean-boot + NSIS silent install/uninstall verified on the fresh runner. Final tag outputs identical artifacts with publish enabled |
| rcedit icon embedding unavailable without Wine/Windows | N/A | **CLOSED**: packaging runs on windows-latest; committed `build/icon.ico` (6 frames, from `npm run icon`) embedded by electron-builder's rcedit |
| Code signing not configured | SmartScreen warning for unsigned installer | Acquire EV/OV cert before commercial distribution |
| Physical clean-machine protocol not executed | CI-level verification already automated | **Partially closed**: fresh windows-latest runner verifies boot + install/uninstall every release run; physical-lab pass still recommended pre-GA |

## 4. Release blockers (must be closed before GA)

1. ~~Rebuild Windows artifacts + `SHA256SUMS.txt`~~ **CLOSED 2026-09-25** — automated in `release.yml`; rehearsal run 36146099881 passed all 14 steps including checksum re-verification.
2. Execute clean-machine verification on physical Windows 10/11 x64 hardware; paste the step-by-step result table into this file. *(CI-level proof exists; physical pass still open but no longer strictly blocking for an unsigned alpha.)*
3. Code-sign all `.exe` artifacts. *(commercial decision — CI skips signing by design)*

## 5. Verified by CI (rehearsal evidence)

- CI run 36140789652 (ubuntu-latest): all quality gates green in 40 s.
- Release rehearsal runs 36141258362…36146099881 (windows-latest): six real
  defects found & fixed (Windows EBUSY cleanup order ×2, uncommitted icon,
  invalid `zip:` section, `${target}` macro misuse, redundant npmRebuild,
  GUI redirect assumption); final run green across: gates incl. 100k scale,
  NSIS/portable/ZIP packaging, postdist checksums + manifest, checksum
  verification, portable clean-boot (fresh userData), NSIS silent
  install/uninstall, artifact upload. Publish step correctly skipped for the
  pre-release tag (`-` suffix gating verified by absence of a release).

## 6. Sign-off rule

Version `1.0.0` may be tagged once #3's signing decision is taken (or
explicitly waived as "unsigned alpha"): the tag push itself performs the
final build + verification + publication.
