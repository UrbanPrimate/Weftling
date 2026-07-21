'use strict';

// Generates the Weftly PWA icon set as hand-encoded PNGs, using only Node's
// built-in zlib for compression (no image/canvas dependencies, keeping the
// project zero-build). Motif: an abstract woven-swatch lattice (interleaved
// "warp"/"weft" bands) on the ink background — no text.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INK = [0x17, 0x21, 0x2e]; // #17212E
const WEFT = [0x0e, 0x7c, 0x6b]; // #0E7C6B — teal accent, horizontal bands ("under")
const WARP = [0x4a, 0xb3, 0x9f]; // lighter teal, vertical bands ("over")

// ---------------------------------------------------------------------
// Minimal PNG encoder: signature + IHDR + IDAT (zlib deflate) + IEND
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  // Raw image data: one filter-type byte (0 = none) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = chunk('IDAT', compressed);

  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------
// Woven-swatch pixel generator
// ---------------------------------------------------------------------

function setPx(buf, width, x, y, color, alpha = 255) {
  const i = (y * width + x) * 4;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = alpha;
}

/**
 * @param {number} size - icon width/height in px
 * @param {number} safeFrac - fraction of size the woven mark occupies (centered)
 */
function renderIcon(size, safeFrac) {
  const buf = Buffer.alloc(size * size * 4);

  // Background fill (edge-to-edge ink — safe for maskable use too).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPx(buf, size, x, y, INK, 255);
    }
  }

  const safe = Math.round(size * safeFrac);
  const offset = Math.round((size - safe) / 2);
  const bands = 4; // number of warp/weft bands each direction
  const gap = safe / (bands * 2 + 1); // even spacing with a leading/trailing margin
  const bandWidth = gap * 1.15;

  const bandCenters = [];
  for (let i = 0; i < bands; i++) {
    bandCenters.push(gap * (2 * i + 1.5));
  }

  for (let y = 0; y < safe; y++) {
    for (let x = 0; x < safe; x++) {
      const inHBand = bandCenters.some((c) => Math.abs(y - c) <= bandWidth / 2);
      const inVBand = bandCenters.some((c) => Math.abs(x - c) <= bandWidth / 2);

      let color = null;
      if (inHBand && inVBand) {
        // Alternate which band "shows through" at intersections for a woven look.
        const hi = bandCenters.findIndex((c) => Math.abs(y - c) <= bandWidth / 2);
        const vi = bandCenters.findIndex((c) => Math.abs(x - c) <= bandWidth / 2);
        color = (hi + vi) % 2 === 0 ? WARP : WEFT;
      } else if (inHBand) {
        color = WEFT;
      } else if (inVBand) {
        color = WARP;
      }

      if (color) {
        setPx(buf, size, offset + x, offset + y, color, 255);
      }
    }
  }

  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, safeFrac: 0.7 },
  { file: 'icon-512.png', size: 512, safeFrac: 0.7 },
  { file: 'icon-512-maskable.png', size: 512, safeFrac: 0.55 }, // extra margin for OS mask cropping
  { file: 'apple-touch-icon-180.png', size: 180, safeFrac: 0.72 },
];

for (const t of targets) {
  const png = renderIcon(t.size, t.safeFrac);
  fs.writeFileSync(path.join(outDir, t.file), png);
  console.log(`wrote public/icons/${t.file} (${t.size}x${t.size}, ${png.length} bytes)`);
}
