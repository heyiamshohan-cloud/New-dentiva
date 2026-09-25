# Engineering Checkpoint — Dentiva Pro

**Date:** 2026-09-25 (Asia/Dhaka) · **Branch:** `arena/01a0d800-new-dentiva` · **Version targeted:** 1.0.0

This file is the always-current resume point. Read it first when continuing work.

## Verified quality gates (all green on this date)

| Gate | Command | Result |
| --- | --- | --- |
| Type safety | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Unit/integration tests | `npx vitest run` | 81/81 across 13 suites |
| Production build | `npx electron-vite build` | clean (main 108 kB, renderer 364 kB JS, 23 kB CSS) |
| End-to-end clinic day | `npx tsx scripts/smoke.ts` | 13/13 scenarios PASS |
| Static security audit | `npx tsx scripts/static-audit.ts` | clean (8 gates) |
| Perf budgets | `npx tsx scripts/perf.ts` | all hot paths within budget |
| Scale — 10k patients | `npx tsx scripts/scale-test.ts 10000 3` | budgets met (worst 11.3 ms) |
| Scale — 100k patients | `npx tsx scripts/scale-test.ts 100000 3` | budgets met (worst 39.5 ms, 86 MB db) |

## Architecture snapshot

- `src/main/` — main process: `context.ts` (AppContext service container), `db/` (migrations, WAL), `services/` (27 services), `documents/` (single document engine: HTML templates → PDF; preview == PDF), `security/` (scrypt passwords, session with inactivity lock), `domain/` (integer-paisa money, dates).
- `src/main/ipc.ts` — table-driven permission-checked route registry; `src/main/preload.ts` — the ONLY bridge (channel allowlist).
- `src/renderer/src/` — React 18 app: 20 pages (Dashboard, Patients, Patient360, Appointments, Queue, Treatments, Prescriptions, Invoices, Payments, Accounting, Inventory, Reports, Staff, Audit, Backup, Settings, Diagnostics, Setup wizard, Login, Lock).
- `src/shared/` — types (money as `Paisa`), permissions matrix, RBAC `roleHas()`.

## Non-negotiable invariants (covered by tests + smoke + static audit)

1. Money is integer paisa; floats never touch amounts.
2. Receipt numbers exist only after a payment row persists; idempotent `clientRef`.
3. Prescriptions carry zero financial fields; plans never create invoices.
4. Patient codes are generated once, never reused, never derived from list position.
5. Backups are zipped with a SHA-256 manifest; restore validates first and refuses corrupt/partial archives; restore is atomic (stage-wipe-verify-commit).
6. Inventory never goes invalid-negative (`ERR.CONFLICT` on insufficient stock).
7. Renderer reaches the backend only through the preload allowlist; every channel has a permission-checked handler.

## Environment notes (this sandbox)

- better-sqlite3 native addon was rebuilt for the host Node ABI with
  `npm_config_nodedir=/usr/local node-gyp rebuild --release` inside
  `node_modules/better-sqlite3` after the binding went stale. Re-run that if
  tests fail with "Could not locate the bindings file". For packaging, run
  `npm run rebuild:native` (electron-builder install-app-deps) to target the
  Electron ABI instead; then rebuild for Node again before running vitest.
- Probed 2026-09-25: `node_modules/electron/dist` is EMPTY (binary download
  wiped per snapshot), no wine/xvfb, `objects.githubusercontent.com` and
  npmmirror both TLS-blocked; only registry.npmjs.org + github.com HTML work.
  Consequence: no local packaging of ANY platform in this sandbox — use CI.

## Release pipeline — END-TO-END VERIFIED 2026-09-25

CI (`.github/workflows/ci.yml`): every push/PR on ubuntu-latest — npm ci →
typecheck → 81 tests → smoke → static audit → perf → 10k scale → bundle.
First live run 36140789652: **green (40 s)**.

Release (`.github/workflows/release.yml`): tag-triggered (final tags publish;
pre-release tags like `v1.0.0-rc1` and manual dispatch build + verify without
publishing). Rehearsal campaign on tag `v1.0.0-rc1` (9 iterations, run ids
36141258362 … 36146099881) found and fixed, in order:
1. Windows EBUSY in tests (DB open during temp rm) → close-then-rm + retries
   (tests/perf.test.ts, tests/race.test.ts, helpers/schema/backup rm flags).
2. `build/icon.ico` referenced but never committed → deterministic
   `scripts/build-icon.mjs` (@resvg/resvg-js → png-to-ico, 6 frames) + `npm run icon`.
3. `electron-builder.yml`: unknown top-level key `zip:` removed (fails schema
   validation).
4. Same file: `${target}` macro removed from win-level `artifactName`
   (undefined macro error after pack/sign-skip stage).
5. Same file: `npmRebuild: false` (CI already runs install-app-deps; avoids
   node-gyp cross-compile refusal) and explicit `files:` allowlist dropped so
   production deps externalized by electron-vite (better-sqlite3/archiver/
   extract-zip/zod) actually ship.
6. Clean-boot step: GUI-subsystem processes reject std-handle redirection —
   polling loop now watches PID + userData (≤90 s) instead.
**FINAL verified rehearsal: run 36151570959 (v1.0.0-rc1 @ 234c4a7, all 10
applicable steps green).** Two further real defects were found & fixed after
an earlier note incorrectly claimed green: (a) boot diagnostics/step-order +
GUI redirect assumptions; (b) packaged app crashed at first boot with
"Cannot find module 'archiver-utils'" (screenshot-evidenced, run 36150749531)
→ pure-JS deps now inlined into the main bundle. Full corrected evidence
table: docs/FINAL_RELEASE_REPORT.md §5. Artifacts + SHA-256 manifest:
`ci-logs/manifests/v1.0.0-rc1/`. Diagnostics flow: on failure the workflow
pushes logs/screenshots to branch `ci-logs`; on success the manifest.

Release procedure now: PR arena branch → main (merge) →
`git tag -a v1.0.0 -m "Dentiva Pro 1.0.0" <merge-sha> && git push origin v1.0.0`
→ release.yml runs the whole pipeline and PUBLISHES the GitHub Release
(final tag has no `-` suffix).

## Release blockers (live list)

| # | Blocker | Status |
| --- | --- | --- |
| 1 | Windows artifacts built from the release commit | **CLOSED (mechanism)** — produced & verified in CI run 36146099881 (`v1.0.0-rc1` rehearsed, not published); first final tag produces the shippable set |
| 2 | Clean-machine install/run verification | **CLOSED (CI level)** — portable boot + NSIS silent install/uninstall verified on a fresh windows-latest runner each run; optional physical-machine pass per `docs/RELEASE.md` §5 remains recommended |
| 3 | Signed executables (code-signing cert) | Open — commercial decision |

No code-level blockers remain.
