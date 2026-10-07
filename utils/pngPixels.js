// Minimal PNG decoder (built-in zlib only, no npm dependency) - enough for Android
// screenshots from Appium: 8-bit RGB/RGBA, non-interlaced. Used to tell whether a chart
// actually rendered, since custom-drawn charts expose nothing in the accessibility tree.
const zlib = require('zlib');

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (off < buf.length) {
    const len  = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 2: 3, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels || interlace) {
    throw new Error(`unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace})`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// Fraction (0-1) of pixels in the region that differ noticeably from the region's most
// common colour (its background). A blank chart area scores ~0; drawn lines, axes, grid
// or rows score well above it. Samples every `step`th pixel for speed. Pass `bgColor`
// ([r, g, b]) when the background is known - for a small icon whose drawn shape can
// cover most of the region, the most common colour would be the shape itself.
function regionCoverage(img, { top, bottom, left = 0, right = img.width }, step = 3, bgColor = null) {
  top = Math.max(0, Math.round(top)); bottom = Math.min(img.height, Math.round(bottom));
  left = Math.max(0, Math.round(left)); right = Math.min(img.width, Math.round(right));
  const px = (x, y) => {
    const i = (y * img.width + x) * img.channels;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const counts = new Map();
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const [r, g, b] = px(x, y);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (!counts.size) return 0;
  const bgKey = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const bg = bgColor || [(bgKey >> 10) << 3, ((bgKey >> 5) & 31) << 3, (bgKey & 31) << 3];
  let total = 0, differ = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const [r, g, b] = px(x, y);
      total++;
      if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 60) differ++;
    }
  }
  return total ? differ / total : 0;
}

function pixelAt(img, x, y) {
  const i = (Math.round(y) * img.width + Math.round(x)) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

module.exports = { decodePng, regionCoverage, pixelAt };
