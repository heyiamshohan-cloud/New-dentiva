# Dentiva Pro

Premium offline-first dental clinic & practice-management desktop software for Windows x64.

- **Offline-first:** every core function runs without internet. No telemetry, no remote APIs, no localhost/dev-server dependence in production.
- **Bangladesh defaults:** BDT currency (৳), Asia/Dhaka timezone, payment methods Cash / Bank / Card / bKash / Nagad / Rocket / Upay.
- **Secure by default:** offline serial activation (machine-bound, secret never stored in plaintext anywhere), scrypt-hashed credentials, inactivity lock, backend-enforced RBAC (Administrator, Dentist, Assistant, Receptionist, Accountant), sandboxed Electron renderer with a validated IPC allowlist, parameterized SQL only.
- **Exact money:** all financial math in integer paisa/minor units — never floats.
- **Auditable:** append-only audit trail of clinical and financial actions.

## Feature map

| Area | What it does |
| --- | --- |
| Activation | Offline product activation on first launch: keyed-digest serial check (the licence serial is never stored in plaintext), per-machine state file, lockout after repeated failures, activation-ID for support. All backend channels stay sealed until activated |
| Patients | Unique stable patient codes (never list position), duplicate detection (warn-only, no auto-merge), Patient 360 with dynamic lifetime financials, attachments with integrity verification |
| Clinical | Visits with structured encounter fields, FDI dental chart (adult + primary dentition), prescriptions (C/C, O/E, R/E, advice, multi-medicine) with **zero** financial data |
| Scheduling | Appointments with resource-aware conflict detection (dentist/chair/room), daily queue |
| Treatment | Catalog with integer-priced services, treatment plans that **never auto-invoice** |
| Billing | Draft → issued invoices, payments (receipt issued only after persistence), refunds/adjustments, account statements, statements of account per patient |
| Inventory | Movement-typed stock ledger (purchase/stock-in/out/adjustment), invalid negative stock refused |
| Accounting & Reports | Expenses, P&L-style summaries, collections, ageing; CSV export |
| Operations | Full-text global search, Ctrl+K command palette, keyboard-first workflows, A4/A5/Letter/80mm document engine where preview == PDF |
| Data safety | Checksummed backups (create → inspect → restore), corrupt archives refused, CSV import/export with zero silent truncation, diagnostics page |

## Development

```powershell
npm ci
npm run dev        # Electron + Vite dev server
```

## Quality gates

```powershell
npm run typecheck  # strict TypeScript, zero errors required
npm test           # 97 unit/integration tests across 14 suites
npm run smoke      # one realistic clinic day end-to-end + activation round-trip (no Electron needed)
npm run perf       # hot-path latency budgets
npm run scale      # 10k–100k patient scale test (pass 100000 for full run)
npm run audit:static   # source-level security audit (offline, secrets, SQL, IPC parity, activation hygiene)
```

## Windows distribution

```powershell
npm run build            # electron-vite → out/
npm run pack:win         # NSIS installer + ZIP → release/
```

See `docs/RELEASE.md` for the full release procedure and `docs/ENGINEERING_CHECKPOINT.md` for the current engineering state.
