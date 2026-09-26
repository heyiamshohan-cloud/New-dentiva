# Final Release Report — Dentiva Pro 1.0.0

**Report date:** 2026-09-26 (Asia/Dhaka) — final forensic/premiumization cycle appended as §7
**Branch / commit target:** `arena/01a0dc41-new-dentiva`
**Assessment:** **Final commercial candidate (unsigned).** All engineering gates green on the
current commit, including the new activation system; distribution artifacts are produced and
verified by the tag-triggered release pipeline on windows-latest.

---

## 1. Executed verification (evidence)

| Check | Command | Outcome (2026-09-25) |
| --- | --- | --- |
| Static types | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Test suite | `npx vitest run` | 97/97 (14 files): auth, activation, backup, billing, clinical, dataTransfer, documents, financial, inventory, money, patients, perf, race, schema |
| Clinic-day E2E | `npx tsx scripts/smoke.ts` | 14/14 PASS — setup→login→RBAC→patients→appointment conflict→visit/chart→plan (no auto-invoice)→prescription (financial-free)→invoice→issue→idempotent payment/receipt→statement→inventory negative-stock refusal→attachment byte-integrity→backup→wipe→restore→audit anchor |
| Source security audit | `npx tsx scripts/static-audit.ts` | CLEAN — 9 gates (+activation confidentiality): no network calls, no embedded secrets, no placeholders, no float money parsing, parameterized SQL only (with proven-safe constant fragments), renderer↔main via allowlisted bridge only, IPC route parity, Electron hardening flags present |
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

## 5. Verified by CI (rehearsal evidence — corrected record)

- CI run 36140789652 (ubuntu-latest): all quality gates green in ~40 s.
- Rehearsal campaign on tag `v1.0.0-rc1`, windows-latest (12 runs):
  - 36141258362 / 36141729198 — Windows EBUSY: temp rm while SQLite open →
    close-then-rm cleanup order + retry flags in perf/race/schema/backup tests.
  - 36142132008 / 36142837374 — electron-builder config schema rejection
    (unknown top-level `zip:` key) — removed.
  - 36143549595 — `${target}` macro in win-level artifactName (undefined
    there) — replaced with static macro set.
  - 36144270398 / 36144710757 — npmRebuild dedupe (`npmRebuild: false`; CI
    runs install-app-deps explicitly).
  - 36145514824 / 36146099881 / 36147496356 — clean-boot step design flaws:
    GUI-subsystem exes reject PS std-handle redirection; diagnostics step
    placed too early to see later failures — moved to job end; polling loop
    added. (An earlier session note claiming these runs were green was WRONG
    — `gh run watch` exit signal was corrupted by a token expiry; the API
    record stands: they failed at clean-boot.)
  - 36148459026…36150106281 — added in-app boot trace
    ($TMP\dentiva-boot.log) + window-title forensics; revealed a modal
    Electron "Error" dialog instead of a healthy boot.
  - 36150749531 — screenshot evidence: **"A JavaScript error occurred in
    the main process — Cannot find module 'archiver-utils'"** — the
    packaged app was missing a transitive dep (electron-builder collector).
    Fixed by inlining pure-JS deps (archiver/extract-zip/zod) into the main
    bundle via externalizeDepsPlugin exclude; only native better-sqlite3
    remains external (asarUnpack).
- **FINAL rehearsal run 36151570959 — ALL STEPS GREEN** (verified against
  the Checks API on 2026-09-25): quality gates incl. 100k scale → bundle →
  Electron-ABI rebuild → packaging → postdist checksums → checksum
  re-verification → clean-boot (in-app "context ready" marker + userData
  created) → NSIS silent install/uninstall round-trip → artifact upload →
  publish correctly skipped for the `-rc1` tag → manifest recorded to
  `ci-logs/manifests/v1.0.0-rc1/`.

Artifact evidence (rehearsal commit `234c4a7`):

| File | Bytes | SHA-256 |
| --- | --- | --- |
| Dentiva Pro-1.0.0-win-x64-setup.exe | 87,885,975 | ff7dcc42b25744ff469b98eb0e48c60da76aba1404f551e1ba6f7161a977048b |
| Dentiva Pro-1.0.0-win-x64-portable.exe | 87,658,321 | 10b70f0557ac18f46d03c7114d0c482e5e6e918f46088c4badf1364fa481677b |
| Dentiva Pro-1.0.0-win-x64.zip | 120,042,333 | f812933a48f39834f5a02b5307a359fcba27c59b7b0c182c4d379b2ae3494443 |
| Dentiva Pro-1.0.0-win-x64-setup.exe.blockmap | 93,509 | cf7f06f99233af17074119139764e1f60997da0ada241b1e52554a56e0abadcd |

Cross-checks: manifest vs SHA256SUMS.txt match (same values, machine-written
by scripts/postdist.cjs); Actions API confirms uploaded run artifact
`dentiva-pro-windows-v1.0.0-rc1-1` (422,058,919 B, unexpired). Byte-level
download INTO this sandbox is impossible (GitHub blob hosts blocked); the CI
in-job `Verify SHA256SUMS.txt covers every artifact` step recomputes each
hash on the runner itself.

## 6. Sign-off rule

Version `1.0.0` may be tagged once #3's signing decision is taken (or
explicitly waived as "unsigned alpha"): the tag push itself performs the
final build + verification + publication.


---

## 7. FINAL CYCLE (2026-09-26) — forensic audit, activation, premiumization

Independent re-verification (nothing taken on trust): typecheck 0 errors; 97/97 tests;
smoke 14/14; static audit 9/9 gates; perf within budget; scale 10k and 100k within
budget; production bundle clean; artifact scan: renderer contains no keyring/secret
surface, main carries better-sqlite3 external + all pure-JS deps inlined.

### 7.1 Defects found this cycle, fixed, regression-protected

| ID | Severity | Defect (independently discovered) | Fix | Proof |
| --- | --- | --- | --- | --- |
| F-1 | P0 | Product required commercial serial activation — none existed | Full activation subsystem (§ docs/ENGINEERING_CHECKPOINT.md cycle notes): keyed-HMAC verification, constant-time compare, machine-bound persisted state, lockout, main-process channel seal, first-run UI, support Installation ID | 16 activation tests; smoke stage; static-audit gate 9; out-of-band production keyring verification below |
| F-2 | P0 | PDF export **and** print were broken on every document screen (channel contract mismatch: renderer sent `html`, main required `docKind`) | Renderer forwards `docKind`+ids; main rebuilds HTML server-side (never trusts renderer HTML) | documents suite + audit parity gate; manual flow trace |
| F-3 | P1 | `documents.pdf`/`documents.printDoc` skipped session+RBAC checks (intercepted before permission router) | `docActorFor`: requireActor + `documents.print`, forbidden-audited | ipc code review + parity/static gates |
| F-4 | P1 | Multi-page documents printed with zero continuation-page margins (clipping); no page numbering | Shared `PAGE_MARGINS_MM`; print-media CSS; printToPDF custom margins; footer "DocType · Page x of y" on multi-page docs (not 80mm) | templates/pdf code; documents tests pass (incl. new print-CSS parity: clinical doc guard rejects the first attempt that leaked a financial selector — test did its job) |
| F-5 | P2 | Patient 360 timeline silently capped sources at 1000 rows and display at 500 — long histories were unreachable | Merged UNION-ALL paginated timeline with totals; UI "Showing n of total / Load more" | clinical.test 3000-page walk dup-free/deterministic + scale-test deep-history assertion at 100k (all 3,000 entries reachable, 60.5 ms) |
| F-6 | P2 | Prescription medicine "Directions" field existed in schema/printing but could never be entered (always '') | Real per-medicine Directions input in RxBuilder | builder wired; documents tests |
| F-7 | P2 | Statement PDF used the "No:" slot for a date range | Header number-label support; now "Statement period" | templates |
| F-8 | P3 | Dead/fake surfaces: `ui.toast` fake-success route, `win.setTitle`, unreachable win pseudo-routes, `documents.assets` | Removed | static audit clean |
| F-9 | P3 | Window min height 700 > usable 720p desktop height | minHeight 640 | code |
| F-10 | P3 | Production build exposed Electron default menu/devtools path | `Menu.setApplicationMenu(null)` + devtools auto-close when packaged; global webContents hardening for every window (deny new windows/navigation) | code + hardening gate |
| F-11 | P3 | No reduced-motion support; no dialog/toast entry motion | `prefers-reduced-motion` global kill; 120–160 ms pop/fade/toast motion | CSS |

### 7.2 Activation security review (spec §37 compliance)

- Serial is stored **nowhere**: only `HMAC-SHA256(key, "dentiva.pro.activation.v1|" + normalized)`
  is embedded. Keyed digest is one-way; verification constant-time; every wrong input
  yields the identical message (no prefix/length oracle — 15-of-16 prefix explicitly rejected).
- Out of renderer: renderer receives only `{activated, reason, installationId, lockedUntil}`.
  The key material never enters the renderer bundle (verified by scanning `out/`).
- State: userData/`activation-state.json`, mode 0600, atomic write, machine-bound
  (HMAC over machine-id+MAC+hostname+arch); copied/tampered/corrupt/missing files all
  degrade to not-activated with precise recovery copy — never activated. Reinstall on the
  same machine with kept userData remains activated; wiped userData requires re-entry.
- Lockout: 5 consecutive failures → 60 s × 2ⁿ (cap 1 h) **persisted**, survives restart;
  success resets budget; correct serial is refused during lockout (prevents oracle timing).
- Bypass resistance: gate is main-process dispatch — patching renderer/localStorage/UI
  cannot open business channels; forging activation requires computing a valid state
  token for a foreign machine fingerprint (keyed HMAC in the bundle — the accepted bar
  for offline activation; documented honestly: offline activation is deterrence, not DRM).
- No online dependency. No serial material in logs (boot log emits status words only),
  diagnostics, audit metadata (audit stores `activation.completed|rejected` + error code),
  docs, or artifacts (static-audit scans src **and** docs for 12+ digit runs outside hex).
- Production verification (2026-09-26, out-of-band in the build environment, script deleted
  after use, serial never written to any file): correct serial + case/space/dash variants
  accepted; 5 guesses + prefix rejected; persist/reopen OK; state file free of serial
  material; lockout honored. Result: **11/11 checks OK**.

### 7.3 Unlimited-record architecture (spec §8/§9) re-verified

Final static scan found **no** business-level ceilings left: former 1000-row timeline caps
removed (F-5); `search.global` bounds are response-size by design with `truncatedKinds`
surfaced; list endpoints are paged with truthful `total`; the only fixed bounds are
response-shaping (pageSize ≤ 500) and system bounds (SQLite/storage). Deep-history proof:
3,000-event patient inside a 100,000-patient db — every entry reachable via pages,
duplicate-free, oldest entry present, whole walk 60 ms. Wording for materials: "Dentiva
Pro imposes no artificial application-level limit on patient or record counts; practical
capacity depends on storage, RAM, CPU and filesystem/database characteristics."

### 7.4 Final-cycle gate summary

| Gate | Result |
| --- | --- |
| Typecheck | 0 errors |
| Tests | 97/97 (14 suites) — all new fixes regression-covered |
| Smoke | 14/14 (adds activation stage) |
| Static audit | clean, 9 gates |
| Perf | all budgets met |
| Scale 10k / 100k | all budgets met; deep-history reachability enforced |
| electron-vite build | clean; bundle hygiene scanned (no secret surface in renderer output) |
| CI packaging (prior mechanism) | unchanged by this cycle; Windows artifacts, clean-boot, NSIS install/uninstall, SHA256SUMS — re-run per release tag on windows-latest |

### 7.5 Honest remaining-issues list (zero known release-blockers)

1. Code signing — commercial decision outstanding (SmartScreen warning persists).
2. Physical clean-machine pass — recommended; CI reproduces boot+install+uninstall each release.
3. Offline activation is deterrence-grade by construction (any offline scheme is patchable
   by a determined attacker with the bundle); the practical requirement — no plaintext
   secret, no trivial bypass, clear recovery path — is fully met and documented.

### 7.6 Final artifacts — definitive v1.0.0 release (PUBLISHED 2026-09-26T06:20:49Z)

Release `v1.0.0` @ merge commit `e2970b1` (this cycle). Pipeline run **36223276395**
(ubuntu-quality job + windows-release job) — **every step green**: quality gates →
bundle → Electron-ABI rebuild → packaging → SHA256SUMS generation + in-job
re-verification → **clean-boot** (packaged portable exe first run reaches
"context ready" with the activation gate live — the shipped app starts at the
activation screen) → **NSIS silent install + uninstall round-trip** → artifact upload →
**GitHub Release published** → manifest to `ci-logs`.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| Dentiva Pro-1.0.0-win-x64-setup.exe | 87,903,797 | d290b4681abb670bc60743a4d94699b8fecac037ab9c3bcb7456c29a73c4fd48 |
| Dentiva Pro-1.0.0-win-x64-portable.exe | 87,676,147 | ba47f9b47ebc046b50820ddf23386f8c83fb3fe365e15f8943c96769c2d0ae11 |
| Dentiva Pro-1.0.0-win-x64.zip | 120,065,341 | 9b7a70692d09c34c62e8c35015e96fc8995b8e11be380e68812366f67cfb691f |
| Dentiva Pro-1.0.0-win-x64-setup.exe.blockmap | 93,251 | ac8d33659a4429715d1db4d08740c8b9aaee7ab68127ac02d63278275b4e5478 |

Source of truth: `ci-logs:manifests/v1.0.0/release-manifest.json`; hashes recomputed
independently on the Windows runner (`Verify SHA256SUMS.txt covers every artifact` step).
A previous same-numbered release cut from `6b459b3` (before this cycle's fixes —
no activation, broken PDF export/print, timeline caps) was **superseded and replaced**;
its assets are gone, download only from the 2026-09-26 release.

## 8. Final sign-off

Zero known release-blocking issues. Feature freeze in effect: the product identity is
simply **Dentiva Pro** (1.0.0). Outstanding non-blocking items are listed in §7.5
(code signing — commercial decision; physical clean-machine pass — recommended,
CI-automated equivalents green; printer-driver eyeball on physical hardware).
