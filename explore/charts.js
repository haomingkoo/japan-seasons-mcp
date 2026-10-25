// Small linked SVG charts. Each returns { setCursor(day) } so the timeline can drive them.

import { fmtDay } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function frame(svg) {
  svg.textContent = '';
  const r = svg.getBoundingClientRect();
  const W = Math.max(200, r.width);
  const H = Math.max(80, r.height);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  return { W, H, m: { l: 30, r: 10, t: 8, b: 18 } };
}

function monthTicks(start, end) {
  const ticks = [];
  for (let d = start; d <= end; d++) {
    const date = new Date(d * 86400000);
    const day = date.getUTCDate();
    if (day === 1 || day === 15) ticks.push(d);
  }
  return ticks;
}

function timeAxis(g, x, start, end, y) {
  for (const d of monthTicks(start, end)) {
    el('line', { x1: x(d), x2: x(d), y1: y, y2: y + 3, class: 'tick' }, g);
    el('text', { x: x(d), y: y + 13, class: 'axis-label', 'text-anchor': 'middle' }, g).textContent = fmtDay(d);
  }
}

function yAxis(g, y, values, x0, x1, fmt = String) {
  for (const v of values) {
    el('line', { x1: x0, x2: x1, y1: y(v), y2: y(v), class: 'grid' }, g);
    el('text', { x: x0 - 5, y: y(v) + 3, class: 'axis-label', 'text-anchor': 'end' }, g).textContent = fmt(v);
  }
}

function scrubbable(svg, x, start, end, onScrub) {
  if (!onScrub) return;
  const toDay = (ev) => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const px = ((ev.clientX - r.left) / r.width) * vb.width;
    const lo = x(start); const hi = x(end);
    return start + ((Math.min(hi, Math.max(lo, px)) - lo) / (hi - lo)) * (end - start);
  };
  svg.onpointerdown = (ev) => { svg.setPointerCapture(ev.pointerId); onScrub(toDay(ev)); };
  svg.onpointermove = (ev) => { if (svg.hasPointerCapture(ev.pointerId)) onScrub(toDay(ev)); };
}

// Cities in bloom over time: stacked "opening" and "full bloom" counts.
export function bloomChart(svg, series, season, labels, onScrub) {
  const { W, H, m } = frame(svg);
  const start = season.start; const end = season.end;
  const total = Math.max(1, season.cities.length);
  const x = (d) => m.l + ((d - start) / (end - start)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / total) * (H - m.t - m.b);
  const g = el('g', {}, svg);
  const half = Math.round(total / 2 / 5) * 5 || 1;
  yAxis(g, y, [0, half, total], m.l, W - m.r);
  timeAxis(g, x, start, end, H - m.b);
  const areaPath = (top, bottom) => {
    let p = '';
    series.forEach((s, i) => { p += `${i ? 'L' : 'M'}${x(s.day).toFixed(1)},${y(top(s)).toFixed(1)}`; });
    for (let i = series.length - 1; i >= 0; i--) p += `L${x(series[i].day).toFixed(1)},${y(bottom(series[i])).toFixed(1)}`;
    return `${p}Z`;
  };
  el('path', { d: areaPath((s) => s.peak, () => 0), class: `area peak ${season.kind}` }, g);
  el('path', { d: areaPath((s) => s.peak + s.opening, (s) => s.peak), class: `area opening ${season.kind}` }, g);
  const cur = el('g', { class: 'cursor' }, svg);
  const line = el('line', { y1: m.t, y2: H - m.b }, cur);
  const dot = el('circle', { r: 3.5 }, cur);
  const label = el('text', { class: 'cursor-label', y: m.t + 9 }, cur);
  scrubbable(svg, x, start, end, onScrub);
  return {
    setCursor(day) {
      const s = series[Math.max(0, Math.min(series.length - 1, Math.round(day) - start))];
      const cx = x(day);
      line.setAttribute('x1', cx); line.setAttribute('x2', cx);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', y(s.peak + s.opening));
      label.textContent = `${s.opening + s.peak} ${labels.inBloom}`;
      const right = cx > W * 0.6;
      label.setAttribute('x', right ? cx - 6 : cx + 6);
      label.setAttribute('text-anchor', right ? 'end' : 'start');
    },
  };
}

// Front speed in km per day, positive in the season's direction of travel.
export function speedChart(svg, speeds, season, onScrub) {
  const { W, H, m } = frame(svg);
  const start = season.start; const end = season.end;
  const vals = speeds.map((s) => s.kmPerDay).filter(Number.isFinite);
  const max = Math.max(20, Math.ceil(Math.max(...vals, 0) / 20) * 20);
  const min = Math.min(0, Math.floor(Math.min(...vals, 0) / 20) * 20);
  const x = (d) => m.l + ((d - start) / (end - start)) * (W - m.l - m.r);
  const y = (v) => H - m.b - ((v - min) / (max - min)) * (H - m.t - m.b);
  const g = el('g', {}, svg);
  yAxis(g, y, [min, 0, max].filter((v, i, a) => a.indexOf(v) === i), m.l, W - m.r);
  timeAxis(g, x, start, end, H - m.b);
  let p = '';
  let pen = false;
  for (const s of speeds) {
    if (!Number.isFinite(s.kmPerDay)) { pen = false; continue; }
    p += `${pen ? 'L' : 'M'}${x(s.day).toFixed(1)},${y(s.kmPerDay).toFixed(1)}`;
    pen = true;
  }
  el('path', { d: p, class: `line ${season.kind}` }, g);
  const cur = el('g', { class: 'cursor' }, svg);
  const line = el('line', { y1: m.t, y2: H - m.b }, cur);
  const dot = el('circle', { r: 3.5 }, cur);
  const label = el('text', { class: 'cursor-label', y: m.t + 9 }, cur);
  scrubbable(svg, x, start, end, onScrub);
  return {
    setCursor(day) {
      const s = speeds[Math.max(0, Math.min(speeds.length - 1, Math.round(day) - start))];
      const cx = x(day);
      line.setAttribute('x1', cx); line.setAttribute('x2', cx);
      const ok = s && Number.isFinite(s.kmPerDay);
      dot.style.display = ok ? '' : 'none';
      if (ok) { dot.setAttribute('cx', cx); dot.setAttribute('cy', y(s.kmPerDay)); }
      label.textContent = ok ? `${Math.round(s.kmPerDay)} km/day` : 'No front on land';
      const right = cx > W * 0.6;
      label.setAttribute('x', right ? cx - 6 : cx + 6);
      label.setAttribute('text-anchor', right ? 'end' : 'start');
    },
  };
}

// This year's date against the JMA average for each city, south to north.
// Cities the front has reached by the cursor date are filled.
export function trendChart(svg, season, onPick) {
  const { W, H, m } = frame(svg);
  m.l = 58;
  const pts = season.cities.filter((c) => Number.isFinite(c.diff));
  if (!pts.length) {
    el('text', { x: W / 2, y: H / 2, class: 'axis-label', 'text-anchor': 'middle' }, svg).textContent = 'No average dates in this data';
    return { setCursor() {} };
  }
  const lat0 = Math.floor(Math.min(...pts.map((c) => c.lat)));
  const lat1 = Math.ceil(Math.max(...pts.map((c) => c.lat)));
  const lim = Math.max(6, Math.ceil(Math.max(...pts.map((c) => Math.abs(c.diff))) / 3) * 3);
  const x = (lat) => m.l + ((lat - lat0) / (lat1 - lat0)) * (W - m.l - m.r);
  const y = (d) => m.t + ((d + lim) / (2 * lim)) * (H - m.t - m.b);
  const g = el('g', {}, svg);
  for (const v of [-lim, 0, lim]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'grid zero' : 'grid' }, g);
    const t = v === 0 ? 'average' : `${Math.abs(v)}d ${v < 0 ? 'early' : 'late'}`;
    el('text', { x: m.l - 5, y: y(v) + 3, class: 'axis-label', 'text-anchor': 'end' }, g).textContent = t;
  }
  for (let lat = Math.ceil(lat0 / 2) * 2; lat <= lat1; lat += 2) {
    el('text', { x: x(lat), y: H - m.b + 13, class: 'axis-label', 'text-anchor': 'middle' }, g).textContent = `${lat}°N`;
  }
  const dots = pts.map((c) => {
    const d = el('circle', { cx: x(c.lat), cy: y(c.diff), r: 3.2, class: `dot ${season.kind}`, tabindex: -1 }, g);
    const title = el('title', {}, d);
    title.textContent = `${c.name}: ${c.diff === 0 ? 'same as average' : `${Math.abs(c.diff)} days ${c.diff < 0 ? 'earlier' : 'later'}`}`;
    d.addEventListener('pointerenter', () => onPick?.(c));
    return [c, d];
  });
  return {
    setCursor(day) {
      for (const [c, d] of dots) d.classList.toggle('reached', c.front <= day);
    },
  };
}
