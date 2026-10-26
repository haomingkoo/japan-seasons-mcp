// Interpolated date field between JMC spots and JMA cities, painted into a canvas that
// MapLibre drapes over the terrain. Rows are linear in Web Mercator so the image lines up.

export const BOUNDS = { west: 122.8, east: 146.0, south: 23.8, north: 45.7 };

const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const latFromMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

export function gridShape(width) {
  const xSpan = (BOUNDS.east - BOUNDS.west) * RAD;
  const ySpan = mercY(BOUNDS.north) - mercY(BOUNDS.south);
  return { width, height: Math.round((width * ySpan) / xSpan) };
}

export function pixelToLngLat(px, py, width, height) {
  const lon = BOUNDS.west + ((px + 0.5) / width) * (BOUNDS.east - BOUNDS.west);
  const y = mercY(BOUNDS.north) - ((py + 0.5) / height) * (mercY(BOUNDS.north) - mercY(BOUNDS.south));
  return [lon, latFromMercY(y)];
}

export function lngLatToPixel(lon, lat, width, height) {
  const px = ((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * width - 0.5;
  const py = ((mercY(BOUNDS.north) - mercY(lat)) / (mercY(BOUNDS.north) - mercY(BOUNDS.south))) * height - 0.5;
  return [px, py];
}

export function corners() {
  return [[BOUNDS.west, BOUNDS.north], [BOUNDS.east, BOUNDS.north], [BOUNDS.east, BOUNDS.south], [BOUNDS.west, BOUNDS.south]];
}

// Inverse-distance weighting over the k nearest points. Support fades to zero 28 km from the
// nearest point, so open sea and areas with no spots stay unshaded.
export function buildField(points, width) {
  const { height } = gridShape(width);
  const n = width * height;
  const dates = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const support = new Float32Array(n);
  const CELL = 0.4;
  const buckets = new Map();
  const key = (i, j) => i * 10000 + j;
  for (const p of points) {
    const k = key(Math.floor(p.lon / CELL), Math.floor(p.lat / CELL));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const K = 6;
  const near = [];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const [lon, lat] = pixelToLngLat(px, py, width, height);
      const kx = Math.cos(lat * RAD) * 111;
      const bi = Math.floor(lon / CELL);
      const bj = Math.floor(lat / CELL);
      near.length = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const b = buckets.get(key(bi + di, bj + dj));
          if (!b) continue;
          for (const p of b) {
            const dx = (p.lon - lon) * kx;
            const dy = (p.lat - lat) * 111;
            near.push([dx * dx + dy * dy, p]);
          }
        }
      }
      const idx = py * width + px;
      if (!near.length) { support[idx] = 0; continue; }
      near.sort((a, b) => a[0] - b[0]);
      const dMin = Math.sqrt(near[0][0]);
      support[idx] = smoothstep(28, 10, dMin);
      if (support[idx] <= 0) continue;
      let wSum = 0;
      const acc = [0, 0, 0, 0];
      for (let i = 0; i < Math.min(K, near.length); i++) {
        const w = 1 / (near[i][0] + 4);
        const d = near[i][1].dates;
        acc[0] += w * d[0]; acc[1] += w * d[1]; acc[2] += w * d[2]; acc[3] += w * d[3];
        wSum += w;
      }
      for (let c = 0; c < 4; c++) dates[c][idx] = acc[c] / wSum;
    }
  }
  return { width, height, dates, support };
}

export function sampleField(field, lon, lat) {
  const [fx, fy] = lngLatToPixel(lon, lat, field.width, field.height);
  const px = Math.round(fx);
  const py = Math.round(fy);
  if (px < 0 || py < 0 || px >= field.width || py >= field.height) return null;
  const i = py * field.width + px;
  if (field.support[i] < 0.35) return null;
  return [field.dates[0][i], field.dates[1][i], field.dates[2][i], field.dates[3][i]];
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Colour stops per phase value 0..4 (see phaseValue in data.js), as [r, g, b, alpha].
export const RAMPS = {
  sakura: [
    [0, [150, 120, 104, 0]],
    [0.6, [168, 116, 112, 0.18]],
    [1, [236, 150, 178, 0.42]],
    [2, [222, 70, 120, 0.62]],
    [2.8, [236, 120, 160, 0.52]],
    [3.4, [176, 182, 120, 0.34]],
    [4, [120, 156, 96, 0.0]],
  ],
  koyo: [
    [0, [104, 140, 84, 0]],
    [0.5, [112, 146, 82, 0.22]],
    [1, [214, 172, 64, 0.48]],
    [2, [214, 92, 38, 0.68]],
    [2.7, [178, 44, 36, 0.74]],
    [3.4, [132, 84, 58, 0.36]],
    [4, [120, 96, 80, 0.0]],
  ],
};

export function rampColor(ramp, v) {
  if (v <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    if (v <= ramp[i][0]) {
      const [a, ca] = ramp[i - 1];
      const [b, cb] = ramp[i];
      const t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, ca[3] + (cb[3] - ca[3]) * t];
    }
  }
  return ramp[ramp.length - 1][1];
}

// 256-entry lookup per ramp, indexed by phase value * 64.
function lut(ramp) {
  const out = new Uint8ClampedArray(257 * 4);
  for (let i = 0; i <= 256; i++) {
    const c = rampColor(ramp, i / 64);
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3] * 255;
  }
  return out;
}
const LUTS = { sakura: lut(RAMPS.sakura), koyo: lut(RAMPS.koyo) };

export function paintField(field, kind, day, imageData, glow = 0) {
  const { dates, support } = field;
  const [d0, d1, d2, d3] = dates;
  const px = imageData.data;
  const L = LUTS[kind];
  for (let i = 0; i < support.length; i++) {
    const s = support[i];
    const o = i * 4;
    if (s <= 0) { px[o + 3] = 0; continue; }
    let v;
    if (day < d0[i]) v = 0;
    else if (day < d1[i]) v = (day - d0[i]) / Math.max(1, d1[i] - d0[i]);
    else if (day < d2[i]) v = 1 + (day - d1[i]) / Math.max(1, d2[i] - d1[i]);
    else if (day < d3[i]) v = 2 + (day - d2[i]) / Math.max(1, d3[i] - d2[i]);
    else v = Math.min(4, 3 + (day - d3[i]) / 10);
    const li = Math.min(256, Math.round(v * 64)) * 4;
    // Brighten a narrow band where the front is arriving today.
    const edge = glow > 0 ? Math.max(0, 1 - Math.abs(day - d1[i]) / 1.6) * glow : 0;
    px[o] = L[li] + (255 - L[li]) * edge * 0.35;
    px[o + 1] = L[li + 1] + (255 - L[li + 1]) * edge * 0.35;
    px[o + 2] = L[li + 2] + (255 - L[li + 2]) * edge * 0.35;
    px[o + 3] = Math.min(255, (L[li + 3] + edge * 60) * s);
  }
}

// Marching squares on the arrival date (d1). Cells with weak support are skipped so the line
// stops at the coast instead of crossing open sea.
export function contour(field, level, step = 2) {
  const { width, height, support } = field;
  const d1 = field.dates[1];
  const segs = [];
  const at = (x, y) => d1[y * width + x];
  const ok = (x, y) => support[y * width + x] > 0.55;
  for (let y = 0; y + step < height; y += step) {
    for (let x = 0; x + step < width; x += step) {
      if (!ok(x, y) || !ok(x + step, y) || !ok(x, y + step) || !ok(x + step, y + step)) continue;
      const a = at(x, y); const b = at(x + step, y); const c = at(x + step, y + step); const d = at(x, y + step);
      let code = 0;
      if (a >= level) code |= 8;
      if (b >= level) code |= 4;
      if (c >= level) code |= 2;
      if (d >= level) code |= 1;
      if (code === 0 || code === 15) continue;
      const lerp = (v0, v1) => (level - v0) / (v1 - v0 || 1e-6);
      const top = [x + step * lerp(a, b), y];
      const right = [x + step, y + step * lerp(b, c)];
      const bottom = [x + step * lerp(d, c), y + step];
      const left = [x, y + step * lerp(a, d)];
      const pairs = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
        5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]],
        9: [[top, bottom]], 10: [[left, bottom], [top, right]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      }[code];
      for (const [p, q] of pairs) segs.push([pixelToLngLat(p[0], p[1], width, height), pixelToLngLat(q[0], q[1], width, height)]);
    }
  }
  return joinSegments(segs);
}

// Chain the marching-squares segments into polylines so the glow renders continuously.
function joinSegments(segs) {
  const k = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const key = k(p);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const next = (p) => {
    for (const j of ends.get(k(p)) || []) {
      if (used[j]) continue;
      used[j] = 1;
      return k(segs[j][0]) === k(p) ? segs[j][1] : segs[j][0];
    }
    return null;
  };
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (let p = next(line[line.length - 1]); p; p = next(p)) line.push(p);
    for (let p = next(line[0]); p; p = next(p)) line.unshift(p);
    if (line.length >= 3) lines.push(line);
  }
  return lines;
}

export function meanLatitude(lines) {
  let sum = 0;
  let n = 0;
  for (const l of lines) for (const p of l) { sum += p[1]; n++; }
  return n ? sum / n : null;
}
