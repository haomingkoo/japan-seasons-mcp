// Flat fallback for browsers without WebGL2: the same terrain tiles decoded on a 2D canvas,
// with the interpolated wash and the city dots on top.

import { BOUNDS } from './field.js';
import { fmtDay } from './data.js';

const Z = 6;
const TILE = 256;
const RAD = Math.PI / 180;
const worldX = (lon) => ((lon + 180) / 360) * TILE * 2 ** Z;
const worldY = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / Math.PI) / 2) * TILE * 2 ** Z;
const LABELS = new Set(['Kagoshima', 'Fukuoka', 'Hiroshima', 'Osaka', 'Kyoto', 'Nagoya', 'Tokyo', 'Niigata', 'Sendai', 'Aomori', 'Sapporo']);

let base = null;

async function buildBase() {
  const x0 = worldX(BOUNDS.west); const x1 = worldX(BOUNDS.east);
  const y0 = worldY(BOUNDS.north); const y1 = worldY(BOUNDS.south);
  const w = Math.round(x1 - x0); const h = Math.round(y1 - y0);
  const elev = document.createElement('canvas');
  elev.width = w; elev.height = h;
  const ctx = elev.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0); resolve(); };
        img.onerror = resolve;
        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
      }));
    }
  }
  await Promise.all(jobs);
  const src = ctx.getImageData(0, 0, w, h).data;
  const land = new ImageData(w, h);
  const sea = new ImageData(w, h);
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = src[i * 4] * 256 + src[i * 4 + 1] + src[i * 4 + 2] / 256 - 32768;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (e[i] <= 0) {
        sea.data.set([195, 205, 203, 255], o);
        land.data.set([195, 205, 203, 255], o);
        continue;
      }
      const t = Math.min(1, e[i] / 2400);
      const dx = (e[Math.min(i + 1, w * h - 1)] - e[Math.max(i - 1, 0)]) / 2;
      const dy = (e[Math.min(i + w, w * h - 1)] - e[Math.max(i - w, 0)]) / 2;
      const shade = Math.max(-0.35, Math.min(0.35, (-dx + dy) / 900));
      const r = (235 - 70 * t) * (1 + shade);
      const g = (228 - 75 * t) * (1 + shade);
      const b = (211 - 80 * t) * (1 + shade);
      land.data.set([r, g, b, 255], o);
    }
  }
  const toCanvas = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(img, 0, 0); return c; };
  return { land: toCanvas(land), sea: toCanvas(sea), w, h, x0, y0 };
}

export async function drawStaticMap(canvas, wash, season, day) {
  if (!base) base = buildBase();
  const b = await base;
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c3cdcb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / b.w, canvas.height / b.h) * 0.96;
  const ox = (canvas.width - b.w * scale) / 2;
  const oy = (canvas.height - b.h * scale) / 2;
  ctx.drawImage(b.land, ox, oy, b.w * scale, b.h * scale);
  ctx.drawImage(wash, ox, oy, b.w * scale, b.h * scale);
  ctx.globalCompositeOperation = 'source-over';
  // Sea pixels redrawn over the wash; the sea canvas is transparent on land.
  const seaMask = b.sea;
  ctx.drawImage(seaMask, ox, oy, b.w * scale, b.h * scale);
  const px = (lon, lat) => [ox + (worldX(lon) - b.x0) * scale, oy + (worldY(lat) - b.y0) * scale];
  ctx.font = `${12 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  for (const c of season.cities) {
    const [x, y] = px(c.lon, c.lat);
    const reached = c.front <= day;
    ctx.beginPath();
    ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = reached ? (season.kind === 'sakura' ? '#b8245c' : '#b4400f') : '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#2a2622';
    ctx.stroke();
    if (LABELS.has(c.name)) {
      const text = `${c.name} ${fmtDay(season.kind === 'sakura' ? c.front : c.peak)}`;
      ctx.fillStyle = 'rgba(38,34,30,0.88)';
      const tw = ctx.measureText(text).width;
      ctx.fillRect(x + 7 * dpr, y - 9 * dpr, tw + 10 * dpr, 18 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 12 * dpr, y + 4 * dpr);
    }
  }
}
