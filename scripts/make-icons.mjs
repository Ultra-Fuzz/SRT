// Draws the app icon (mountain on a blue sky) and writes the PNG sizes iOS needs.
//   node scripts/make-icons.mjs
import { deflateSync, crc32 } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../app/icons');
const SS = 4; // supersampling per axis for smooth edges

const inPoly = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Scene in unit coordinates (0..1), painted back to front.
const SHAPES = [
  { color: [126, 176, 232], pts: [[-0.12, 0.92], [0.30, 0.40], [0.47, 0.60], [0.66, 0.92]] },            // far peak
  { color: [244, 248, 255], pts: [[0.12, 0.90], [0.60, 0.20], [1.08, 0.90]] },                             // main peak (snow)
  { color: [176, 205, 240], pts: [[0.60, 0.20], [1.08, 0.90], [0.64, 0.90], [0.70, 0.62], [0.58, 0.50]] }, // shaded face
  { color: [20, 58, 104], pts: [[-0.05, 0.90], [1.05, 0.90], [1.05, 1.05], [-0.05, 1.05]] },               // base band
];
const SUN = { cx: 0.24, cy: 0.22, r: 0.085, color: [255, 214, 92] };

function pixel(u, v) {
  let c = mix([18, 62, 122], [64, 142, 224], Math.min(1, v / 0.9)); // sky gradient
  if ((u - SUN.cx) ** 2 + (v - SUN.cy) ** 2 < SUN.r ** 2) c = SUN.color;
  for (const s of SHAPES) if (inPoly(s.pts, u, v)) c = s.color;
  return c;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  await writeFile(resolve(OUT, `icon-${size}.png`), png(size));
  console.log(`icon-${size}.png`);
}
