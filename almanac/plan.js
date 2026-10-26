// /plan: one view of a trip. The blossom or colour front, festivals on, and fruit farms open.
import { createMap, fitRegion, hasWebGL, REGION_BOUNDS } from './map.js';
import { FRUIT_COLORS, FESTIVAL_TYPES, PHASES } from './colors.js';
import { frontForTrip, peaksDuring, phaseBucket, phaseCounts, tripDayList, MAX_TRIP_DAYS } from './plan-model.js';
import { buildKoyoSeason, buildSakuraSeason, fmtDay, isoToDay, dayToDate } from '../explore/data.js';
import { tripDays as tripDaysOfYear, rangesOverlapDays, rangeLabel, regionOfPrefecture } from '../src/lib/fruit-seasons.ts';
import { occurrencesInRange, occurrenceCovers, whenLine } from '../src/lib/festival-dates.ts';
import { koyoForecastFreshness } from '../src/lib/koyo-freshness.ts';

const $ = (id) => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// /explore groups Chugoku and Shikoku with Kansai.
const EXPLORE_REGION = { japan: 'japan', hokkaido: 'hokkaido', tohoku: 'tohoku', kanto: 'kanto', chubu: 'chubu', kansai: 'kansai', chugoku: 'kansai', shikoku: 'kansai', kyushu: 'kyushu' };

// Typical timing, in words, from SITE_CONFIG.seasonalTiming.
const USUAL = {
  sakura: 'Cherry blossom usually opens in Okinawa in January and February, in Kyushu and Kansai in late March, in Kanto in early April, in Tohoku in mid April and in Hokkaido from late April into May.',
  koyo: 'Autumn colour usually peaks in Hokkaido and the mountains in September and October, in Tohoku in October, around Tokyo and Kyoto from mid October through November, and in Kyushu into early December.',
};

const state = { start: '', end: '', region: 'japan', days: [], day: null, data: {}, front: null, fests: [], farms: [], fruitRows: [] };
let map = null;
let mapReady = false;

const dayIso = (day) => dayToDate(day).toISOString().slice(0, 10);
function todayIso() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function addDays(iso, n) { return dayIso(isoToDay(iso) + n); }
const regionName = (id = state.region) => $('region').querySelector(`option[value="${id}"]`)?.textContent ?? id;
const inRegion = (pref) => state.region === 'japan' || pref === 'Nationwide' || regionOfPrefecture(pref) === state.region;
const cityPref = {};
const fmtLong = (day) => { const d = dayToDate(day); return `${WEEKDAY[d.getUTCDay()]} ${fmtDay(day)}`; };

// ---------- data ----------

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function loadAll() {
  const v = encodeURIComponent(app.dataset.version || '');
  const [koyo, sakura, fruit, festivals] = await Promise.allSettled([
    getJson('/api/koyo/forecast'), getJson('/api/sakura/forecast'), getJson(`/api/fruit/seasons?v=${v}`), getJson(`/api/festivals?v=${v}`),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  state.data = { koyoRaw: ok(koyo), sakuraRaw: ok(sakura), fruit: ok(fruit), festivals: ok(festivals) };
  for (const r of state.data.koyoRaw?.regions ?? []) for (const c of r.cities ?? []) cityPref[c.nameEn] = c.prefNameEn;
  for (const r of state.data.sakuraRaw?.regions ?? []) for (const c of r.cities ?? []) cityPref[c.cityName] = c.prefName;
  state.data.koyo = state.data.koyoRaw ? buildKoyoSeason(state.data.koyoRaw, null, 'maple') : null;
  state.data.sakura = state.data.sakuraRaw ? buildSakuraSeason(state.data.sakuraRaw, null) : null;
}

// ---------- compute ----------

function compute() {
  state.days = tripDayList(state.start, state.end);
  if (state.day == null || !state.days.includes(state.day)) state.day = state.days[0];
  const seasons = [state.data.koyo, state.data.sakura].filter((s) => s && s.cities?.length);
  state.front = frontForTrip(seasons, state.days);
  if (state.front.season) state.front.cities = state.front.season.cities.filter((c) => inRegion(cityPref[c.name]));
  app.dataset.season = state.front.kind ?? 'fruit';

  const festivals = state.data.festivals?.spots ?? [];
  state.fests = festivals
    .map((f) => ({ f, occ: occurrencesInRange(f, state.start, state.end)[0] }))
    .filter((x) => x.occ && FESTIVAL_TYPES[x.f.type]);

  const fruit = state.data.fruit;
  const yearDays = tripDaysOfYear(state.start, state.end);
  state.farms = [];
  const byFruit = {};
  for (const farm of fruit?.farms ?? []) {
    if (state.region !== 'japan' && farm.region !== state.region) continue;
    const open = farm.seasons.filter((s) => rangesOverlapDays(s.ranges, yearDays));
    if (!open.length) continue;
    state.farms.push({ farm, open });
    for (const s of open) (byFruit[s.fruit] ||= []).push({ farm, s });
  }
  state.fruitRows = (fruit?.fruits ?? []).filter((f) => byFruit[f.name]).map((f) => ({ fruit: f, list: byFruit[f.name] })).sort((a, b) => b.list.length - a.list.length);
}

// ---------- render: sidebar ----------

function renderFront() {
  const card = $('front-card');
  const fr = state.front;
  const kindWord = fr.kind === 'sakura' ? 'Cherry blossom' : 'Autumn leaves';
  const exploreDay = fr.status === 'forecast' ? Math.min(Math.max(state.day, fr.season.start), fr.season.end) : null;
  if (fr.status === 'none') {
    card.innerHTML = `<h2 class="card-title">Blossom and autumn colour</h2>
      <p>Neither cherry blossom nor autumn colour is on during these dates.</p>
      <p class="muted">${esc(USUAL.sakura)}</p><p class="muted">${esc(USUAL.koyo)}</p>`;
    return;
  }
  if (fr.status === 'not-yet') {
    const year = dayToDate(state.days[0]).getUTCFullYear();
    const last = fr.season.cities.filter((c) => inRegion(cityPref[c.name])).sort((a, b) => a.peak - b.peak);
    const sample = pickSample(last, 4);
    card.innerHTML = `<h2 class="card-title">${kindWord}</h2>
      <p>The ${year} ${fr.kind === 'sakura' ? 'cherry blossom' : 'autumn leaves'} forecast is not out yet, so there are no dates for your trip.</p>
      ${sample.length ? `<p class="muted">Last season${state.region === 'japan' ? '' : ` in ${esc(regionName())}`}: ${sample.map((c) => `${esc(c.name)} ${fr.kind === 'sakura' ? 'full bloom' : 'peaked'} ${esc(fmtDay(c.peak))}`).join(', ')}.</p>` : ''}
      <p class="muted">${esc(USUAL[fr.kind])}</p>`;
    return;
  }
  const cities = fr.cities;
  const words = PHASES[fr.kind].words;
  const colors = PHASES[fr.kind].colors;
  const peaks = peaksDuring(cities, state.days);
  const first = state.days[0];
  const last = state.days[state.days.length - 1];
  const where = state.region === 'japan' ? '' : ` in ${regionName()}`;
  let lead;
  if (!cities.length) lead = `<p>No forecast cities${esc(where)}.</p>`;
  else if (peaks.length) lead = `<p><strong>${peaks.length} of ${cities.length}</strong> forecast cities${esc(where)} reach ${fr.kind === 'sakura' ? 'full bloom' : 'peak colour'} during your trip.</p>`;
  else {
    const counts = phaseCounts(cities, [first])[0];
    const main = counts.indexOf(Math.max(...counts));
    lead = `<p>No forecast city${esc(where)} peaks during your trip. On ${esc(fmtDay(first))} most are <strong>${esc(words[main].toLowerCase())}</strong>.</p>`;
  }
  const rows = (state.region === 'japan' ? (peaks.length ? peaks : nearestToPeak(cities, first)).slice(0, 8) : cities.slice().sort((a, b) => a.peak - b.peak))
    .map((c) => {
      const a = phaseBucket(c.dates, first);
      const b = phaseBucket(c.dates, last);
      const during = a === b ? words[a] : `${words[a]}, ${words[b].toLowerCase()} by ${fmtDay(last)}`;
      return `<tr><th scope="row"><span class="sw" style="background:${colors[phaseBucket(c.dates, state.day)]}"></span>${esc(c.name)}</th><td>${esc(during)}</td><td class="num">${esc(fmtDay(c.peak))}</td></tr>`;
    }).join('');
  const fresh = fr.kind === 'koyo' && state.data.koyoRaw ? koyoForecastFreshness(state.data.koyoRaw.lastUpdated, state.data.koyoRaw.updateSchedule ?? []) : null;
  const issued = fresh?.issued ? `JMC forecast issued ${fmtDay(isoToDay(fresh.issued))}${fresh.nextUpdate ? `, next update ${fresh.nextUpdate.replace(' (planned)', '')}` : ''}.` : 'Forecast from Japan Meteorological Corporation; observed dates replace forecasts once recorded.';
  card.innerHTML = `<h2 class="card-title">${kindWord}</h2>${lead}
    ${rows ? `<div class="table-wrap"><table class="trip-table"><thead><tr><th scope="col">City</th><th scope="col">During your trip</th><th scope="col">${fr.kind === 'sakura' ? 'Full bloom' : 'Peak'}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <p class="links"><a href="/explore?season=${fr.kind}&day=${exploreDay}&region=${EXPLORE_REGION[state.region]}">See the ${fr.kind === 'sakura' ? 'bloom' : 'colour'} front on ${esc(fmtDay(exploreDay))}</a></p>
    <p class="muted small">${esc(issued)} Peak dates are forecasts, about a week either way.</p>`;
}

function nearestToPeak(cities, day) {
  return cities.slice().sort((a, b) => Math.abs(a.peak - day) - Math.abs(b.peak - day));
}
function pickSample(cities, n) {
  if (cities.length <= n) return cities;
  const step = (cities.length - 1) / (n - 1);
  return Array.from({ length: n }, (_v, i) => cities[Math.round(i * step)]);
}

function renderFestivals() {
  const card = $('fest-card');
  const inR = state.fests.filter(({ f }) => inRegion(f.prefecture));
  const elsewhere = state.fests.filter((x) => !inR.includes(x));
  const row = ({ f, occ }) => {
    const t = FESTIVAL_TYPES[f.type];
    const w = whenLine(f, occ.year);
    return `<li><button type="button" class="pick" data-fest="${esc(f.id)}"><span class="sw sq" style="background:${t.color}"></span>
      <span><span class="p-name">${esc(f.name)}</span><span class="p-sub">${esc(w.date)} · ${esc(f.place)}</span><span class="p-sub">${esc(f.summary)}</span></span>
      <span class="p-count">${esc(t.label)}</span></button></li>`;
  };
  const where = state.region === 'japan' ? '' : ` in ${regionName()}`;
  let html = `<h2 class="card-title">Festivals on</h2>`;
  if (inR.length) html += `<ul class="pick-list">${inR.map(row).join('')}</ul>`;
  else html += `<p>None of the ${nf.format(state.data.festivals?.spots?.length ?? 0)} festivals in our calendar fall on these dates${esc(where)}.</p>`;
  if (elsewhere.length) html += `<details class="more"><summary>${elsewhere.length} elsewhere in Japan</summary><ul class="pick-list">${elsewhere.map(row).join('')}</ul></details>`;
  html += `<p class="links"><a href="/festivals?year=${state.start.slice(0, 4)}&day=${dayOfYearIso(state.start)}">Festival calendar for these dates</a></p>`;
  html += `<p class="muted small">Dates marked "usually" or "probably" can move; check the official site.</p>`;
  card.innerHTML = html;
}

function dayOfYearIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.min(365, Math.floor((d - start) / 86400000) + 1);
}

function renderFruit() {
  const card = $('fruit-card');
  const where = state.region === 'japan' ? '' : ` in ${regionName()}`;
  if (!state.data.fruit) { card.innerHTML = '<h2 class="card-title">Fruit picking</h2><p class="empty">The farm list did not load.</p>'; return; }
  if (!state.fruitRows.length) {
    card.innerHTML = `<h2 class="card-title">Fruit picking</h2><p>No farms${esc(where)} are open for picking on these dates.</p>`;
    return;
  }
  const rows = state.fruitRows.map(({ fruit, list }) => {
    const own = list.filter((x) => x.s.source === 'farm');
    const examples = (own.length ? own : list).slice(0, 2).map(({ farm, s }) => `${esc(farm.name)} <span class="muted">(${esc(farm.pref)}, ${esc(s.ranges.map(rangeLabel).join(' and '))})</span>`).join('; ');
    return `<li class="fruit-row"><span class="sw" style="background:${FRUIT_COLORS[fruit.name]}"></span>
      <span><a href="/fruit/${fruit.slug}?from=${state.start}&to=${state.end}${state.region !== 'japan' ? `&region=${state.region}` : ''}"><strong>${esc(fruit.label)}</strong></a> <span class="muted">${nf.format(list.length)} farm${list.length === 1 ? '' : 's'}${own.length ? `, ${nf.format(own.length)} with ${own.length === 1 ? "its" : "their"} own dates` : ''}</span>
      <span class="p-sub">${examples}</span></span></li>`;
  }).join('');
  card.innerHTML = `<h2 class="card-title">Fruit picking</h2>
    <p>${nf.format(state.farms.length)} farms${esc(where)} open for ${state.fruitRows.length} fruit${state.fruitRows.length === 1 ? '' : 's'}.</p>
    <ul class="fruit-list">${rows}</ul>
    <p class="links"><a href="/fruit?from=${state.start}&to=${state.end}${state.region !== 'japan' ? `&region=${state.region}` : ''}">All open farms on the fruit map</a></p>
    <p class="muted small">Seasons are the farm's own dates where it lists them, otherwise estimates. Check with the farm.</p>`;
}

function renderSources() {
  $('sources').innerHTML = `
    <p><strong>Blossom and leaves.</strong> City forecasts from <a href="https://n-kishou.com/" target="_blank" rel="noopener">Japan Meteorological Corporation</a>, with observed dates where recorded. Phases follow the same rules as the <a href="/explore">bloom front</a>.</p>
    <p><strong>Festivals.</strong> Japan in Seasons' calendar of ${nf.format(state.data.festivals?.spots?.length ?? 0)} major festivals, with each year's date worked out from its usual pattern.</p>
    <p><strong>Fruit.</strong> ${nf.format(state.data.fruit?.farms?.length ?? 0)} farms listed on Jalan. Seasons come from each farm's listing where given, otherwise from nearby listings or the typical season.</p>`;
}

// ---------- render: trip strip ----------

function renderStrip() {
  const grid = $('trip-grid');
  const days = state.days;
  const n = days.length;
  $('trip-title').textContent = n ? `${fmtDay(days[0], true)}${n > 1 ? ` to ${fmtDay(days[n - 1], true)}` : ''}` : 'Your trip';
  $('trip-note').textContent = n ? `${n} day${n === 1 ? '' : 's'}${state.region === 'japan' ? ', all Japan' : `, ${regionName()}`}` : '';
  const cols = `grid-template-columns: var(--rail, 168px) repeat(${n}, minmax(0, 1fr))`;
  const fr = state.front;
  const head = days.map((d) => {
    const dt = dayToDate(d);
    return `<button type="button" class="day-head${d === state.day ? ' on' : ''}" data-day="${d}" aria-pressed="${d === state.day}" aria-label="${esc(fmtLong(d))}"><span>${WEEKDAY[dt.getUTCDay()].slice(0, n > 14 ? 1 : 3)}</span><b>${dt.getUTCDate()}</b></button>`;
  }).join('');
  let frontRow = '';
  if (fr.status === 'forecast' && fr.cities.length) {
    const counts = phaseCounts(fr.cities, days);
    const colors = PHASES[fr.kind].colors;
    const words = PHASES[fr.kind].words;
    frontRow = `<div class="row-label">${fr.kind === 'sakura' ? 'Blossom' : 'Leaves'}</div>` + counts.map((c, i) => {
      const total = c.reduce((a, b) => a + b, 0) || 1;
      const segs = c.map((k, p) => (k ? `<i style="height:${(k / total) * 100}%;background:${colors[p]}"></i>` : '')).reverse().join('');
      const label = `${fmtLong(days[i])}: ${c.map((k, p) => (k ? `${k} ${words[p].toLowerCase()}` : '')).filter(Boolean).join(', ')}`;
      return `<div class="cell stack${days[i] === state.day ? ' on' : ''}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${segs}</div>`;
    }).join('');
  }
  const festRow = `<div class="row-label">Festivals</div>` + days.map((d) => {
    const iso = dayIso(d);
    const on = state.fests.filter(({ f, occ }) => inRegion(f.prefecture) && f.when?.type !== 'several' && occurrenceCovers(f, occ, iso));
    const label = on.length ? `${fmtLong(d)}: ${on.map(({ f }) => f.name).join(', ')}` : `${fmtLong(d)}: none`;
    return `<div class="cell marks${d === state.day ? ' on' : ''}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${on.slice(0, 4).map(({ f }) => `<i class="sq" style="background:${FESTIVAL_TYPES[f.type].color}"></i>`).join('')}${on.length > 4 ? `<em>+${on.length - 4}</em>` : ''}</div>`;
  }).join('');
  const fruitRow = `<div class="row-label">Fruit</div>` + days.map((d) => {
    const yd = tripDaysOfYear(dayIso(d), dayIso(d));
    const fruits = state.fruitRows.filter(({ list }) => list.some(({ s }) => rangesOverlapDays(s.ranges, yd)));
    const label = `${fmtLong(d)}: ${fruits.map(({ fruit, list }) => `${fruit.label} (${list.length})`).join(', ') || 'none'}`;
    return `<div class="cell ticks${d === state.day ? ' on' : ''}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${fruits.slice(0, 6).map(({ fruit }) => `<i style="background:${FRUIT_COLORS[fruit.name]}"></i>`).join('')}</div>`;
  }).join('');
  grid.innerHTML = `<div class="trip-rows" style="${cols}"><div class="row-label"></div>${head}${frontRow}${festRow}${fruitRow}</div>`;
}

// ---------- map ----------

function initMap() {
  map = createMap('map', { attribution: 'Forecasts: <a href="https://n-kishou.com/" target="_blank" rel="noopener">JMC</a> · Farms: <a href="https://www.jalan.net/kankou/" target="_blank" rel="noopener">Jalan</a>' });
  map.on('load', () => {
    for (const [type, t] of Object.entries(FESTIVAL_TYPES)) {
      map.addImage(`sq-${type}`, square(t.color, true), { pixelRatio: 2 });
      map.addImage(`sq-${type}-soon`, square(t.color, false), { pixelRatio: 2 });
    }
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('farms', { type: 'geojson', data: empty });
    map.addSource('cities', { type: 'geojson', data: empty });
    map.addSource('fests', { type: 'geojson', data: empty });
    const own = ['==', ['get', 'own'], 1];
    map.addLayer({
      id: 'farms', type: 'circle', source: 'farms',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.4, 8, 4, 11, 6],
        'circle-color': ['case', own, ['get', 'color'], '#fffcf7'],
        'circle-stroke-color': ['case', own, '#fffcf7', ['get', 'color']],
        'circle-stroke-width': ['case', own, 0.8, 1.6],
      },
    });
    map.addLayer({
      id: 'cities', type: 'circle', source: 'cities',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 9], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fffcf7', 'circle-stroke-width': 2 },
    });
    map.addLayer({
      id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 5,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9, 'text-optional': true },
      paint: { 'text-color': '#1f1c18', 'text-halo-color': '#fffcf7', 'text-halo-width': 1.6 },
    });
    map.addLayer({
      id: 'fests', type: 'symbol', source: 'fests',
      layout: {
        'icon-image': ['case', ['==', ['get', 'on'], 1], ['concat', 'sq-', ['get', 'type']], ['concat', 'sq-', ['get', 'type'], '-soon']],
        'icon-size': ['case', ['==', ['get', 'on'], 1], 1.15, 0.85], 'icon-allow-overlap': true,
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12.5, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-optional': true,
      },
      paint: { 'text-color': '#1f1c18', 'text-halo-color': '#fffcf7', 'text-halo-width': 1.6 },
    });
    mapReady = true;
    $('map-status').textContent = '';
    updateMap(true);
  });
  map.on('error', (e) => console.warn('Map tile error', e?.error?.message || e));
  const tip = $('tip');
  for (const layer of ['farms', 'cities', 'fests']) {
    map.on('mousemove', layer, (e) => {
      const p = e.features[0].properties;
      map.getCanvas().style.cursor = 'pointer';
      tip.innerHTML = `<b>${esc(p.name)}</b><br><span class="sub">${esc(p.sub)}</span>`;
      tip.hidden = false;
      const { width, height } = map.getContainer().getBoundingClientRect();
      tip.style.left = `${Math.min(e.point.x + 14, width - 270)}px`;
      tip.style.top = `${Math.min(e.point.y + 14, height - 60)}px`;
    });
    map.on('mouseleave', layer, () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
  }
  map.on('click', 'farms', (e) => { const url = e.features[0].properties.url; if (url) window.open(url, '_blank', 'noopener'); });
  map.on('click', 'fests', (e) => focusFestival(e.features[0].properties.id));
}

function square(color, filled) {
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

function updateMap(fit = false) {
  if (!mapReady) return;
  const iso = dayIso(state.day);
  map.getSource('farms').setData({
    type: 'FeatureCollection',
    features: state.farms.map(({ farm, open }) => {
      const first = open[0];
      const fruitLabel = (name) => state.data.fruit.fruits.find((f) => f.name === name)?.label ?? name;
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [farm.lon, farm.lat] }, properties: { name: farm.name, sub: `${farm.pref} · ${open.map((s) => fruitLabel(s.fruit)).join(', ')}`, color: FRUIT_COLORS[first.fruit] ?? '#5a534b', own: open.some((s) => s.source === 'farm') ? 1 : 0, url: farm.url } };
    }),
  });
  const fr = state.front;
  const words = fr.kind ? PHASES[fr.kind].words : [];
  map.getSource('cities').setData({
    type: 'FeatureCollection',
    features: fr.status === 'forecast' ? fr.cities.map((c) => {
      const b = phaseBucket(c.dates, state.day);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { name: c.name, label: b === 3 ? `${c.name}, ${words[b].toLowerCase()}` : c.name, sub: `${words[b]} on ${fmtDay(state.day)} · ${fr.kind === 'sakura' ? 'full bloom' : 'peak'} ${fmtDay(c.peak)}`, color: PHASES[fr.kind].colors[b] } };
    }) : [],
  });
  map.getSource('fests').setData({
    type: 'FeatureCollection',
    features: state.fests.filter(({ f }) => f.prefecture !== 'Nationwide').map(({ f, occ }) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: { id: f.id, type: f.type, name: f.name, on: f.when?.type !== 'several' && occurrenceCovers(f, occ, iso) ? 1 : 0, sub: `${whenLine(f, occ.year).date} · ${f.place}` },
    })),
  });
  if (fit) fitRegion(map, state.region, { reducedMotion });
  renderLegend();
}

function renderLegend() {
  const el = $('legend');
  const fr = state.front;
  const parts = [];
  if (fr.status === 'forecast') {
    const used = new Set(fr.cities.map((c) => phaseBucket(c.dates, state.day)));
    parts.push(`<div class="lg-title">${fr.kind === 'sakura' ? 'Cherry blossom' : 'Autumn leaves'} on ${esc(fmtDay(state.day))}</div><ul>${PHASES[fr.kind].words.map((w, i) => (used.has(i) ? `<li><span class="sw" style="background:${PHASES[fr.kind].colors[i]}"></span>${esc(w)}</li>` : '')).join('')}</ul>`);
  }
  const fruits = state.fruitRows.slice(0, 6);
  if (fruits.length) parts.push(`<div class="lg-title" style="margin-top:6px">Farms open</div><ul>${fruits.map(({ fruit }) => `<li><span class="sw" style="background:${FRUIT_COLORS[fruit.name]}"></span>${esc(fruit.label)}</li>`).join('')}</ul>`);
  if (state.fests.length) parts.push(`<div class="lg-note"><span><span class="sw sq" style="background:var(--text-2)"></span>Festival on this day</span><span><span class="sw sq ring" style="color:var(--text-2)"></span>Festival during your trip</span></div>`);
  el.innerHTML = parts.join('');
  el.hidden = !parts.length;
}

function focusFestival(id) {
  const x = state.fests.find(({ f }) => f.id === id);
  if (!x) return;
  const start = isoToDay(x.occ.start);
  if (state.days.includes(start)) setDay(start);
  if (mapReady) map.flyTo({ center: [x.f.lon, x.f.lat], zoom: Math.max(map.getZoom(), 7), duration: reducedMotion ? 0 : 900 });
}

function setDay(day) {
  state.day = day;
  renderStrip();
  renderFront();
  updateMap();
}

// ---------- controls ----------

function readUrl() {
  const p = new URLSearchParams(location.search);
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const t = todayIso();
  state.start = valid(p.get('from')) ? p.get('from') : t;
  state.end = valid(p.get('to')) ? p.get('to') : addDays(state.start, 6);
  const r = p.get('region');
  if (r && REGION_BOUNDS[r]) state.region = r;
  $('date-from').value = state.start;
  $('date-to').value = state.end;
  $('region').value = state.region;
}

function writeUrl() {
  const p = new URLSearchParams({ from: state.start, to: state.end });
  if (state.region !== 'japan') p.set('region', state.region);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

function validate(start, end) {
  if (!start || !end) return 'Pick both dates.';
  if (end < start) return 'The end date is before the start date.';
  if (isoToDay(end) - isoToDay(start) + 1 > MAX_TRIP_DAYS) return `Pick up to ${MAX_TRIP_DAYS} days.`;
  return null;
}

function apply({ fit = true } = {}) {
  compute();
  renderStrip();
  renderFront();
  renderFestivals();
  renderFruit();
  updateMap(fit);
  writeUrl();
}

function wire() {
  $('trip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = $('date-from').value;
    const end = $('date-to').value;
    const err = validate(start, end);
    $('dates-error').hidden = !err;
    $('dates-error').textContent = err ?? '';
    if (err) return;
    state.start = start; state.end = end; state.region = $('region').value; state.day = null;
    apply();
  });
  $('region').addEventListener('change', () => { state.region = $('region').value; apply(); });
  $('trip-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) setDay(Number(b.dataset.day));
  });
  $('fest-card').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fest]');
    if (b) focusFestival(b.dataset.fest);
  });
}

async function start() {
  wire();
  readUrl();
  const err = validate(state.start, state.end);
  if (err) { state.end = addDays(state.start, 6); $('date-to').value = state.end; }
  await loadAll();
  if (!state.data.fruit && !state.data.festivals && !state.data.koyo && !state.data.sakura) {
    $('map-status').innerHTML = 'Nothing loaded. Check your connection.<br><button type="button" class="btn" id="retry">Try again</button>';
    $('retry').addEventListener('click', () => location.reload());
    return;
  }
  renderSources();
  apply({ fit: false });
  if (hasWebGL) initMap();
  else $('map-status').textContent = 'This browser cannot draw the map. Everything else on the page still works.';
}

start();
