// Generates the extension icons (16/32/48/128) with zero dependencies.
// Gradient rounded square + white "two stacked windows" glyph.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// Rounded-rect signed distance: < 0 inside.
function sdRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - cy) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function insideGlyph(x, y, S) {
  // coordinates in 128-space
  const u = (x * 128) / S, v = (y * 128) / S;
  const back = sdRoundRect(u, v, 26, 26, 96, 88, 10) < 0;
  const front = sdRoundRect(u, v, 42, 46, 106, 106, 10) < 0;
  // divider: browser-chrome line inside the front window
  const divider = front && v >= 62 && v <= 68;
  return (back || front) && !divider;
}

function inDivider(x, y, S) {
  const u = (x * 128) / S, v = (y * 128) / S;
  const front = sdRoundRect(u, v, 42, 46, 106, 106, 10) < 0;
  return front && v >= 62 && v <= 68;
}

function insidePlate(x, y, S) {
  const u = (x * 128) / S, v = (y * 128) / S;
  return sdRoundRect(u, v, 4, 4, 124, 124, 28) < 0;
}

function render(S) {
  const rgba = Buffer.alloc(S * S * 4);
  const C1 = [16, 185, 129]; // #10b981
  const C2 = [99, 102, 241]; // #6366f1
  const SS = 3; // supersample
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!insidePlate(px, py, S)) continue;
          const u = (px * 128) / S, v = (py * 128) / S;
          const t = Math.min(1, Math.max(0, (u + v) / 256));
          let col = [
            Math.round(C1[0] + (C2[0] - C1[0]) * t),
            Math.round(C1[1] + (C2[1] - C1[1]) * t),
            Math.round(C1[2] + (C2[2] - C1[2]) * t),
          ];
          if (insideGlyph(px, py, S)) col = [255, 255, 255];
          else if (inDivider(px, py, S)) {
            // darken the divider slightly instead of punching a hole at 16px
            col = col.map((c) => Math.round(c * 0.55));
          }
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * S + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writePng(path.join(outDir, `icon${size}.png`), size, size, render(size));
  console.log(`icons/icon${size}.png written`);
}
