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
- Outbound network to github.com/asset hosts is blocked in this sandbox; the
  npm registry IS reachable. Windows installer rebuild is documented in
  `docs/RELEASE.md` and must run where electron-builder can download the
  Electron/winCodeSign/NSIS toolchains (or with a pre-seeded
  `ELECTRON_BUILDER_CACHE`).
- Wine is unavailable in this sandbox: `rcedit` icon embedding cannot be
  executed here. Do it on a Windows runner (CI) or accept the default icon.

## Release blockers (live list)

| # | Blocker | Status |
| --- | --- | --- |
| 1 | Windows artifacts (NSIS installer, portable, ZIP + SHA-256 sums) rebuilt from THIS commit | **Open** — requires network-enabled build host |
| 2 | Clean-machine install/run verification of installer on a real Windows box | Open — depends on #1 |
| 3 | Signed executables (code-signing cert) | Open — commercial decision |

No code-level blockers remain.
