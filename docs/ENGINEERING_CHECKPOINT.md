# Engineering Checkpoint — Dentiva Pro

**Date:** 2026-09-26 (Asia/Dhaka) · **Branch:** `arena/01a0dc41-new-dentiva` · **Version targeted:** 1.0.0 (final commercial build)

This file is the always-current resume point. Read it first when continuing work.

## Current phase: FINAL CYCLE — complete, frozen candidate

The final forensic/premiumization cycle (directive of 2026-09-26) is **finished in-sandbox**.
Product is treated as feature-frozen; only defects justify further change.

## Verified quality gates (all green on this date, re-run independently after every fix)

| Gate | Command | Result |
| --- | --- | --- |
| Type safety | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Unit/integration tests | `npx vitest run` | **97/97 across 14 suites** (added tests/activation.test.ts, 16 cases) |
| Clinic-day E2E + activation | `npx tsx scripts/smoke.ts` | **14/14 scenarios PASS** |
| Static security audit | `npx tsx scripts/static-audit.ts` | clean (**9 gates**, new: activation confidentiality) |
| Perf budgets | `npx tsx scripts/perf.ts` | all hot paths within budget |
| Scale 10k | `npx tsx scripts/scale-test.ts 10000 3` | budgets met |
| Scale 100k + deep history | `npx tsx scripts/scale-test.ts 100000 2` | budgets met; 64 MB db; **3,000-entry lifetime timeline fully reachable, dup-free, 60.5 ms full walk** |
| Production bundle | `npx electron-vite build` | clean (renderer 368.9 kB JS, 23.7 kB CSS) |
| Production serial check | out-of-band run against built keyring (2026-09-26) | correct serial accepted (incl. spaced/dashed/lowercase), all guesses + 15-of-16-digit prefix rejected, state file secret-free, lockout honored. **Serial never in repo/logs/artifacts** |

## What changed this cycle (defects found → fixed → regression-protected)

1. **P0 §37 gap — no activation system existed.** Added: `src/main/security/activation.ts`
   (HMAC-digest verify, constant-time compare, machine-bound state file in userData,
   persisted lockout 5→60s×2ⁿ capped 1 h, atomic state write), `activation.keys.ts`
   (keyed digest only — serial never in plaintext anywhere), main-process gate in
   `ipc.ts` dispatch (`ACTIVATION_EXEMPT` = activation.*/app.info only — enforced in
   main, not by hiding UI), renderer `Activation.tsx` first-run gate + NOT_ACTIVATED
   global handling, Diagnostics activation line, boot-log status word (no secret
   material), smoke fixture round-trip, 16 unit tests, static-audit gate 9
   (no 12+ digit runs outside hex constants in src AND docs; gate-7 regex now also
   sees ipcMain.handle channels). Production keyring verified out-of-band (table above).
2. **P0 — PDF export & printing were broken on every document screen.** DocPreview sent
   `{html,size}` while main demanded `docKind`; main ignored `html` entirely. Fixed both
   sides: renderer forwards `{docKind, ...payload}`; main ALWAYS rebuilds document HTML
   server-side (renderer HTML never trusted; also kills an HTML-injection surface).
3. **P1 — `documents.pdf`/`documents.printDoc` bypassed RBAC/session** (handled before the
   permission-checked router). Now gated by `docActorFor()` (requireActor +
   `documents.print`, forbidden-audited).
4. **P1 — multi-page print clipping:** continuation pages had zero margins (padding-based
   sheet + margins:0). Now: print media zeroes sheet padding; `@page` margin for system
   print; printToPDF custom margins (mm→px@96) from shared `PAGE_MARGINS_MM`; multi-page
   PDFs get a footer "Prescription · Page x of y" (80mm roll exempt). Verified via
   documents tests + preview-parity invariant.
5. **P2 — Patient 360 timeline had hidden 1000-per-source caps + silent 500-item ceiling.**
   Replaced with SQL UNION-ALL merged, fully paginated `visits.timeline(page,pageSize)`
   (+total). Regression tests: 3000-entry walk dup-free, complete, deterministic; scale
   test enforces reachability at 100k. UI: "Showing n of total / Load 60 more".
6. **P2 — prescription directions field was dead** (`customInstructions` always ''):
   RxBuilderDialog now has a real **Directions** input per medicine (printed under the
   med line, ahead of Notes).
7. **P2 — statement header abused the "No:" slot** → labelled "Statement period".
8. **P3 polish:** dead/fake routes deleted (`ui.toast` fake-success, `win.setTitle`,
   unreachable win pseudo-routes, dead `documents.assets`); `prefers-reduced-motion` kill
   switch; dialog/overlay/toast micro-animations (≤160 ms); auth-card activation styles;
   window `minHeight` 700→640 so the app fits 1280×720 with the Windows taskbar;
   production menu removed + devtools closed on open (`!isDev`); global
   `web-contents-created` hardening (every webContents: deny windows/navigation,
   https handoff only).

## Non-negotiable invariants (tests + smoke + static audit)

1. Money is integer paisa; floats never touch amounts.
2. Receipt numbers exist only after a payment row persists; idempotent `clientRef`.
3. Prescriptions carry zero financial fields (CSS + payload + audit gate); plans never create invoices.
4. Patient codes generated once, never reused, never from list position.
5. Backups zipped with SHA-256 manifest; restore stage-verify-commit; corrupt archives refused.
   **Activation state is intentionally OUTSIDE backups** (machine-bound; restore never clobbers it).
6. Inventory never goes invalid-negative.
7. Renderer reaches backend only via preload allowlist; every channel permission-checked.
8. **No clinic-data channel is reachable before activation** (enforced in main dispatch).
9. The commercial serial appears in no source, doc, log, bundle or artifact; the static
   audit gate fails the build if a 12+ digit literal (or doc digit-run) ever appears.

## Environment notes (this sandbox)

- `npm ci --ignore-scripts` then rebuild better-sqlite3 for Node ABI:
  `cd node_modules/better-sqlite3 && npm_config_nodedir=/usr/local npx node-gyp rebuild --release`
  (plain `npm ci` fails: nodejs.org header download is blocked here).
- electron binary dist absent / GitHub asset hosts TLS-blocked → no local Windows packaging;
  CI (windows-latest) owns packaging + clean-boot + NSIS install/uninstall verification.
  CI now automatically runs the activation suite (vitest) and smoke scenario.

## Release pipeline status

- CI `.github/workflows/ci.yml` (ubuntu): npm ci → typecheck → 97 tests → smoke → static audit →
  perf → 10k scale → bundle. (Previously green; must re-confirm on this branch's push.)
- Release `.github/workflows/release.yml`: tag-triggered full matrix incl. windows-latest
  packaging, clean-boot (portable + NSIS silent install/uninstall), SHA256SUMS, manifest to
  `ci-logs`. Last rehearsal on prior commit chain: run 36151570959 green.
- Release procedure: merge this branch → `git tag -a v1.0.0` → push → workflow builds+publishes.
  **The activation gate must be reflected in the clean-machine protocol — see docs/RELEASE.md §5.**

## Remaining known issues (live list — nothing else is knowingly deferred)

| # | Item | Severity | Status |
| --- | --- | --- | --- |
| 1 | Code signing certificate | P2 (commercial) | Open by decision — unsigned builds warn in SmartScreen; CI skips signing by design |
| 2 | Physical-machine install pass | P2 | Recommended; CI clean-boot+install/uninstall is automated per release run |
| 3 | Serial PDF visual eyeball on Windows printer drivers | P3 | Print paths unit-verified; geometry shared between preview/PDF/print; no physical printer in sandbox |

## Next exact action

Push `arena/01a0dc41-new-dentiva` → open PR → CI green → merge → tag `v1.0.0` → release.yml
produces + verifies final artifacts (this branch's commit) → paste run link + hashes into
docs/FINAL_RELEASE_REPORT.md §7 → ship.
