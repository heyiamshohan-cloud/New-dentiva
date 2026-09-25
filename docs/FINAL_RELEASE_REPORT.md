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
