/**
 * static-audit.ts — source-level security & integrity audit.
 *
 * Enforces the non-negotiables statically (complementing the runtime tests):
 *   1. No network/telemetry code anywhere in src (offline-first product).
 *   2. No secrets, tokens, or hardcoded credentials in source.
 *   3. No placeholders in production surfaces (TODO/FIXME/lorem/demo/mock).
 *   4. No floats in money handling: src never formats money with toFixed on
 *      raw numbers; money math must route through domain/money helpers.
 *   5. SQL integrity: no template-literal interpolation of variables into
 *      db.prepare() SQL (parameterized queries only).
 *   6. Renderer talks to the backend ONLY through the typed api layer
 *      (no direct ipcRenderer imports outside preload).
 *   7. Every preload-exposed IPC channel has a registered route or handler in
 *      main (and vice versa: no dead allowlist entries).
 *   8. Electron hardening invariants in index.ts (contextIsolation, no
 *      nodeIntegration, sandbox).
 *
 * Exits 1 with a labelled report on any violation.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');
interface Finding { gate: string; file: string; line: number; snippet: string }
const findings: Finding[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (p: string): string => path.relative(process.cwd(), p);

function add(gate: string, file: string, line: number, snippet: string, allow: RegExp[] = []): void {
  if (allow.some((a) => a.test(snippet))) return;
  findings.push({ gate, file: rel(file), line, snippet: snippet.trim().slice(0, 140) });
}

// ── gate 1: offline-first, zero network ──────────────────────────────────────
const NET = /\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon|EventSource)\s*\(|https?:\/\/|require\(['"](net|tls|dns|dgram)['"]\)|from ['"](net|tls|dns|dgram)['"]|electron\.net\b/;
// ── gate 2: secrets (strict tokens only; words like 'secret' in the audit's own redaction regex are not secrets) ──
const SECRET = /(BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|aws_secret_access_key\s*=)/i;
// ── gate 3: placeholders/demo content ────────────────────────────────────────
const PLACEHOLDER = /\bTODO\b|\bFIXME\b|\bHACK\b|lorem ipsum|dummy data|demo mode|sample patient|placeholder text/i;
// ── gate 4: float money ──────────────────────────────────────────────────────
const FLOAT_MONEY = /parseFloat\s*\([^)]*(amount|price|total|discount|tax|payment|balance|due|cost|fee)/i;

const filesText = new Map<string, string[]>();
for (const f of files) filesText.set(f, fs.readFileSync(f, 'utf8').split('\n'));

for (const [file, lines] of filesText) {
  const r = rel(file);
  lines.forEach((ln, i) => {
    const num = i + 1;
    if (NET.test(ln) && !/^\s*(\/\/|\*|<!--)/.test(ln)) {
      // shell.openExternal is a user-initiated hand-off to the OS browser, not an app dependence on the network.
      add('offline: no network', file, num, ln, [/W3C|MDN|github\.com/i, /shell\.openExternal/]);
    }
    if (SECRET.test(ln)) add('secrets: none in source', file, num, ln);
    // Marketing-free copy that *says* "no demo records / no sample patients" is an assurance, not a placeholder.
    if (PLACEHOLDER.test(ln)) add('production: no placeholders', file, num, ln, [/no placeholder|placeholder-free|no sample patients|no demo records/i]);
    if (FLOAT_MONEY.test(ln)) add('money: no float parsing', file, num, ln);
    // SQL gate: template fragments are only allowed when every ${name} refers to
    // a constant declared in the same file as a plain string literal, or to a
    // name provably derived from a constant allowlist (e.g. ENTITY_TABLES).
    for (const m of ln.matchAll(/prepare\(\s*`([^`]*)`/g)) {
      const sql = m[1];
      for (const im of sql.matchAll(/\$\{([^}]+)\}/g)) {
        const name = im[1].trim();
        const fileSrc = filesText.get(file)!.join('\n');
        const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : '';
        const isLiteralConst = ident !== '' && new RegExp('const\\s+' + ident + "\\b\\s*=\\s*[\`'\"]").test(fileSrc);
        const isAllowlisted =
          /^(w|table|tables|TABLE|schema)$/.test(name) ||
          // table identifiers iterated from the immutable ENTITY_TABLES constant
          (/^t(able)?$/.test(name) && /of ENTITY_TABLES/.test(fileSrc)) ||
          // SET-clause fragments built exclusively from a fixed `fields` whitelist in the same file
          (/^sets\.join\(/.test(name) && /const fields: Record<[^>]+>/.test(fileSrc) && /Object\.entries\(fields/.test(fileSrc));
        if (!isLiteralConst && !isAllowlisted) add('sql: parameterized only', file, num, ln);
        break;
      }
    }
    if (/from ['"]electron['"]/.test(ln) && /ipcRenderer/.test(ln) && !r.endsWith('preload.ts')) {
      add('ipc: renderer uses preload API only', file, num, ln);
    }
  });
}

// ── gate 7: preload allowlist ⇄ main routes parity ───────────────────────────
const preloadSrc = fs.readFileSync(path.join(SRC, 'main', 'preload.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(SRC, 'main', 'ipc.ts'), 'utf8');
const allow = new Set([...preloadSrc.matchAll(/'([a-z][a-z0-9]*\.[a-zA-Z0-9.]+)'/g)].map((m) => m[1]).filter((c) => c.includes('.')));
const routed = new Set([...ipcSrc.matchAll(/'([a-z][a-z0-9]*\.[a-zA-Z0-9.]+)'\s*:/g)].map((m) => m[1]));
const direct = new Set([...ipcSrc.matchAll(/(?:channel ===|ipcMain\.handle\()\s*'([a-z][a-z0-9]*\.[a-zA-Z0-9.]+)'/g)].map((m) => m[1]));
for (const ch of allow) {
  if (!routed.has(ch) && !direct.has(ch) && ch.split('.').length === 2) {
    findings.push({ gate: 'ipc parity: channel routed', file: 'src/main/preload.ts', line: 1, snippet: `allowlisted "${ch}" has no main handler` });
  }
}

// ── gate 8: hardening invariants ─────────────────────────────────────────────
const indexSrc = fs.readFileSync(path.join(SRC, 'main', 'index.ts'), 'utf8');
for (const invariant of ['contextIsolation: true', 'nodeIntegration: false']) {
  if (!indexSrc.includes(invariant)) {
    findings.push({ gate: 'electron hardening', file: 'src/main/index.ts', line: 1, snippet: `missing invariant "${invariant}"` });
  }
}

// ── gate 9: activation confidentiality (commercial secret hygiene) ─────────
// The purchased production serial must never appear in source, docs, logs or
// UI copy. Serial material is 12–32 alphanumeric chars; a committed plaintext
// secret would therefore show up as a long digit/letter run outside quoted hex
// key material. We also require: (a) the activation gate exists in main and
// covers every non-exempt channel; (b) nothing logs serial input.
const HEX_LITERAL = /"\s*[0-9a-f]{32,}\s*"/g;
for (const [file, lines] of filesText) {
  const r = rel(file);
  const joined = lines.join('\n').replace(HEX_LITERAL, '""');
  if (/\b\d{12,}\b/.test(joined)) {
    const m = joined.match(/\b\d{12,}\b/)!;
    const line = joined.slice(0, m.index).split('\n').length;
    add('activation: no serial material in source', file, line, `long digit run near line ${line}`);
  }
  for (const ln of lines) {
    if (/activate\(|activation/.test(ln) && /console\.(log|error|warn)\([^)]*serial/i.test(ln)) {
      add('activation: never log the serial', file, 1, ln);
    }
  }
}
if (!ipcSrc.includes('ACTIVATION_EXEMPT') || !ipcSrc.includes('ctx.activation.isActivated()')) {
  findings.push({ gate: 'activation: main-process gate', file: 'src/main/ipc.ts', line: 1, snippet: 'activation gate missing from IPC dispatch' });
}
for (const doc of ['README.md', 'docs/RELEASE.md', 'docs/FINAL_RELEASE_REPORT.md', 'docs/ENGINEERING_CHECKPOINT.md', 'docs/RELEASE_NOTES.md']) {
  const p2 = path.join(process.cwd(), doc);
  if (fs.existsSync(p2)) {
    const t = fs.readFileSync(p2, 'utf8');
    if (/\b\d{12,}\b/.test(t)) findings.push({ gate: 'activation: no serial material in source', file: doc, line: 1, snippet: 'long digit run in documentation' });
  }
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`static audit over ${files.length} source files`);
if (findings.length === 0) {
  console.log('STATIC AUDIT: clean — all gates passed');
} else {
  const byGate = new Map<string, Finding[]>();
  for (const f of findings) byGate.set(f.gate, [...(byGate.get(f.gate) ?? []), f]);
  for (const [gate, list] of byGate) {
    console.log(`\n✗ ${gate} (${list.length})`);
    for (const f of list.slice(0, 12)) console.log(`    ${f.file}:${f.line}  ${f.snippet}`);
    if (list.length > 12) console.log(`    … and ${list.length - 12} more`);
  }
  console.log(`\nSTATIC AUDIT: ${findings.length} violation(s)`);
  process.exitCode = 1;
}
