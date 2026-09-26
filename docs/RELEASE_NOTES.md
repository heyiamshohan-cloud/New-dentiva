# Dentiva Pro 1.0.0

Premium offline-first dental clinic & practice-management software for Windows x64.

## Install

- **Setup.exe** — guided installer (per-user by default, desktop + Start Menu shortcuts)
- **portable.exe** — single-file, runs without installing
- **.zip** — unpack-and-run archive

Verify integrity before installing: download every file, then on Windows
`certutil -hashfile <file> SHA256` and compare with `SHA256SUMS.txt`
(on Linux/macOS: `sha256sum -c SHA256SUMS.txt`).

## Highlights

- Fully offline: no internet needed for any feature; no telemetry, no external APIs
- First-launch product activation: enter the serial supplied with your licence — verified locally
  against a sealed digest, bound to this machine, lockout on repeated failures. Activation ID
  (Diagnostics) is what you quote to support when moving to a new computer
- Patients with unique codes, duplicate warnings, full Patient 360 (clinical + financial)
- FDI dental chart (adult & primary), structured visits, paper-faithful prescriptions with zero financial data
- Appointments with dentist/chair/room conflict detection and a live daily queue
- Treatment catalog & plans, draft→issued invoices, receipts after payment, statements, refunds
- Inventory with movement-typed stock ledger; expenses & reports (CSV export)
- scrypt logins, roles (Administrator, Dentist, Assistant, Receptionist, Accountant), inactivity lock, full audit log
- One-click checksummed backup & atomic restore; CSV import/export without silent loss
- A4 / A5 / Letter / 80 mm documents — what you preview is exactly what prints
- Bangladesh defaults: BDT (৳), Asia/Dhaka, bKash / Nagad / Rocket / Upay / Cash / Bank / Card

## Verification state at release

- 97/97 automated tests across 14 suites — passing
- End-to-end "clinic day" smoke scenario — all 14 stages passing (incl. activation round-trip)
- Static security audit — clean (9 gates: offline, secrets, placeholders, money, SQL, IPC bridge,
  route parity, hardening, activation confidentiality)
- Scale: 100,000 patients and a 3,000-event lifetime timeline — every entry reachable, in budget
- Continues to respond within latency budgets at 100,000 patients

## Known notes for this build

- Binaries are **unsigned**; Windows SmartScreen will show a publisher warning until a code-signing certificate is in place.
- Data lives locally in `%APPDATA%\Dentiva Pro` (installer) or beside the portable executable — keep backups via the app's Backup page.
