/**
 * build-icon.mjs — render build/icon.svg into the packaging icon set.
 *
 * Outputs:
 *   build/icon.ico  (16/32/48/64/128/256 px frames — NSIS + exe icon)
 *   build/icon.png  (256 px — Linux/macOS packaging, taskbar fallback)
 *
 * Pure-Node pipeline (@resvg/resvg-js → png-to-ico): no ImageMagick, no
 * system delegates, deterministic on every platform. Run: `npm run icon`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const svgPath = path.join(root, 'build', 'icon.svg');
if (!fs.existsSync(svgPath)) {
  console.error(`icon source not found: ${svgPath}`);
  process.exit(1);
}
const svg = fs.readFileSync(svgPath);

function render(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

const sizes = [16, 32, 48, 64, 128, 256];
const frames = sizes.map((s) => render(s));
const ico = await pngToIco(frames);

fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512));

// Sanity: ICO header must declare exactly `sizes.length` frames.
const frameCount = ico.readUInt16LE(4);
if (frameCount !== sizes.length) {
  console.error(`unexpected ico frame count ${frameCount}`);
  process.exit(1);
}
console.log(`icon.ico written (${sizes.length} frames: ${sizes.join('/')})`);
console.log('icon.png written (512px)');
