/**
 * DSpatch's app icon resources, all derived from one original (DSP-204):
 * build/icon-source/dspatch-icon.webp, the interlaced DS on its dark rounded plate, kept exactly
 * as it was supplied. Nothing here redraws it: the original is decoded, the empty transparent
 * margin around the plate is cut away (the plate's edges and their soft fringe are kept), and the
 * square that remains is scaled down with a Lanczos-3 filter over premultiplied alpha. Colours,
 * proportions and the plate itself are the original's; no background, frame or shadow is added.
 *
 *     npm run icons                 # writes the resources below
 *     npm run icons -- --sheet <png> # also a contact sheet of every size on light and dark
 *
 * Writes:
 * - build/icons/<n>x<n>.png, the Linux icon set electron-builder installs into hicolor;
 * - build/icon.ico, Windows' executable, shortcut and installer icon (16–256);
 * - src/renderer/public/icons/dspatch-<n>.png, the running app's own copies (window icon on
 *   Linux, About, the start page), which Vite copies to dist/renderer/icons.
 *
 * Runs in Electron (`electron scripts/generate-icons.mjs`) because Chromium decodes WebP; the
 * resampling and the PNG and ICO encoding are plain code here, so the result does not depend on
 * the machine's image tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { app, BrowserWindow } from 'electron';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(appDir, 'build', 'icon-source', 'dspatch-icon.webp');
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const RUNTIME_SIZES = [64, 128, 256];
// The plate's edge is where a row or column first reaches this alpha; FRINGE pixels beyond it,
// its anti-aliased rim, are kept. Outside that the original is empty (alpha 0, with stray 1s).
const EDGE_ALPHA = 128;
const FRINGE = 4;

/**
 * @typedef {{ width: number, height: number, data: Uint8Array }} Rgba straight (not premultiplied) RGBA
 */

/** @returns {Promise<Rgba>} the original as Chromium decodes it, without colour conversion */
async function decode() {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL('about:blank');
  const base64 = fs.readFileSync(SOURCE).toString('base64');
  /** @type {{ width: number, height: number, data: number[] }} */
  const decoded = await window.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob('${base64}'), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
  })()`);
  window.destroy();
  return { width: decoded.width, height: decoded.height, data: Uint8Array.from(decoded.data) };
}

/**
 * The square around the plate: its edges where the alpha reaches EDGE_ALPHA, widened by FRINGE,
 * then made square about the plate's centre.
 * @param {Rgba} image
 */
function plateSquare(image) {
  const { width, height, data } = image;
  const columns = new Array(width).fill(0);
  const rows = new Array(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      columns[x] = Math.max(columns[x], alpha);
      rows[y] = Math.max(rows[y], alpha);
    }
  }
  /** @param {number[]} line @returns {[number, number]} */
  const span = (line) => [line.findIndex((a) => a >= EDGE_ALPHA), line.findLastIndex((a) => a >= EDGE_ALPHA)];
  const [left, right] = span(columns);
  const [top, bottom] = span(rows);
  if (left < 0 || top < 0) {
    throw new Error('no plate found in the original');
  }
  const side = Math.max(right - left, bottom - top) + 1 + 2 * FRINGE;
  const x = Math.round((left + right + 1 - side) / 2);
  const y = Math.round((top + bottom + 1 - side) / 2);
  if (x < 0 || y < 0 || x + side > width || y + side > height) {
    throw new Error('the plate reaches the original\'s edge; nothing to cut');
  }
  return { plate: { left, right, top, bottom }, x, y, side };
}

/**
 * @param {Rgba} image
 * @param {{ x: number, y: number, side: number }} square
 * @returns {Rgba}
 */
function crop(image, square) {
  const data = new Uint8Array(square.side * square.side * 4);
  for (let row = 0; row < square.side; row += 1) {
    const from = ((square.y + row) * image.width + square.x) * 4;
    data.set(image.data.subarray(from, from + square.side * 4), row * square.side * 4);
  }
  return { width: square.side, height: square.side, data };
}

/** @param {number} x */
function lanczos3(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
}

/**
 * One axis of a separable Lanczos-3 resize, the filter widened by the scale so a reduction
 * averages rather than skips.
 * @param {Float64Array} input premultiplied RGBA, `lines` lines of `length` pixels
 * @param {number} length
 * @param {number} lines
 * @param {number} target
 * @param {boolean} alongRows true: resize each row; false: each column
 */
function resizeAxis(input, length, lines, target, alongRows) {
  const scale = length / target;
  const support = 3 * Math.max(1, scale);
  const output = new Float64Array(target * lines * 4);
  for (let i = 0; i < target; i += 1) {
    const centre = (i + 0.5) * scale - 0.5;
    const first = Math.max(0, Math.floor(centre - support));
    const last = Math.min(length - 1, Math.ceil(centre + support));
    const weights = [];
    let total = 0;
    for (let j = first; j <= last; j += 1) {
      const weight = lanczos3((j - centre) / Math.max(1, scale));
      weights.push(weight);
      total += weight;
    }
    for (let line = 0; line < lines; line += 1) {
      const sum = [0, 0, 0, 0];
      for (let j = first; j <= last; j += 1) {
        const at = (alongRows ? line * length + j : j * lines + line) * 4;
        const weight = (weights[j - first] ?? 0) / total;
        for (let c = 0; c < 4; c += 1) sum[c] = (sum[c] ?? 0) + (input[at + c] ?? 0) * weight;
      }
      const to = (alongRows ? line * target + i : i * lines + line) * 4;
      for (let c = 0; c < 4; c += 1) output[to + c] = sum[c] ?? 0;
    }
  }
  return output;
}

/**
 * @param {Rgba} image square
 * @param {number} size
 * @returns {Rgba}
 */
function resize(image, size) {
  const n = image.width;
  const premultiplied = new Float64Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) {
    const alpha = (image.data[i * 4 + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c += 1) premultiplied[i * 4 + c] = (image.data[i * 4 + c] ?? 0) * alpha;
    premultiplied[i * 4 + 3] = alpha;
  }
  const wide = resizeAxis(premultiplied, n, n, size, true);
  const square = resizeAxis(wide, n, size, size, false);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const alpha = Math.min(1, Math.max(0, square[i * 4 + 3] ?? 0));
    const byte = Math.round(alpha * 255);
    for (let c = 0; c < 3; c += 1) {
      data[i * 4 + c] = byte === 0 ? 0 : Math.min(255, Math.max(0, Math.round((square[i * 4 + c] ?? 0) / alpha)));
    }
    data[i * 4 + 3] = byte;
  }
  return { width: size, height: size, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Rgba} image */
function png(image) {
  /** @param {string} type @param {Buffer} body */
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * (image.width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * An ICO with a 32-bit bitmap for each size below 256 (what every Windows tool and NSIS read)
 * and a PNG for 256.
 * @param {Rgba[]} images
 */
function ico(images) {
  const bodies = images.map((image) => {
    if (image.width >= 256) return png(image);
    const n = image.width;
    const maskRow = Math.ceil(n / 32) * 4;
    const body = Buffer.alloc(40 + n * n * 4 + maskRow * n);
    body.writeUInt32LE(40, 0);
    body.writeInt32LE(n, 4);
    body.writeInt32LE(n * 2, 8);
    body.writeUInt16LE(1, 12);
    body.writeUInt16LE(32, 14);
    body.writeUInt32LE(n * n * 4 + maskRow * n, 20);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const from = ((n - 1 - y) * n + x) * 4;
        const to = 40 + (y * n + x) * 4;
        body[to] = image.data[from + 2] ?? 0;
        body[to + 1] = image.data[from + 1] ?? 0;
        body[to + 2] = image.data[from] ?? 0;
        body[to + 3] = image.data[from + 3] ?? 0;
      }
    }
    return body;
  });
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const at = 6 + 16 * index;
    header[at] = image.width >= 256 ? 0 : image.width;
    header[at + 1] = image.height >= 256 ? 0 : image.height;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bodies[index]?.length ?? 0, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bodies[index]?.length ?? 0;
  });
  return Buffer.concat([header, ...bodies]);
}

/**
 * Every size at 1:1 and magnified (nearest), on a light and a dark band, for inspection.
 * @param {Map<number, Rgba>} sizes
 */
function sheet(sizes) {
  const shown = [16, 24, 32, 48, 128, 256].map((size) => sizes.get(size)).filter((image) => image !== undefined);
  const gap = 24;
  const cells = shown.map((image) => ({ image, zoom: image.width <= 48 ? 4 : 1 }));
  const bandHeight = gap * 2 + Math.max(...cells.map((cell) => cell.image.width + (cell.zoom > 1 ? gap + cell.image.width * cell.zoom : 0)));
  const width = gap + cells.reduce((sum, cell) => sum + Math.max(cell.image.width * cell.zoom, cell.image.width) + gap, 0);
  const height = bandHeight * 2;
  const data = new Uint8Array(width * height * 4);
  const bands = [[244, 245, 247], [16, 19, 23]];
  bands.forEach((colour, band) => {
    for (let y = band * bandHeight; y < (band + 1) * bandHeight; y += 1) {
      for (let x = 0; x < width; x += 1) data.set([...colour, 255], (y * width + x) * 4);
    }
    let left = gap;
    for (const { image, zoom } of cells) {
      // 1:1 at the top of the band, magnified below it, both composited over the band's colour.
      const draws = [[1, band * bandHeight + gap]];
      if (zoom > 1) draws.push([zoom, band * bandHeight + gap * 2 + image.width]);
      for (const [scale = 1, top = 0] of draws) {
        for (let y = 0; y < image.width * scale; y += 1) {
          for (let x = 0; x < image.width * scale; x += 1) {
            const from = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
            const alpha = (image.data[from + 3] ?? 0) / 255;
            const to = ((top + y) * width + left + x) * 4;
            for (let c = 0; c < 3; c += 1) data[to + c] = Math.round((image.data[from + c] ?? 0) * alpha + (colour[c] ?? 0) * (1 - alpha));
          }
        }
      }
      left += Math.max(image.width * zoom, image.width) + gap;
    }
  });
  return png({ width, height, data });
}

async function main() {
  const original = await decode();
  const square = plateSquare(original);
  const plate = crop(original, square);
  console.log(`original ${String(original.width)}×${String(original.height)}; plate x ${String(square.plate.left)}–${String(square.plate.right)}, y ${String(square.plate.top)}–${String(square.plate.bottom)}; kept ${String(square.side)}×${String(square.side)} from (${String(square.x)}, ${String(square.y)})`);
  /** @type {Map<number, Rgba>} */
  const sizes = new Map();
  for (const size of new Set([...LINUX_SIZES, ...ICO_SIZES, ...RUNTIME_SIZES])) sizes.set(size, resize(plate, size));
  /** @param {number} size */
  const at = (size) => {
    const image = sizes.get(size);
    if (image === undefined) throw new Error(`no ${String(size)}`);
    return image;
  };
  /** @param {string} file @param {Buffer} bytes */
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    console.log(`wrote ${path.relative(appDir, file).split(path.sep).join('/')} (${String(bytes.length)} bytes)`);
  };
  for (const size of LINUX_SIZES) write(path.join(appDir, 'build', 'icons', `${String(size)}x${String(size)}.png`), png(at(size)));
  write(path.join(appDir, 'build', 'icon.ico'), ico(ICO_SIZES.map(at)));
  for (const size of RUNTIME_SIZES) write(path.join(appDir, 'src', 'renderer', 'public', 'icons', `dspatch-${String(size)}.png`), png(at(size)));
  const sheetAt = process.argv.indexOf('--sheet');
  const sheetFile = sheetAt >= 0 ? process.argv[sheetAt + 1] : undefined;
  if (sheetFile !== undefined) write(path.resolve(sheetFile), sheet(sizes));
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
