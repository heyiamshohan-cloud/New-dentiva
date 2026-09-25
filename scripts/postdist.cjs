#!/usr/bin/env node
/**
 * electron-builder afterAllArtifactBuild hook.
 *
 * 1. Computes SHA-256 for every produced artifact (installer, portable, zip,
 *    blockmaps included for completeness).
 * 2. Writes release/SHA256SUMS.txt in the classic `sha256sum` format so
 *    `sha256sum -c SHA256SUMS.txt` verifies the whole set on any machine.
 * 3. Prints the summary table for the build log / release notes.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const INCLUDE_EXT = new Set(['.exe', '.msi', '.zip', '.dmg', '.AppImage', '.blockmap']);

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

module.exports = async function postdist(buildResult) {
  const outDir = (buildResult && buildResult.outDir) || path.join(__dirname, '..', 'release');
  const artifactPaths = (buildResult && buildResult.artifactPaths) || [];
  const candidates = new Set(artifactPaths);
  // artifactPaths sometimes omits side files; also sweep the output dir.
  if (fs.existsSync(outDir)) {
    for (const name of fs.readdirSync(outDir)) candidates.add(path.join(outDir, name));
  }
  const artifacts = [...candidates]
    .filter((p) => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isFile())
    .filter((p) => INCLUDE_EXT.has(path.extname(p)));
  if (artifacts.length === 0) {
    console.warn('[postdist] no artifacts found to checksum');
    return [];
  }
  artifacts.sort();

  const lines = [];
  const table = [];
  for (const file of artifacts) {
    const sum = sha256(file);
    const base = path.basename(file);
    const size = fs.statSync(file).size;
    lines.push(`${sum}  ${base}`);
    table.push({ file: base, bytes: size, sha256: sum });
  }
  const sumsPath = path.join(outDir, 'SHA256SUMS.txt');
  const manifestPath = path.join(outDir, 'release-manifest.json');
  fs.writeFileSync(sumsPath, lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        product: 'Dentiva Pro',
        version: require('../package.json').version,
        platform: process.platform,
        generatedAt: new Date().toISOString(),
        artifacts: table
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log('[postdist] artifacts:');
  for (const t of table) console.log(`  ${t.file}  ${(t.bytes / 1024 / 1024).toFixed(1)} MB  sha256:${t.sha256.slice(0, 16)}…`);
  console.log(`[postdist] wrote ${sumsPath}`);
  console.log(`[postdist] wrote ${manifestPath}`);
  return [];
};
