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

- 81/81 automated tests across 13 suites — passing
- End-to-end "clinic day" smoke scenario — all 13 stages passing
- Static security audit — clean
- Continues to respond within latency budgets at 100,000 patients

## Known notes for this build

- Binaries are **unsigned**; Windows SmartScreen will show a publisher warning until a code-signing certificate is in place.
- Data lives locally in `%APPDATA%\Dentiva Pro` (installer) or beside the portable executable — keep backups via the app's Backup page.
