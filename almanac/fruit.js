// /fruit and /fruit/<slug>: which farms are open for which fruit, through the year.
import { createMap, setTerrain, fitRegion, hasWebGL } from './map.js';
import { FRUIT_COLORS as COLORS } from './colors.js';
import { createTimeline, fmtDayOfYear, monthName, pct } from './timeline.js';
import { dayOfYear, isoToDayOfYear, rangeLabel, tripDays, daysInMonthCovered } from '../src/lib/fruit-seasons.ts';

const $ = (id) => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');


const state = {
  data: null, farms: [], fruits: [], region: 'japan', day: 1, trip: null,
  selected: new Set(), focus: null, farm: null, dim: '2d',
};
let map = null;
let mapReady = false;
let timeline = null;
let open = [];          // per farm: Uint16Array(366) of fruit bits open on each day
let monthBits = [];     // per farm: per fruit index, 12-bit mask of months open 10+ days
let listedBits = [];    // per farm: fruit bits whose dates come from listings (farm or region)
let farmBits = [];      // per farm: fruit bits whose dates are the farm's own
let shown = new Int8Array(0);
let shownColor = new Int8Array(0);
let shownSrc = new Int8Array(0);

function todayJst() {
  const iso = new Date(Date.now() + 9 * 3600000).toISOString();
  return { iso: iso.slice(0, 10), day: isoToDayOfYear(iso) };
}

// ---------- data ----------

async function load() {
  const v = app.dataset.version || '';
  const res = await fetch(`/api/fruit/seasons?v=${encodeURIComponent(v)}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function prepare(data) {
  state.data = data;
  state.fruits = data.fruits;
  const idx = Object.fromEntries(data.fruits.map((f, i) => [f.name, i]));
  state.farms = data.farms.map((f, i) => ({ ...f, i }));
  open = state.farms.map((f) => {
    const days = new Uint16Array(366);
    for (const s of f.seasons) {
      const bit = 1 << idx[s.fruit];
      for (const [from, to] of s.ranges) {
        const a = dayOfYear(from);
        const b = dayOfYear(to);
        if (a <= b) for (let d = a; d <= b; d++) days[d] |= bit;
        else { for (let d = a; d <= 365; d++) days[d] |= bit; for (let d = 1; d <= b; d++) days[d] |= bit; }
      }
    }
    return days;
  });
  monthBits = state.farms.map((f) => {
    const out = new Uint16Array(data.fruits.length);
    for (const s of f.seasons) {
      let mask = 0;
      for (let m = 1; m <= 12; m++) if (s.ranges.some((r) => daysInMonthCovered(r, m) >= 10)) mask |= 1 << (m - 1);
      out[idx[s.fruit]] = mask;
    }
    return out;
  });
  listedBits = state.farms.map((f) => f.seasons.reduce((m, s) => (s.source !== 'typical' ? m | (1 << idx[s.fruit]) : m), 0));
  farmBits = state.farms.map((f) => f.seasons.reduce((m, s) => (s.source === 'farm' ? m | (1 << idx[s.fruit]) : m), 0));
  shown = new Int8Array(state.farms.length).fill(-1);
  shownColor = new Int8Array(state.farms.length).fill(-1);
  shownSrc = new Int8Array(state.farms.length).fill(-1);
  state.fruitIdx = idx;
}

const inRegion = (f) => state.region === 'japan' || f.region === state.region;
const regionName = (id = state.region) => (id === 'japan' ? 'Japan' : state.data.regions.find((r) => r.id === id)?.name ?? id);
const fruitByName = (name) => state.fruits.find((f) => f.name === name);
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

function activeMask() {
  if (state.focus) return 1 << state.fruitIdx[state.focus.name];
  if (!state.selected.size) return 0xffff;
  let m = 0;
  for (const name of state.selected) m |= 1 << state.fruitIdx[name];
  return m;
}

function openMaskFor(i) {
  if (!state.trip) return open[i][state.day];
  let m = 0;
  for (const d of state.trip.days) m |= open[i][d];
  return m;
}

// Peak months for a fruit from farms that list their own dates, in one region or all of Japan.
function listingProfile(fruitName, region = 'japan') {
  const k = state.fruitIdx[fruitName];
  const bit = 1 << k;
  const farms = state.farms.filter((f) => (farmBits[f.i] & bit) && (region === 'japan' || f.region === region));
  const counts = Array(12).fill(0);
  for (const f of farms) for (let m = 0; m < 12; m++) if (monthBits[f.i][k] & (1 << m)) counts[m]++;
  const max = Math.max(...counts);
  return { listed: farms.length, counts, peak: max ? counts.flatMap((c, m) => (c >= max * 0.85 ? [m + 1] : [])) : [] };
}

function monthsLabel(months) {
  if (!months.length) return '';
  const runs = [];
  for (const m of months) {
    const last = runs[runs.length - 1];
    if (last && m === last[1] + 1) last[1] = m; else runs.push([m, m]);
  }
  // Join a run ending in December with one starting in January.
  if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1][1] === 12) { runs[runs.length - 1][1] = runs[0][1]; runs.shift(); }
  return runs.map(([a, b]) => (a === b ? monthName(a, true) : `${monthName(a, true)} to ${monthName(b, true)}`)).join(', ');
}

// ---------- map ----------

function initMap() {
  map = createMap('map', { attribution: 'Farms: <a href="https://www.jalan.net/kankou/" target="_blank" rel="noopener">Jalan</a>' });
  map.on('load', () => {
    const features = state.farms.map((f) => ({ type: 'Feature', id: f.i, geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: {} }));
    map.addSource('farms', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    const colorMatch = ['match', ['coalesce', ['feature-state', 'c'], -1]];
    state.fruits.forEach((f, i) => colorMatch.push(i, COLORS[f.name] ?? '#5a534b'));
    colorMatch.push('#5a534b');
    const visible = ['==', ['coalesce', ['feature-state', 'v'], 0], 1];
    const own = ['==', ['coalesce', ['feature-state', 's'], 0], 1];
    map.addLayer({
      id: 'farms', type: 'circle', source: 'farms',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', visible, 2.6, 0], 7, ['case', visible, 4.2, 0], 11, ['case', visible, 7, 0]],
        'circle-color': ['case', own, colorMatch, '#fffcf7'],
        'circle-stroke-color': ['case', own, '#fffcf7', colorMatch],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, ['case', visible, ['case', own, 0.6, 1.4], 0], 9, ['case', visible, ['case', own, 1.2, 2], 0]],
        'circle-pitch-alignment': 'viewport',
      },
    });
    map.addLayer({
      id: 'farm-selected', type: 'circle', source: 'farms', filter: ['==', ['id'], -1],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 11, 12], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#1f1c18', 'circle-stroke-width': 2 },
    });
    mapReady = true;
    shown.fill(-1);
    render();
    fitRegion(map, state.region, { reducedMotion: true });
    $('map-status').textContent = '';
  });
  map.on('error', (e) => console.warn('Map tile error', e?.error?.message || e));
  const tip = $('tip');
  map.on('mousemove', 'farms', (e) => {
    const f = topFeature(e);
    if (!f) { tip.hidden = true; return; }
    const farm = state.farms[f.id];
    map.getCanvas().style.cursor = 'pointer';
    const names = openFruitNames(farm);
    tip.innerHTML = `<b>${esc(farm.name)}</b><br><span class="sub">${esc(farm.pref)} · ${esc(names.join(', ') || 'Out of season')}</span>`;
    tip.hidden = false;
    const { width, height } = map.getContainer().getBoundingClientRect();
    tip.style.left = `${Math.min(e.point.x + 14, width - 270)}px`;
    tip.style.top = `${Math.min(e.point.y + 14, height - 60)}px`;
  });
  map.on('mouseleave', 'farms', () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
  map.on('click', (e) => {
    const box = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    const hits = map.queryRenderedFeatures(box, { layers: ['farms'] }).filter((f) => shown[f.id] === 1);
    if (!hits.length) return;
    hits.sort((a, b) => dist(a, e) - dist(b, e));
    selectFarm(hits[0].id, false);
  });
}

function dist(f, e) {
  const p = map.project(f.geometry.coordinates);
  return (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
}
function topFeature(e) {
  return e.features?.find((f) => shown[f.id] === 1) ?? null;
}

function openFruitNames(farm) {
  const mask = openMaskFor(farm.i);
  return state.fruits.filter((f, k) => mask & (1 << k)).map((f) => f.label);
}

function pickColor(mask) {
  if (state.focus) return state.fruitIdx[state.focus.name];
  for (let k = 0; k < state.fruits.length; k++) if (mask & (1 << k)) return k;
  return -1;
}

function updateMapStates() {
  if (!mapReady) return;
  const sel = activeMask();
  for (let i = 0; i < state.farms.length; i++) {
    const mask = openMaskFor(i) & sel;
    const v = mask ? 1 : 0;
    const c = v ? pickColor(mask) : -1;
    const s = v && (farmBits[i] & (1 << c)) ? 1 : 0;
    if (v !== shown[i] || c !== shownColor[i] || s !== shownSrc[i]) {
      map.setFeatureState({ source: 'farms', id: i }, { v, c, s });
      shown[i] = v; shownColor[i] = c; shownSrc[i] = s;
    }
  }
}

// ---------- render ----------

function counts() {
  const sel = activeMask();
  const perFruit = new Array(state.fruits.length).fill(0);
  const perFruitTotal = new Array(state.fruits.length).fill(0);
  let farmsOpen = 0;
  let ownOpen = 0;
  for (const f of state.farms) {
    if (!inRegion(f)) continue;
    const mask = openMaskFor(f.i);
    for (let k = 0; k < state.fruits.length; k++) {
      if (f.seasons.some((s) => s.fruit === state.fruits[k].name)) perFruitTotal[k]++;
      if (mask & (1 << k)) perFruit[k]++;
    }
    if (mask & sel) { farmsOpen++; if (farmBits[f.i] & mask & sel) ownOpen++; }
  }
  return { perFruit, perFruitTotal, farmsOpen, ownOpen };
}

function render() {
  updateMapStates();
  const c = counts();
  renderHeadline(c);
  renderFruitList(c);
  renderLegend(c);
  renderCalendarCursor();
  scheduleFarmList();
}

function whenLabel() {
  if (!state.trip) return fmtDayOfYear(state.day);
  const f = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(state.trip.start)} to ${f(state.trip.end)}`;
}

function renderHeadline(c) {
  $('tl-date').textContent = whenLabel();
  const fruitsOpen = c.perFruit.filter((n, k) => n && (activeMask() & (1 << k))).length;
  const where = state.region === 'japan' ? '' : ` in ${regionName()}`;
  $('tl-sub').textContent = c.farmsOpen
    ? `${plural(c.farmsOpen, 'farm', 'farms')} open${where}${state.focus ? '' : ` for ${plural(fruitsOpen, 'fruit', 'fruits')}`}`
    : `No farms open${where}${state.focus ? ` for ${state.focus.label.toLowerCase()}` : ''} on these dates`;
  $('tl-note').textContent = c.farmsOpen ? `${nf.format(c.ownOpen)} of them list their own dates` : '';
}

function renderFruitList(c) {
  const list = $('fruit-list');
  const sel = activeMask();
  const rows = state.fruits
    .map((f, k) => ({ f, k, n: c.perFruit[k], total: c.perFruitTotal[k] }))
    .filter((r) => r.total && (!state.focus || r.f.name === state.focus.name));
  const on = rows.filter((r) => r.n).sort((a, b) => b.n - a.n);
  const off = rows.filter((r) => !r.n);
  if (!on.length) {
    list.innerHTML = `<li class="empty">${state.focus ? `${esc(state.focus.label)} are out of season ${state.trip ? 'on these dates' : 'on this date'}${state.region === 'japan' ? '' : ` in ${esc(regionName())}`}. The calendar below shows when they open.` : 'Nothing is in season on these dates here. Try another month or region.'}</li>`;
  } else {
    list.innerHTML = on.map(({ f, k, n }) => {
      const prof = listingProfile(f.name, state.region);
      const peak = prof.listed >= 5 ? `peak ${monthsLabel(prof.peak)}` : `peak ${monthsLabel(f.peak)}, approximate`;
      const pressed = state.focus ? 'true' : String(state.selected.has(f.name));
      const link = state.focus ? '' : `<a class="pick-link" href="/fruit/${f.slug}${state.region !== 'japan' ? `?region=${state.region}` : ''}">${esc(f.label)}: farms, peak and regions</a>`;
      return `<li class="pick-row"><button type="button" class="pick" data-fruit="${esc(f.name)}" aria-pressed="${pressed}" ${state.focus ? 'disabled' : ''}>
        <span class="sw" style="background:${COLORS[f.name]}"></span>
        <span><span class="p-name">${esc(f.label)}</span> <span class="muted" lang="ja">${esc(f.ja)}</span><span class="p-sub">${esc(peak)}</span></span>
        <span class="p-count">${plural(n, 'farm', 'farms')}</span>
      </button>${link}</li>`;
    }).join('');
  }
  if (!state.focus && off.length) {
    list.insertAdjacentHTML('beforeend', `<li class="empty">Out of season: ${off.map(({ f }) => `<a href="/fruit/${f.slug}">${esc(f.label)}</a>`).join(', ')}.</li>`);
  }
  if (state.selected.size && !state.focus) {
    list.insertAdjacentHTML('beforeend', '<li class="list-foot"><button type="button" class="link-btn" id="show-all">Show every fruit</button></li>');
  }
}

function renderLegend(c) {
  const el = $('legend');
  const sel = activeMask();
  const items = state.fruits.filter((f, k) => c.perFruit[k] && (sel & (1 << k))).slice(0, 8);
  if (!items.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="lg-title">${state.focus ? esc(state.focus.label) : 'In season'}</div>
    <ul>${items.map((f) => `<li><span class="sw" style="background:${COLORS[f.name]}"></span>${esc(f.label)}</li>`).join('')}</ul>
    <div class="lg-note"><span><span class="sw" style="background:var(--text-2)"></span>Farm lists its own dates</span><span><span class="sw ring" style="color:var(--text-2)"></span>Season estimated, check with the farm</span></div>`;
}

// ---------- calendar strip ----------

function calendarRows() {
  if (state.focus) {
    // One row per region for this fruit.
    const k = state.fruitIdx[state.focus.name];
    return state.data.regions.map((r) => ({ key: r.id, label: r.name, k, farms: state.farms.filter((f) => f.region === r.id && f.seasons.some((s) => s.fruit === state.focus.name)), href: null, region: r.id }))
      .filter((row) => row.farms.length);
  }
  return state.fruits.map((f, k) => ({ key: f.name, label: f.label, k, farms: state.farms.filter((x) => inRegion(x) && x.seasons.some((s) => s.fruit === f.name)), href: `/fruit/${f.slug}${state.region !== 'japan' ? `?region=${state.region}` : ''}` }))
    .filter((row) => row.farms.length);
}

function renderCalendar() {
  const rows = calendarRows();
  $('cal-title').textContent = state.focus
    ? `When ${state.focus.label.toLowerCase()} are in season, by region`
    : `When each fruit is in season${state.region === 'japan' ? '' : ` in ${regionName()}`}`;
  $('cal-key').innerHTML = '<span><i style="background:color-mix(in srgb, var(--text-2) 95%, #e9e1d3)"></i>Most farms open</span><span><i style="background:color-mix(in srgb, var(--text-2) 40%, #e9e1d3)"></i>A few farms open</span><span><i class="approx" style="background-color:color-mix(in srgb, var(--text-2) 70%, #e9e1d3);background-image:repeating-linear-gradient(135deg, rgba(255,252,247,.5) 0 1.5px, transparent 1.5px 4.5px)"></i>Mostly estimated</span>';
  if (!rows.length) {
    $('cal-rows').innerHTML = '<p class="empty">No farms listed here.</p>';
    return;
  }
  $('cal-rows').innerHTML = rows.map((row) => {
    const bit = 1 << row.k;
    const color = COLORS[state.fruits[row.k].name];
    const cells = [];
    const summary = [];
    for (let m = 0; m < 12; m++) {
      const openFarms = row.farms.filter((f) => monthBits[f.i][row.k] & (1 << m));
      const share = openFarms.length / row.farms.length;
      const estimated = openFarms.filter((f) => !(listedBits[f.i] & bit)).length;
      const approx = openFarms.length && estimated / openFarms.length > 0.5;
      if (share >= 0.5) summary.push(m + 1);
      const bg = share ? `color-mix(in srgb, ${color} ${Math.round(25 + 75 * share)}%, #e9e1d3)` : '';
      cells.push(`<i class="${approx ? 'approx' : ''}" style="${bg ? `background-color:${bg}` : ''}" title="${esc(`${row.label}, ${monthName(m + 1, true)}: ${openFarms.length} of ${row.farms.length} farms open${approx ? ', mostly estimated' : ''}`)}"></i>`);
    }
    const aria = `${row.label}: ${plural(row.farms.length, 'farm', 'farms')}, most open ${monthsLabel(summary) || 'no single month'}`;
    const label = `<span class="cal-name">${esc(row.label)}</span><span class="cal-count">${nf.format(row.farms.length)}</span>`;
    const head = row.href
      ? `<a class="cal-label" href="${row.href}" aria-label="${esc(aria)}">${label}</a>`
      : `<button type="button" class="cal-label" data-region="${row.region}" aria-pressed="${state.region === row.region}" aria-label="${esc(aria)}">${label}</button>`;
    return `<div class="cal-row">${head}<div class="cal-cells" aria-hidden="true">${cells.join('')}</div></div>`;
  }).join('') + '<div class="cal-cursor-wrap" aria-hidden="true"></div>';
  renderCalendarCursor();
}

function renderCalendarCursor() {
  const rowsEl = $('cal-rows');
  let cur = rowsEl.querySelector('.cal-cursor');
  const firstCells = rowsEl.querySelector('.cal-cells');
  if (!firstCells) return;
  if (!cur) { cur = document.createElement('i'); cur.className = 'cal-cursor'; rowsEl.appendChild(cur); }
  const box = rowsEl.getBoundingClientRect();
  const cells = firstCells.getBoundingClientRect();
  cur.style.left = `${cells.left - box.left + ((state.day - 1) / 364) * cells.width}px`;
  cur.hidden = !!state.trip;
}

// ---------- farm detail and list ----------

function selectFarm(i, fly = true) {
  state.farm = i;
  const farm = state.farms[i];
  if (mapReady) {
    map.setFilter('farm-selected', ['==', ['id'], i]);
    if (fly) map.flyTo({ center: [farm.lon, farm.lat], zoom: Math.max(map.getZoom(), 10), duration: reducedMotion ? 0 : 900 });
  }
  const card = $('farm-card');
  const mask = openMaskFor(i);
  const rows = farm.seasons.map((s) => {
    const k = state.fruitIdx[s.fruit];
    const f = state.fruits[k];
    const src = s.source === 'farm' ? "From the farm's listing"
      : s.source === 'region' ? `Estimated from ${s.basis} farm listings in ${regionName(farm.region)}`
        : 'Typical season, approximate';
    const status = mask & (1 << k) ? (state.trip ? 'Open on your dates' : 'Open on this date') : (state.trip ? 'Closed on your dates' : 'Closed on this date');
    return `<dt><span class="sw" style="background:${COLORS[s.fruit]}"></span>${esc(f.label)}</dt>
      <dd>${esc(s.ranges.map(rangeLabel).join(' and '))}<span class="src">${esc(status)}. ${esc(src)}.</span></dd>`;
  }).join('');
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${farm.lat},${farm.lon}`;
  card.innerHTML = `<h3>${esc(farm.name)}</h3><p class="addr">${esc(farm.pref)} · ${esc(farm.address)}</p>
    <dl>${rows}</dl>
    <div class="links"><a href="${esc(farm.url)}" target="_blank" rel="noopener">Farm page on Jalan</a><a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a></div>
    ${farm.period ? `<p class="period">The listing says: <span lang="ja">${esc(farm.period)}</span></p>` : ''}`;
  card.hidden = false;
  if (matchMedia('(max-width: 960px)').matches) card.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
}

let farmListTimer = 0;
function scheduleFarmList() {
  clearTimeout(farmListTimer);
  farmListTimer = setTimeout(renderFarmList, 180);
}
function renderFarmList() {
  const sel = activeMask();
  const farms = state.farms.filter((f) => inRegion(f) && (openMaskFor(f.i) & sel));
  $('farms-summary').textContent = `Open farms${state.region === 'japan' ? '' : ` in ${regionName()}`} (${nf.format(farms.length)})`;
  if (!$('farms-details').open) return;
  farms.sort((a, b) => a.pref.localeCompare(b.pref) || a.name.localeCompare(b.name, 'ja'));
  const shownFarms = farms.slice(0, 150);
  $('farm-list').innerHTML = shownFarms.length
    ? shownFarms.map((f) => `<li><button type="button" data-farm="${f.i}"><span>${esc(f.name)}</span><span class="f-sub">${esc(f.pref)} · ${esc(openFruitNames(f).join(', '))}</span></button></li>`).join('')
      + (farms.length > shownFarms.length ? `<li class="empty">Showing 150 of ${nf.format(farms.length)}. Pick a region or a fruit to narrow the list.</li>` : '')
    : '<li class="empty">No farms open here on these dates.</li>';
}

// ---------- profile (per-fruit page) ----------

function renderProfile() {
  const card = $('profile-card');
  if (!state.focus) { card.hidden = true; return; }
  const f = state.focus;
  const k = state.fruitIdx[f.name];
  const farms = state.farms.filter((x) => x.seasons.some((s) => s.fruit === f.name));
  const prof = listingProfile(f.name);
  const byPref = {};
  for (const x of farms) byPref[x.pref] = (byPref[x.pref] || 0) + 1;
  const top = Object.entries(byPref).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0]?.[1] || 1;
  const listedSeason = prof.listed >= 5 ? monthsLabel(prof.counts.flatMap((c, m) => (c >= prof.listed * 0.4 ? [m + 1] : []))) : null;
  card.innerHTML = `<h2 class="card-title">${esc(f.label)} <span class="muted" lang="ja">${esc(f.ja)}</span></h2>
    <dl>
      <dt>Farms</dt><dd>${nf.format(farms.length)} in ${Object.keys(byPref).length} prefectures</dd>
      ${listedSeason ? `<dt>Season</dt><dd>${esc(listedSeason)}, from ${nf.format(prof.listed)} farms that list dates</dd><dt>Most farms open</dt><dd>${esc(monthsLabel(prof.peak))}</dd>`
        : `<dt>Season</dt><dd>${esc(monthsLabel(f.months))}, approximate</dd>`}
      <dt>Typical guide</dt><dd>${esc(monthsLabel(f.months))}, peak ${esc(monthsLabel(f.peak))}</dd>
    </dl>
    ${f.note ? `<p class="muted" style="margin-top:8px">${esc(f.note.replace(/—/g, ','))}</p>` : ''}
    <h3 class="card-title" style="margin-top:10px">Most farms</h3>
    <ul class="bars">${top.map(([p, n]) => `<li><span>${esc(p)}</span><span class="bar" style="width:${(n / max) * 100}%;background:${COLORS[f.name]}"></span><span class="n">${n}</span></li>`).join('')}</ul>
    <p style="margin-top:10px"><button type="button" class="btn" id="btn-hotspot">See ${esc(hotspot(farms).pref)} in 3D</button></p>`;
  card.hidden = false;
  $('btn-hotspot').addEventListener('click', () => flyToHotspot(farms));
}

// Densest 0.3° cell of farms for a fruit, as the place where relief is worth seeing.
function hotspot(farms) {
  const cells = {};
  for (const f of farms) {
    const key = `${Math.round(f.lat / 0.3)}:${Math.round(f.lon / 0.3)}`;
    (cells[key] ||= []).push(f);
  }
  const best = Object.values(cells).sort((a, b) => b.length - a.length)[0] || farms;
  const lat = best.reduce((s, f) => s + f.lat, 0) / best.length;
  const lon = best.reduce((s, f) => s + f.lon, 0) / best.length;
  const prefCount = {};
  for (const f of best) prefCount[f.pref] = (prefCount[f.pref] || 0) + 1;
  return { lat, lon, pref: Object.entries(prefCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'the main area', n: best.length };
}

function flyToHotspot(farms) {
  if (!mapReady) return;
  const h = hotspot(farms);
  setDim('3d', false);
  map.flyTo({ center: [h.lon, h.lat], zoom: 10.2, pitch: 60, bearing: -20, duration: reducedMotion ? 0 : 2200 });
}

function setDim(dim, ease = true) {
  state.dim = dim;
  document.querySelectorAll('#dim-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dim === dim)));
  if (mapReady) setTerrain(map, dim === '3d', { reducedMotion: reducedMotion || !ease });
}

// ---------- sources ----------

function renderSources() {
  const d = state.data;
  const total = state.farms.length;
  const own = state.farms.filter((f) => f.seasons.some((s) => s.source === 'farm')).length;
  const region = state.farms.filter((f) => f.seasons.some((s) => s.source === 'region')).length;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown');
  $('sources').innerHTML = `
    <p><strong>Farms.</strong> ${nf.format(total)} farms with a map location, from the fruit-picking listings on <a href="https://www.jalan.net/kankou/" target="_blank" rel="noopener">Jalan</a>, updated ${esc(fmt(d.farmsUpdated))}.</p>
    <p><strong>Farm dates.</strong> ${nf.format(own)} farms write their picking season in their listing's opening period, read on ${esc(fmt(d.datesChecked))}. These show as solid dots.</p>
    <p><strong>Estimates.</strong> For a farm without dates, the season comes from farms with the same fruit in the same region, when at least five of them list dates (${nf.format(region)} farms). Otherwise it is the typical national season for that fruit. These show as rings and are approximate.</p>
    <p><strong>Calendar.</strong> Each cell is the share of farms open at least 10 days of that month. Hatched cells are mostly estimates.</p>
    <p>Seasons move with the weather and the harvest. Check with the farm before you go.</p>`;
}

// ---------- URL state ----------

function readUrl() {
  const p = new URLSearchParams(location.search);
  const region = p.get('region');
  if (region && document.querySelector(`#region option[value="${CSS.escape(region)}"]`)) state.region = region;
  const day = Number(p.get('day'));
  state.day = day >= 1 && day <= 365 ? day : todayJst().day;
  const from = p.get('from');
  const to = p.get('to');
  if (from && to) setTrip(from, to, false);
  for (const name of (p.get('fruit') || '').split(',')) if (fruitByName(name)) state.selected.add(name);
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.region !== 'japan') p.set('region', state.region);
  if (state.trip) { p.set('from', state.trip.start); p.set('to', state.trip.end); } else p.set('day', String(state.day));
  if (state.selected.size && !state.focus) p.set('fruit', [...state.selected].join(','));
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

function setTrip(start, end, apply = true) {
  const err = $('dates-error');
  err.hidden = true;
  if (!start || !end) { err.textContent = 'Pick both dates.'; err.hidden = false; return false; }
  if (end < start) { err.textContent = 'The end date is before the start date.'; err.hidden = false; return false; }
  const days = tripDays(start, end);
  state.trip = { start, end, days };
  $('date-from').value = start;
  $('date-to').value = end;
  $('dates-clear').hidden = false;
  state.day = days[0];
  if (apply) { timeline.set(state.day, { emit: false }); timeline.setBand(days); render(); writeUrl(); }
  return true;
}

function clearTrip() {
  state.trip = null;
  $('date-from').value = '';
  $('date-to').value = '';
  $('dates-clear').hidden = true;
  timeline.setBand(null);
  render();
  writeUrl();
}

// ---------- wiring ----------

function wire() {
  timeline = createTimeline({
    input: $('tl-input'), axis: $('tl-axis'), marks: $('tl-marks'), playBtn: $('btn-play'),
    daysPerSecond: 30, reducedMotion,
    onChange: (d) => {
      state.day = d;
      if (state.trip) { state.trip = null; $('dates-clear').hidden = true; $('date-from').value = ''; $('date-to').value = ''; timeline.setBand(null); }
      render();
      writeUrlSoon();
    },
  });
  $('btn-today').addEventListener('click', () => { timeline.pause(); timeline.set(todayJst().day); });
  $('region').addEventListener('change', (e) => {
    state.region = e.target.value;
    if (mapReady) fitRegion(map, state.region, { reducedMotion });
    renderCalendar();
    render();
    writeUrl();
  });
  $('dates-form').addEventListener('submit', (e) => { e.preventDefault(); timeline.pause(); setTrip($('date-from').value, $('date-to').value); });
  $('dates-clear').addEventListener('click', clearTrip);
  $('fruit-list').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (e.target.id === 'show-all') { state.selected.clear(); render(); writeUrl(); return; }
    const btn = e.target.closest('.pick');
    if (!btn || state.focus) return;
    const name = btn.dataset.fruit;
    if (state.selected.has(name)) state.selected.delete(name); else state.selected.add(name);
    render();
    writeUrl();
  });
  $('cal-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button.cal-label');
    if (!btn) return;
    const region = state.region === btn.dataset.region ? 'japan' : btn.dataset.region;
    $('region').value = region;
    $('region').dispatchEvent(new Event('change'));
  });
  $('farm-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-farm]');
    if (btn) selectFarm(Number(btn.dataset.farm));
  });
  $('farms-details').addEventListener('toggle', renderFarmList);
  document.querySelectorAll('#dim-seg button').forEach((b) => b.addEventListener('click', () => setDim(b.dataset.dim)));
  // Tabs
  const tabs = [$('tab-season'), $('tab-sources')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(next);
      tabs[next].focus();
    });
  });
  function selectTab(i) {
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = i !== j;
    });
  }
  addEventListener('resize', () => renderCalendarCursor());
}

let urlTimer = 0;
function writeUrlSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(writeUrl, 300); }

async function start() {
  const slug = location.pathname.split('/')[2] || '';
  wire();
  let data;
  try {
    data = await load();
  } catch {
    $('map-status').innerHTML = 'The farm list did not load. <br><button type="button" class="btn" id="retry">Try again</button>';
    $('retry').addEventListener('click', () => location.reload());
    $('fruit-list').innerHTML = '<li class="empty">The farm list did not load.</li>';
    return;
  }
  prepare(data);
  state.focus = slug ? data.fruits.find((f) => f.slug === slug) ?? null : null;
  if (state.focus) {
    $('dim-seg').hidden = false;
    document.querySelector('.page-nav a[href="/fruit"]').removeAttribute('aria-current');
  }
  readUrl();
  $('region').value = state.region;
  timeline.set(state.day, { emit: false });
  timeline.setToday(todayJst().day);
  if (state.trip) timeline.setBand(state.trip.days);
  renderSources();
  renderProfile();
  renderCalendar();
  render();
  if (hasWebGL) initMap();
  else $('map-status').textContent = 'This browser cannot draw the map. The calendar and the farm list still work.';
}

start();
