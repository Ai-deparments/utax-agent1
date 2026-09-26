// ⚠️ ESKIRGAN (2026-09-26): brend belgisi endi public/icons/favicon.svg (qora fon + X). PNG ikonlar shu SVG'dan
// Chrome orqali chizilgan. Bu skript ESKI yashil ikonlarni yaratadi — ishga tushirilsa yangi ikonlar bosib ketiladi.
// PWA ikonlarini yaratadi (paketsiz): zumrad fon + oq "X" belgisi — favicon bilan bir xil brend belgisi.
// Ishga tushirish: node scripts/gen-icons.mjs   → public/icons/*.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BG = [5, 150, 105]; // --primary #059669
const FG = [255, 255, 255];

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
function insideRoundRect(x, y, s, r) { const cx = Math.min(Math.max(x, r), s - r), cy = Math.min(Math.max(y, r), s - r); return Math.hypot(x - cx, y - cy) <= r; }

/** size — piksel; radius — fon burchagi (0 = to'liq kvadrat, maskable uchun); mark — X belgisining yarim o'lchami (ulushda) */
function render(size, { radius, mark, stroke }) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  const c = size / 2, a = size * mark, w = size * stroke / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      if (!insideRoundRect(px, py, size, size * radius)) continue;
      bg++;
      if (segDist(px, py, c - a, c - a, c + a, c + a) <= w || segDist(px, py, c + a, c - a, c - a, c + a) <= w) fg++;
    }
    const n = SS * SS, i = (y * size + x) * 4, fa = fg / Math.max(bg, 1);
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(BG[k] * (1 - fa) + FG[k] * fa);
    buf[i + 3] = Math.round((bg / n) * 255);
  }
  return png(size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const std = { radius: 0.22, mark: 0.22, stroke: 0.11 };           // "any" — yumaloq burchakli
const mask = { radius: 0, mark: 0.16, stroke: 0.085 };            // maskable — belgi 80% xavfsiz zona ichida
const apple = { radius: 0, mark: 0.2, stroke: 0.1 };              // iOS o'zi burchaklarni yumaloqlaydi
for (const [name, size, opt] of [['icon-192.png', 192, std], ['icon-512.png', 512, std], ['maskable-512.png', 512, mask], ['apple-touch-icon.png', 180, apple], ['favicon-32.png', 32, std]]) {
  fs.writeFileSync(path.join(OUT, name), render(size, opt));
  console.log('✓', name);
}
