// /festivals: the year's matsuri, fireworks and winter festivals on a timeline and a map.
import { createMap, hasWebGL } from './map.js';
import { FESTIVAL_TYPES as TYPES } from './colors.js';
import { createTimeline, fmtDayOfYear, pct, MONTH_START } from './timeline.js';
import { occurrence, occurrenceCovers, whenLine } from '../src/lib/festival-dates.ts';
import { dayOfYear } from '../src/lib/fruit-seasons.ts';

const $ = (id) => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');

const SOON_DAYS = 21;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const state = { festivals: [], year: 0, day: 1, types: new Set(Object.keys(TYPES)), selected: null };
let map = null;
let mapReady = false;
let timeline = null;

function todayJst() {
  const iso = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return { iso, year: Number(iso.slice(0, 4)), day: dayOfYear([Number(iso.slice(5, 7)), Number(iso.slice(8, 10))]) };
}

function isoFor(day, year = state.year) {
  let m = 12;
  while (m > 1 && MONTH_START[m - 1] > day) m--;
  return `${year}-${String(m).padStart(2, '0')}-${String(day - MONTH_START[m - 1] + 1).padStart(2, '0')}`;
}
const dayOfIso = (iso) => dayOfYear([Number(iso.slice(5, 7)), Number(iso.slice(8, 10))]);
const seasonOf = (day) => {
  const m = Number(isoFor(day).slice(5, 7));
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'sakura' : m <= 8 ? 'flowers' : 'koyo';
};

// Occurrences that touch the chosen year, including a winter season carried over from last year.
function occurrencesFor(f) {
  const out = [];
  for (const y of [state.year - 1, state.year]) {
    const occ = occurrence(f, y);
    if (occ && occ.end >= `${state.year}-01-01` && occ.start <= `${state.year}-12-31`) out.push(occ);
  }
  return out;
}

// "Several dates" festivals have no known day, so they are never shown as on; only as this month.
const several = (f) => f.when?.type === 'several';
function activeOn(f, iso) {
  return !several(f) && occurrencesFor(f).some((occ) => occurrenceCovers(f, occ, iso));
}
function thisMonth(f, iso) {
  return several(f) && f.when.months.includes(Number(iso.slice(5, 7))) && occurrencesFor(f).length > 0;
}

function nextStart(f, iso) {
  const starts = [occurrence(f, state.year), occurrence(f, state.year + 1)].filter(Boolean).map((o) => o.start).filter((s) => s > iso);
  return starts[0] ?? null;
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const visible = (f) => state.types.has(f.type);

// ---------- map ----------

function squareImage(color, filled) {
  const s = 22;
  const c = document.createElement('canvas');
  c.width = s * 2; c.height = s * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = filled ? color : '#fffcf7';
  ctx.strokeStyle = filled ? '#fffcf7' : color;
  ctx.lineWidth = filled ? 2 : 2.5;
  ctx.beginPath();
  ctx.roundRect(4, 4, s - 8, s - 8, 2.5);
  ctx.fill();
  ctx.stroke();
  return { width: s * 2, height: s * 2, data: ctx.getImageData(0, 0, s * 2, s * 2).data };
}

function initMap() {
  map = createMap('map', { attribution: 'Festivals: Japan in Seasons, checked against official sites' });
  map.on('load', () => {
    for (const [type, t] of Object.entries(TYPES)) {
      map.addImage(`sq-${type}`, squareImage(t.color, true), { pixelRatio: 2 });
      map.addImage(`sq-${type}-soon`, squareImage(t.color, false), { pixelRatio: 2 });
    }
    const features = state.festivals.map((f, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { i, type: f.type, name: f.name } }));
    map.addSource('fests', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: 'fest-soon', type: 'symbol', source: 'fests', filter: ['in', ['get', 'i'], ['literal', []]],
      layout: { 'icon-image': ['concat', 'sq-', ['get', 'type'], '-soon'], 'icon-size': 0.8, 'icon-allow-overlap': true },
    });
    map.addLayer({
      id: 'fest-active', type: 'symbol', source: 'fests', filter: ['in', ['get', 'i'], ['literal', []]],
      layout: {
        'icon-image': ['concat', 'sq-', ['get', 'type']], 'icon-size': 1.15, 'icon-allow-overlap': true,
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12.5, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto',
        'text-optional': true, 'text-max-width': 12,
      },
      paint: { 'text-color': '#1f1c18', 'text-halo-color': '#fffcf7', 'text-halo-width': 1.6 },
    });
    map.addLayer({
      id: 'fest-selected', type: 'circle', source: 'fests', filter: ['==', ['get', 'i'], -1],
      paint: { 'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#1f1c18', 'circle-stroke-width': 2 },
    }, 'fest-soon');
    mapReady = true;
    $('map-status').textContent = '';
    render();
  });
  map.on('error', (e) => console.warn('Map tile error', e?.error?.message || e));
  const tip = $('tip');
  for (const layer of ['fest-active', 'fest-soon']) {
    map.on('mousemove', layer, (e) => {
      const f = state.festivals[e.features[0].properties.i];
      map.getCanvas().style.cursor = 'pointer';
      const w = whenLine(f, state.year);
      tip.innerHTML = `<b>${esc(f.name)}</b><br><span class="sub">${esc(w.date)} · ${esc(f.place)}</span>`;
      tip.hidden = false;
      const { width, height } = map.getContainer().getBoundingClientRect();
      tip.style.left = `${Math.min(e.point.x + 14, width - 270)}px`;
      tip.style.top = `${Math.min(e.point.y + 14, height - 60)}px`;
    });
    map.on('mouseleave', layer, () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
    map.on('click', layer, (e) => select(e.features[0].properties.i, { fly: false }));
  }
}

// Filters re-lay out the symbol layers, so only touch them when the sets change, not every frame.
let lastMapKey = '';
function updateMap(activeIdx, soonIdx) {
  if (!mapReady) return;
  const key = `${activeIdx}|${soonIdx}|${state.selected}`;
  if (key === lastMapKey) return;
  lastMapKey = key;
  map.setFilter('fest-active', ['in', ['get', 'i'], ['literal', activeIdx]]);
  map.setFilter('fest-soon', ['in', ['get', 'i'], ['literal', soonIdx]]);
  map.setFilter('fest-selected', ['==', ['get', 'i'], state.selected ?? -1]);
}

// ---------- render ----------

function render() {
  const iso = isoFor(state.day);
  app.dataset.season = seasonOf(state.day);
  const active = [];
  const soon = [];
  const month = [];
  state.festivals.forEach((f, i) => {
    if (!visible(f)) return;
    if (activeOn(f, iso)) active.push(i);
    else if (thisMonth(f, iso)) month.push(i);
    else if (!several(f)) {
      const next = nextStart(f, iso);
      if (next && daysBetween(iso, next) <= SOON_DAYS) soon.push(i);
    }
  });
  updateMap(active, soon.concat(month));
  $('tl-date').textContent = `${fmtDayOfYear(state.day)}, ${state.year}`;
  $('tl-sub').textContent = active.length ? `${active.length} festival${active.length === 1 ? '' : 's'} on` : 'No festivals in the calendar on this day';
  $('tl-note').textContent = soon.length ? `${soon.length} more in the next three weeks` : '';
  renderDayList(iso, active, soon, month);
  renderLegend();
  renderLaneCursor();
}

function festRow(i, iso, mode) {
  const f = state.festivals[i];
  const t = TYPES[f.type];
  let when;
  if (mode === 'soon') {
    const next = nextStart(f, iso);
    const n = daysBetween(iso, next);
    const occ = [occurrence(f, state.year), occurrence(f, state.year + 1)].find((o) => o && o.start === next);
    when = occ?.precision === 'approx' ? `${whenLine(f, Number(next.slice(0, 4))).date}` : `In ${n} day${n === 1 ? '' : 's'}`;
  } else {
    // A winter season on now may have started last year.
    const occ = occurrencesFor(f).find((o) => occurrenceCovers(f, o, iso));
    when = whenLine(f, occ?.year ?? state.year).date;
  }
  return `<li><button type="button" class="pick" data-fest="${i}" aria-pressed="${state.selected === i}">
    <span class="sw sq" style="background:${t.color}"></span>
    <span><span class="p-name">${esc(f.name)}</span><span class="p-sub">${esc(f.place)} · ${esc(when)}</span></span>
    <span class="p-count">${esc(t.label)}</span></button></li>`;
}

function renderDayList(iso, active, soon, month) {
  const el = $('day-list');
  let html = '';
  if (active.length) html += `<ul class="pick-list">${active.map((i) => festRow(i, iso, 'on')).join('')}</ul>`;
  else {
    const next = state.festivals.map((f, i) => ({ i, s: visible(f) && !several(f) ? nextStart(f, iso) : null })).filter((x) => x.s).sort((a, b) => a.s.localeCompare(b.s))[0];
    html += `<p class="empty">Nothing in the calendar on this day.${next ? ` Next up: <button type="button" class="link-btn" data-jump="${next.i}">${esc(state.festivals[next.i].name)}</button>.` : ''}</p>`;
  }
  if (month.length) html += `<h3 class="card-title" style="margin:10px 0 4px">On some dates this month</h3><ul class="pick-list">${month.map((i) => festRow(i, iso, 'on')).join('')}</ul>`;
  if (soon.length) {
    soon.sort((a, b) => nextStart(state.festivals[a], iso).localeCompare(nextStart(state.festivals[b], iso)));
    html += `<h3 class="card-title" style="margin:10px 0 4px">Coming up</h3><ul class="pick-list">${soon.map((i) => festRow(i, iso, 'soon')).join('')}</ul>`;
  }
  el.innerHTML = html;
}

let legendKey = '';
function renderLegend() {
  const el = $('legend');
  const key = [...state.types].join();
  if (key === legendKey) return;
  legendKey = key;
  el.hidden = false;
  el.innerHTML = `<ul>${Object.entries(TYPES).filter(([k]) => state.types.has(k)).map(([, t]) => `<li><span class="sw sq" style="background:${t.color}"></span>${esc(t.plural)}</li>`).join('')}</ul>
    <div class="lg-note"><span><span class="sw sq" style="background:var(--text-2)"></span>On this date</span><span><span class="sw sq ring" style="color:var(--text-2)"></span>Within three weeks</span></div>`;
}

// ---------- lanes: each festival as a bar on its type's lane ----------

function laneBars(f, i) {
  const bars = [];
  for (const occ of occurrencesFor(f)) {
    const yStart = `${state.year}-01-01`;
    const yEnd = `${state.year}-12-31`;
    const s = occ.start < yStart ? 1 : dayOfIso(occ.start);
    const e = occ.end > yEnd ? 365 : dayOfIso(occ.end);
    if (f.when?.type === 'several') {
      for (const m of f.when.months) bars.push({ i, a: MONTH_START[m - 1], b: MONTH_START[m - 1] + MONTH_DAYS[m - 1] - 1, kind: 'several' });
    } else {
      bars.push({ i, a: s, b: e, kind: occ.precision });
    }
  }
  return bars;
}

function packRows(bars) {
  const rows = [];
  for (const bar of bars.sort((x, y) => x.a - y.a)) {
    const minEnd = Math.max(bar.b, bar.a + 4);
    let r = rows.findIndex((end) => end < bar.a);
    if (r === -1) { rows.push(minEnd); r = rows.length - 1; } else rows[r] = minEnd;
    bar.row = r;
  }
  return rows.length;
}

function renderLanes() {
  const lanes = $('lanes');
  const html = [];
  for (const [type, t] of Object.entries(TYPES)) {
    if (!state.types.has(type)) continue;
    const bars = state.festivals.flatMap((f, i) => (f.type === type ? laneBars(f, i) : []));
    const rows = Math.max(1, packRows(bars));
    const count = state.festivals.filter((f) => f.type === type && occurrencesFor(f).length).length;
    html.push(`<div class="lane"><div class="cal-label lane-label"><span class="cal-name">${esc(t.plural)}</span><span class="cal-count">${count}</span></div>
      <div class="lane-track" style="height:${rows * 9 + 2}px">${bars.map((b) => {
        const f = state.festivals[b.i];
        const label = `${f.name}: ${whenLine(f, state.year).date}`;
        return `<button type="button" class="lane-bar ${b.kind}" data-fest="${b.i}" aria-label="${esc(label)}" title="${esc(label)}" style="left:${pct(b.a)};width:max(6px, calc(${pct(b.b)} - ${pct(b.a)} + 3px));top:${b.row * 9}px;--c:${t.color}"></button>`;
      }).join('')}</div></div>`);
  }
  lanes.innerHTML = html.join('') + '<i class="cal-cursor lane-cursor" aria-hidden="true"></i>';
  laneGeom = null;
  $('lanes-key').innerHTML = '<span><i style="background:var(--text-2)"></i>Fixed or likely dates</span><span><i class="approx" style="background-color:color-mix(in srgb, var(--text-2) 60%, #e9e1d3)"></i>Rough timing, check the year</span>';
  renderLaneCursor();
}

// Track geometry is measured once per layout, so scrubbing never forces a reflow.
let laneGeom = null;
function renderLaneCursor() {
  const lanes = $('lanes');
  const cur = lanes.querySelector('.lane-cursor');
  const track = lanes.querySelector('.lane-track');
  if (!cur || !track) return;
  if (!laneGeom) {
    const box = lanes.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    laneGeom = { left: t.left - box.left, width: t.width };
  }
  cur.style.transform = `translateX(${laneGeom.left + ((state.day - 1) / 364) * laneGeom.width}px)`;
}

// ---------- detail ----------

function select(i, { fly = true, jump = false } = {}) {
  state.selected = i;
  const f = state.festivals[i];
  const t = TYPES[f.type];
  if (jump) {
    const occ = occurrence(f, state.year) ?? occurrence(f, state.year + 1);
    if (occ) {
      if (Number(occ.start.slice(0, 4)) !== state.year) setYear(Number(occ.start.slice(0, 4)), false);
      timeline.set(dayOfIso(occ.start));
    }
  }
  if (mapReady && fly) map.flyTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 7.5), duration: reducedMotion ? 0 : 900 });
  const current = occurrencesFor(f).find((o) => occurrenceCovers(f, o, isoFor(state.day)));
  const w = whenLine(f, current?.year ?? state.year);
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}`;
  const card = $('fest-card');
  card.innerHTML = `<h3>${esc(f.name)} <span class="muted" lang="ja">${esc(f.nameJa)}</span></h3>
    <p class="addr"><span class="sw sq" style="background:${t.color};display:inline-block;margin-right:6px;vertical-align:-1px"></span>${esc(t.label)} · ${esc(f.place)}${f.place.includes(f.prefecture) || f.prefecture === 'Nationwide' ? '' : `, ${esc(f.prefecture)}`}</p>
    <dl>
      <dt>When</dt><dd>${esc(w.date)}<span class="src">${esc(w.note)} Listed as: ${esc(f.typicalDate)}.</span></dd>
      <dt>What</dt><dd>${esc(f.summary)}</dd>
      ${f.attendance ? `<dt>Crowds</dt><dd>About ${nf.format(f.attendance)} visitors</dd>` : ''}
    </dl>
    <div class="links">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">Official site</a>` : ''}<a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a><a href="/plan?from=${encodeURIComponent((occurrence(f, state.year) ?? occurrence(f, state.year + 1))?.start ?? '')}&to=${encodeURIComponent((occurrence(f, state.year) ?? occurrence(f, state.year + 1))?.end ?? '')}">Plan a trip for these dates</a></div>`;
  card.hidden = false;
  render();
  if (matchMedia('(max-width: 960px)').matches) card.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
}

// ---------- controls ----------

function setYear(y, rerender = true) {
  state.year = y;
  document.querySelectorAll('#year-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.year) === y)));
  renderLanes();
  const today = $('tl-marks').querySelector('.tl-today');
  if (today) today.hidden = y !== todayJst().year;
  if (rerender) { render(); if (state.selected != null) select(state.selected, { fly: false }); }
  writeUrl();
}

function renderTypes() {
  $('type-list').innerHTML = Object.entries(TYPES).map(([k, t]) => {
    const n = state.festivals.filter((f) => f.type === k).length;
    return `<li><label class="type-row"><input type="checkbox" value="${k}" ${state.types.has(k) ? 'checked' : ''}><span class="sw sq" style="background:${t.color}"></span><span>${esc(t.plural)}</span><span class="muted num">${n}</span></label></li>`;
  }).join('');
}

function renderSources(data) {
  const n = state.festivals.length;
  const counts = { exact: 0, rule: 0, approx: 0, season: 0, several: 0 };
  for (const f of state.festivals) {
    const occ = occurrence(f, state.year) ?? occurrence(f, state.year + 1);
    if (occ) counts[occ.precision]++;
  }
  const fmt = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'unknown');
  $('sources').innerHTML = `
    <p><strong>The list.</strong> ${n} major festivals chosen by Japan in Seasons, with each official site checked on ${esc(fmt(data.verified || data.updated))}. It is not every festival in Japan.</p>
    <p><strong>Same dates every year.</strong> ${counts.exact} festivals, such as Gion Matsuri in July.</p>
    <p><strong>Worked out from a rule.</strong> ${counts.rule} festivals fall on a weekday pattern such as the last Saturday of July. The page works out that day for the year you pick; confirm on the official site.</p>
    <p><strong>Rough timing.</strong> ${counts.approx} festivals only have a usual window, such as mid August. These show as hatched bars and say to check the year's dates.</p>
    <p><strong>Long runs and several dates.</strong> ${counts.season} run through a whole period, and ${counts.several} happen on several dates a year.</p>
    <p>Two festivals are held every other year. Dates move for weather, holidays and local decisions, so check before you book.</p>`;
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const t = todayJst();
  const y = Number(p.get('year'));
  state.year = y === t.year || y === t.year + 1 ? y : t.year;
  const d = Number(p.get('day'));
  state.day = d >= 1 && d <= 365 ? d : t.day;
  const types = (p.get('types') || '').split(',').filter((k) => TYPES[k]);
  if (types.length) state.types = new Set(types);
  const id = p.get('festival');
  const idx = state.festivals.findIndex((f) => f.id === id);
  return idx >= 0 ? idx : null;
}
let urlTimer = 0;
function writeUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const p = new URLSearchParams({ year: String(state.year), day: String(state.day) });
    if (state.types.size !== Object.keys(TYPES).length) p.set('types', [...state.types].join(','));
    if (state.selected != null) p.set('festival', state.festivals[state.selected].id);
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }, 250);
}

function wire() {
  timeline = createTimeline({
    input: $('tl-input'), axis: $('tl-axis'), marks: $('tl-marks'), playBtn: $('btn-play'),
    daysPerSecond: 20, reducedMotion,
    label: (d) => `${fmtDayOfYear(d)}, ${state.year}`,
    onChange: (d) => { state.day = d; render(); writeUrl(); },
  });
  $('btn-today').addEventListener('click', () => {
    timeline.pause();
    const t = todayJst();
    if (t.year !== state.year) setYear(t.year, false);
    timeline.set(t.day);
  });
  const clickFest = (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { select(Number(jump.dataset.jump), { jump: true }); return; }
    const btn = e.target.closest('[data-fest]');
    if (btn) select(Number(btn.dataset.fest), { jump: btn.classList.contains('lane-bar') });
  };
  $('day-list').addEventListener('click', clickFest);
  $('lanes').addEventListener('click', clickFest);
  $('type-list').addEventListener('change', (e) => {
    if (e.target.checked) state.types.add(e.target.value); else state.types.delete(e.target.value);
    renderLanes();
    render();
    writeUrl();
  });
  const tabs = [$('tab-day'), $('tab-sources')];
  const selectTab = (i) => tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = i !== j; });
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = (i + 1) % 2;
      selectTab(next);
      tabs[next].focus();
    });
  });
  addEventListener('resize', () => { laneGeom = null; renderLaneCursor(); });
}

async function start() {
  wire();
  let data;
  try {
    const res = await fetch(`/api/festivals?v=${encodeURIComponent(app.dataset.version || '')}`);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    $('map-status').innerHTML = 'The festival list did not load.<br><button type="button" class="btn" id="retry">Try again</button>';
    $('retry').addEventListener('click', () => location.reload());
    $('day-list').innerHTML = '<p class="empty">The festival list did not load.</p>';
    return;
  }
  state.festivals = data.spots.filter((f) => f.when && TYPES[f.type]);
  const pre = readUrl();
  const t = todayJst();
  $('year-seg').innerHTML = [t.year, t.year + 1].map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === state.year}">${y}</button>`).join('');
  $('year-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setYear(Number(b.dataset.year)); });
  renderTypes();
  renderSources(data);
  renderLanes();
  timeline.set(state.day, { emit: false });
  timeline.setToday(t.day);
  $('tl-marks').querySelector('.tl-today').hidden = state.year !== t.year;
  render();
  if (pre != null) select(pre, { fly: false });
  if (hasWebGL) initMap();
  else $('map-status').textContent = 'This browser cannot draw the map. The timeline and the festival list still work.';
}

start();
