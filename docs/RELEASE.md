# Release Procedure — Dentiva Pro 1.0.0

Target deliverables (per product spec):

- NSIS installer (`Dentiva Pro 1.0.0 Setup.exe`)
- Portable executable (`Dentiva Pro 1.0.0.exe`)
- ZIP archive (`Dentiva Pro 1.0.0-win32-x64.zip`)
- `SHA256SUMS.txt` covering every shipped artifact
- Git tag `v1.0.0` and a GitHub Release carrying the artifacts

## 1. Preconditions

Run every quality gate and record the output in `docs/FINAL_RELEASE_REPORT.md`:

```powershell
npm ci
npm run typecheck          # 0 errors
npm test                   # 81/81 passing
npm run smoke              # 13/13 scenarios
npm run audit:static       # clean
npm run perf               # within budget
npm run scale 100000 3     # within budget
npm run build              # electron-vite
```

## 2. Build the Windows artifacts

On a build host with network access (electron-builder downloads Electron,
winCodeSign and NSIS on first run; afterwards `ELECTRON_BUILDER_CACHE` may be
pre-seeded):

```powershell
npm run rebuild:native     # better-sqlite3 for the Electron ABI
npm run pack:win           # NSIS installer + ZIP (win x64) → release/
```

Notes:

- Icon embedding (`rcedit`) requires either Windows or Wine. On Linux without
  Wine, electron-builder will ship the default icon — that is a visible
  defect; treat it as a release blocker and use a Windows or Wine-enabled host.
- `npm run pack:win:portable` additionally emits the portable single-file exe.

## 3. Checksums

```powershell
cd release
Get-FileHash *.exe, *.zip -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  $($_.Path | Split-Path -Leaf)" } |
  Set-Content SHA256SUMS.txt -Encoding ascii
```

Verify on a clean box with `certutil -hashfile <file> SHA256`.

## 4. Tag + publish

```powershell
git switch -c release/1.0.0
git switch main
git merge --no-ff release/1.0.0
git tag -a v1.0.0 -m "Dentiva Pro 1.0.0"
git push origin main v1.0.0
gh release create v1.0.0 .\release\* --title "Dentiva Pro 1.0.0" --notes-file docs/RELEASE_NOTES.md
```

## 5. Clean-machine verification (mandatory before shipping)

On a Windows 10/11 x64 machine that has never had Dentiva installed:

1. Copy artifacts; verify `SHA256SUMS.txt` matches.
2. Install via Setup.exe → app launches to the first-launch Setup wizard (empty database, no sample data).
3. Create the administrator account and one patient; add a visit, invoice, payment; print a receipt (A4 and 80 mm).
4. Create a backup; uninstall (keep data); reinstall; restore; verify all records and the audit log.
5. Uninstall again; confirm removal artefacts (uninstall entry, shortcuts) gone while user data survives by design.

Record pass/fail against each step in `docs/FINAL_RELEASE_REPORT.md`.
