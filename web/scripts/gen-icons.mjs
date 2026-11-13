// Generates the PWA PNG icons (no native deps) matching public/icon.svg: a white progress ring on teal.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BG = [0x0f, 0x76, 0x6e];
const FG = [0xff, 0xff, 0xff];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// In the 512 x 512 SVG space: a ring (radius 135, 50 thick) open in the top-right quarter, and a dot in the middle.
const CX = 256;
const CY = 256;
function inMark(px, py) {
  const d = Math.hypot(px - CX, py - CY);
  if (d <= 42) return true;
  if (d < 110 || d > 160) return false;
  return !(px > CX && py < CY);
}

function render(size) {
  const s = size;
  const scale = s / 512;
  const raw = Buffer.alloc((s * 4 + 1) * s);
  const inside = (x, y, r) => Math.hypot(x, y) <= r;
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0; // filter none
    for (let x = 0; x < s; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const inSquare =
        !(px < 112 && py < 112 && !inside(px - 112, py - 112, 112)) &&
        !(px > 400 && py < 112 && !inside(px - 400, py - 112, 112)) &&
        !(px < 112 && py > 400 && !inside(px - 112, py - 400, 112)) &&
        !(px > 400 && py > 400 && !inside(px - 400, py - 400, 112));
      const color = inSquare ? (inMark(px, py) ? FG : BG) : null;
      const o = y * (s * 4 + 1) + 1 + x * 4;
      if (color) {
        raw[o] = color[0];
        raw[o + 1] = color[1];
        raw[o + 2] = color[2];
        raw[o + 3] = 255;
      } else {
        raw[o + 3] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, 'icon-192.png'), render(192));
writeFileSync(join(out, 'icon-512.png'), render(512));
writeFileSync(join(out, 'apple-touch-icon.png'), render(180));
console.log('icons written to', out);
