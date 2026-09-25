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

## Release path now automated

- `.github/workflows/ci.yml` — every push/PR on ubuntu-latest: npm ci →
  typecheck → 81 tests → smoke → static audit → perf → 10k scale → bundle.
- `.github/workflows/release.yml` — on tag `v*.*.*` (windows-latest): full
  gates incl. 100k scale → bundle → electron-ABI native rebuild →
  electron-builder (NSIS + portable + ZIP per `electron-builder.yml`) →
  `SHA256SUMS.txt` + manifest via `scripts/postdist.cjs` → clean-boot test
  (launches the portable exe on the runner, asserts 30 s liveness + userData
  creation, then kills it) → artifact upload → `gh release create` with all
  of `release/*` and `docs/RELEASE_NOTES.md` as notes.

  Release procedure shrinks to: keep gates green → `git tag -a v1.0.0 -m "…"`
  → `git push origin v1.0.0` → watch the run.

## Release blockers (live list)

| # | Blocker | Status |
| --- | --- | --- |
| 1 | Windows artifacts built from the release commit | Path automated in `release.yml` — closes on first tag push |
| 2 | Clean-machine install/run verification | Portable-exe boot test automated in CI; NSIS silent-install step and a physical-machine pass per `docs/RELEASE.md` §5 still pending the first produced artifact |
| 3 | Signed executables (code-signing cert) | Open — commercial decision |

No code-level blockers remain.
