// Coarse elevation for the autumn model, decoded from the same open terrain tiles the 3D map
// streams (zoom 6, about 2 km per pixel). The browser usually has them cached already.

import { BOUNDS } from './field.js';

const Z = 6;
const TILE = 256;
const RAD = Math.PI / 180;
const worldX = (lon) => ((lon + 180) / 360) * TILE * 2 ** Z;
const worldY = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / Math.PI) / 2) * TILE * 2 ** Z;
const URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;

let pending = null;

export function loadDem() {
  if (pending) return pending;
  pending = (async () => {
    const x0 = worldX(BOUNDS.west); const x1 = worldX(BOUNDS.east);
    const y0 = worldY(BOUNDS.north); const y1 = worldY(BOUNDS.south);
    const w = Math.ceil(x1 - x0); const h = Math.ceil(y1 - y0);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
        jobs.push(new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0); resolve(); };
          img.onerror = () => reject(new Error('terrain tile failed'));
          img.src = URL(tx, ty);
        }));
      }
    }
    await Promise.all(jobs);
    const px = ctx.getImageData(0, 0, w, h).data;
    const elev = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) elev[i] = Math.max(0, px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768);
    return makeDem(elev, w, h, x0, y0);
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

// Wraps a grid in Web Mercator pixel space; exported for tests.
export function makeDem(elev, w, h, x0, y0) {
  const at = (x, y) => elev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  return {
    w, h,
    // Bilinear height in metres at a longitude and latitude.
    sample(lon, lat) {
      const fx = worldX(lon) - x0 - 0.5;
      const fy = worldY(lat) - y0 - 0.5;
      const ix = Math.floor(fx); const iy = Math.floor(fy);
      const tx = fx - ix; const ty = fy - iy;
      const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      return a * (1 - ty) + b * ty;
    },
  };
}
