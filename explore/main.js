import * as maplibregl from 'maplibre-gl';
import {
  buildKoyoSeason, buildSakuraSeason, cityHistory, defaultDay, doyToDay, fmtDay, fmtDiff, fmtDoy, frontAt, phaseLabel, seasonSeries, todayDay,
} from './data.js';
import HISTORY from './season-history.json';
import { buildField, contour, corners, gridShape, meanLatitude, paintField, RAMPS, rampColor, sampleField } from './field.js';
import { TreeLayer, placeTrees } from './trees.js';
import { bloomChart, historyChart, speedChart } from './charts.js';
import { drawStaticMap } from './static-map.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasWebGL2 = (() => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
})();

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SEA = '#c3cdcb';
// The colour field is repainted on the CPU every frame of playback; phones get a coarser grid.
const FIELD_WIDTH = matchMedia('(max-width: 768px)').matches ? 460 : 680;
const DAYS_PER_SECOND = 3;
const TIER1 = new Set(['Naha', 'Kagoshima', 'Fukuoka', 'Hiroshima', 'Osaka', 'Tokyo', 'Niigata', 'Sendai', 'Aomori', 'Sapporo']);
const TIER2 = new Set(['Ishigaki', 'Naze', 'Miyakojima', 'Minamidaito', 'Kochi', 'Kyoto', 'Nagoya', 'Kanazawa', 'Akita', 'Hakodate', 'Kushiro', 'Asahikawa', 'Matsue', 'Shizuoka']);
// The All Japan view turns the archipelago so it runs across the screen, Okinawa on the left
// and Hokkaido on the right, and tilts it so the mountains read. Portrait screens look up it instead.
const JAPAN_EXTENT = [[123.6, 24.0], [146.0, 45.6]];
function japanCamera() {
  const el = map.getContainer();
  const landscape = el.clientWidth >= el.clientHeight;
  const bearing = landscape ? -52 : 32;
  const pitch = landscape ? 62 : 58;
  if (landscape) {
    // cameraForBounds ignores pitch, so the landscape view is fixed and scaled to the map width.
    return { center: [135.6, 34.2], zoom: 4.8 + Math.log2(el.clientWidth / 1128), bearing, pitch };
  }
  const cam = map.cameraForBounds(JAPAN_EXTENT, { bearing, pitch, padding: { top: 90, bottom: 110, left: 24, right: 24 } });
  return cam ? { center: cam.center, zoom: cam.zoom + 0.1, bearing, pitch } : null;
}
const REGIONS = {
  japan: [[128.8, 30.9], [145.9, 45.5]],
  okinawa: [[123.6, 24.0], [131.6, 28.6]],
  kyushu: [[129.4, 31.0], [132.1, 34.0]],
  kansai: [[132.4, 32.9], [136.6, 35.8]],
  chubu: [[135.8, 34.5], [139.3, 37.7]],
  kanto: [[138.2, 34.8], [141.0, 37.2]],
  tohoku: [[139.3, 37.0], [142.1, 41.6]],
  hokkaido: [[139.6, 41.3], [145.8, 45.5]],
};
const COPY = {
  sakura: {
    intro: 'Watch the bloom move north. Drag the date.',
    inBloom: 'in bloom', c1: 'Cities in bloom', c2: 'km per day northward',
    front: 'First bloom', peak: 'Full bloom', wash: 'Cherry blossom', line: 'Bloom front today',
    history: 'first bloom', table: 'sakuraBloom',
    legend: ['Buds', 'Opening', 'Full bloom', 'In leaf'],
  },
  koyo: {
    intro: 'Watch the colour move south. Drag the date.',
    inBloom: 'in colour', c1: 'Cities in colour', c2: 'km per day southward',
    front: 'Colour starts', peak: 'Peak colour', wash: 'Autumn colour', line: 'Colour front today',
    history: 'maple colour', table: 'mapleColour',
    legend: ['Green', 'Turning', 'Peak', 'Bare'],
  },
};

const state = {
  kind: 'sakura', season: null, field: null, day: 0, playing: false, speed: 1,
  dim: reducedMotion ? '2d' : '3d', exag: 1.5, region: 'japan', hoverLock: null,
  historyCity: 'Tokyo', historyKyoto: false,
  cache: {}, layers: { relief: 1, hillshade: 0.8, wash: 1, front: 1, trees: 1, deviation: 0 },
};
let map = null;
let trees = null;
let charts = {};
let series = [];
let speeds = [];
const washCanvas = document.createElement('canvas');
let washCtx = null;
let washImage = null;
let markers = [];
let styleReady = false;

// ---------- data ----------

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function loadSeason(kind) {
  if (state.cache[kind]) return state.cache[kind];
  const base = kind === 'sakura' ? '/api/sakura' : '/api/koyo';
  const [forecast, spots] = await Promise.all([
    getJson(`${base}/forecast`),
    getJson(`${base}/all-spots`).catch(() => ({ spots: [] })),
  ]);
  const season = kind === 'sakura' ? buildSakuraSeason(forecast, spots, HISTORY) : buildKoyoSeason(forecast, spots);
  if (!season.cities.length) throw new Error('The forecast has no city dates yet.');
  const points = season.spots.concat(season.cities);
  const field = buildField(points, FIELD_WIDTH);
  state.cache[kind] = { season, field };
  return state.cache[kind];
}

function frontSpeeds(season, field) {
  const lats = [];
  for (let d = season.start; d <= season.end; d++) lats.push(meanLatitude(contour(field, d, 4)));
  const sign = season.kind === 'sakura' ? 1 : -1;
  const out = [];
  for (let i = 0; i < lats.length; i++) {
    const a = lats[i - 3];
    const b = lats[i + 3];
    out.push({ day: season.start + i, kmPerDay: a != null && b != null ? ((b - a) / 6) * 111 * sign : NaN });
  }
  // Light smoothing; the isochrone mean jumps when a new island joins the line.
  return out.map((s, i) => {
    const win = out.slice(Math.max(0, i - 3), i + 4).map((o) => o.kmPerDay).filter(Number.isFinite);
    return { day: s.day, kmPerDay: Number.isFinite(s.kmPerDay) && win.length ? win.reduce((x, y) => x + y, 0) / win.length : NaN };
  });
}

// ---------- map ----------

function mapStyle() {
  const dem = { type: 'raster-dem', tiles: [TERRAIN_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 12 };
  return {
    version: 8,
    sources: {
      'dem-terrain': dem,
      'dem-shade': { ...dem },
      wash: { type: 'canvas', canvas: washCanvas, coordinates: corners(), animate: false },
      front: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      iso: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      deviation: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'sea-bg', type: 'background', paint: { 'background-color': SEA } },
      {
        id: 'relief', type: 'color-relief', source: 'dem-shade',
        paint: {
          'color-relief-color': ['interpolate', ['linear'], ['elevation'],
            -9000, SEA, -1, SEA, 0, '#ebe4d3', 150, '#e4dac3', 500, '#d8caa8', 1000, '#c6b591', 1800, '#ad9c7e', 2600, '#988a75', 3200, '#efebe4'],
        },
      },
      {
        id: 'hillshade', type: 'hillshade', source: 'dem-shade',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#5a4632',
          'hillshade-highlight-color': '#fffaf0',
          'hillshade-accent-color': '#6d5b45',
          'hillshade-illumination-direction': 315,
        },
      },
      { id: 'wash', type: 'raster', source: 'wash', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
      {
        id: 'sea-mask', type: 'color-relief', source: 'dem-shade',
        paint: { 'color-relief-color': ['interpolate', ['linear'], ['elevation'], -9000, SEA, -2, SEA, 0.5, 'rgba(195,205,203,0)'] },
      },
      { id: 'iso', type: 'line', source: 'iso', paint: { 'line-color': '#4c453c', 'line-width': 0.8, 'line-opacity': 0.4, 'line-dasharray': [2, 2] } },
      { id: 'front-glow', type: 'line', source: 'front', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff6e6', 'line-width': 9, 'line-blur': 5, 'line-opacity': 0.85 } },
      { id: 'front', type: 'line', source: 'front', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#b8245c', 'line-width': 2.4 } },
      {
        id: 'deviation', type: 'circle', source: 'deviation', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 9, 14],
          'circle-color': ['interpolate', ['linear'], ['get', 'diff'], -12, '#1f6f8b', -4, '#7fb3c4', 0, '#f4f0e8', 4, '#e3a36b', 12, '#a14a14'],
          'circle-stroke-color': '#2a2622', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map',
        },
      },
    ],
    sky: {
      'sky-color': '#d9e0e2', 'horizon-color': '#efe7da', 'fog-color': '#ece6db',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0,
    },
  };
}

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: mapStyle(),
    bounds: REGIONS.japan,
    fitBoundsOptions: { padding: 30 },
    minZoom: 3.8,
    maxZoom: 11.5,
    maxPitch: 75,
    maxBounds: [[108, 14], [166, 56]],
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    attributionControl: { compact: true, customAttribution: 'Forecasts: <a href="https://n-kishou.com/" target="_blank" rel="noopener">JMC</a>, JMA · Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>' },
    canvasContextAttributes: { antialias: true },
    fadeDuration: 0,
  });
  map.keyboard.disable();
  trees = new TreeLayer();
  map.on('load', () => {
    styleReady = true;
    map.addLayer(trees);
    applyDim(state.dim, false);
    applyLayers();
    fitRegion(state.region, false);
    if (state.season) onSeasonReady();
  });
  let idleTimer = 0;
  map.on('idle', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { trees.refreshElevation(); updateFarLabels(); }, 30);
  });
  map.on('move', () => {
    updateTreeSize();
    updateExaggeration();
    $('compass').querySelector('svg').style.transform = `rotate(${-map.getBearing()}deg)`;
  });
  let farQueued = false;
  map.on('move', () => {
    if (farQueued) return;
    farQueued = true;
    requestAnimationFrame(() => { farQueued = false; updateFarLabels(); });
  });
  map.on('moveend', updateScale);
  map.on('zoomend', updateMarkerLabels);
  map.on('mousemove', (e) => onHover(e.point, e.lngLat));
  map.on('mouseout', () => clearHover());
  map.on('click', (e) => onHover(e.point, e.lngLat, true));
  map.on('error', (e) => {
    // Missing terrain tiles at the map edge are harmless; anything else is worth a log.
    if (!String(e?.error?.message || '').includes('elevation-tiles')) console.warn(e.error);
  });
}

function updateTreeSize() {
  const c = map.getCenter();
  const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  // Trees stay a readable size on screen: small glyphs nationally, groves up close.
  const k = 5 + 8 * Math.min(1, Math.max(0, (map.getZoom() - 5.5) / 4));
  trees.size = Math.min(30000, Math.max(60, mpp * k));
}

// Mountains need more lift to read at national scale; ease back to the chosen value close up.
function zoomExaggeration() {
  const z = map.getZoom();
  const t = Math.min(1, Math.max(0, (z - 5) / 5));
  return state.exag * (10 - 9 * t * t * (3 - 2 * t));
}

let lastExag = 0;
function updateExaggeration() {
  if (!map?.terrain || state.dim !== '3d') return;
  const e = zoomExaggeration();
  if (Math.abs(e - lastExag) < 0.02) return;
  lastExag = e;
  map.terrain.exaggeration = e;
}

function updateScale() {
  const y = map.getContainer().clientHeight - 20;
  const a = map.unproject([20, y]);
  const b = map.unproject([120, y]);
  const km = a.distanceTo(b) / 1000;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((v) => v >= km * 0.6) || 500;
  $('sb-bar').style.width = `${(nice / km) * 100}px`;
  $('sb-label').textContent = `${nice} km`;
}

function fitRegion(region, animate = true) {
  state.region = region;
  const three = state.dim === '3d';
  if (region === 'japan' && three) {
    const cam = japanCamera();
    if (!cam) return;
    if (animate && !reducedMotion) map.flyTo({ ...cam, duration: 1600, essential: false });
    else map.jumpTo(cam);
    return;
  }
  const pitch = three ? (region === 'japan' ? 42 : 55) : 0;
  const bearing = three ? (region === 'japan' ? 12 : 0) : 0;
  const cam = map.cameraForBounds(REGIONS[region], { padding: 24, pitch, bearing });
  if (!cam) return;
  const opts = { center: cam.center, zoom: cam.zoom, pitch, bearing };
  if (animate && !reducedMotion) map.flyTo({ ...opts, duration: 1600, essential: false });
  else map.jumpTo(opts);
}

function applyDim(dim, animate = true) {
  state.dim = dim;
  document.querySelectorAll('.dim-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dim === dim)));
  $('exag').disabled = dim !== '3d';
  if (!styleReady) return;
  lastExag = 0;
  if (dim === '3d') {
    map.setTerrain({ source: 'dem-terrain', exaggeration: zoomExaggeration() });
    updateExaggeration();
  } else map.setTerrain(null);
  const pitch = dim === '3d' ? (map.getZoom() < 6 ? 62 : 55) : 0;
  map.easeTo({ pitch, bearing: dim === '3d' ? map.getBearing() : 0, duration: animate && !reducedMotion ? 700 : 0 });
  trees.refreshElevation();
}

function applyLayers() {
  if (!styleReady) return;
  const L = state.layers;
  const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('relief', L.relief > 0);
  map.setPaintProperty('relief', 'color-relief-opacity', L.relief);
  vis('hillshade', L.hillshade > 0);
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.7 * L.hillshade);
  vis('wash', L.wash > 0);
  map.setPaintProperty('wash', 'raster-opacity', L.wash);
  for (const id of ['front', 'front-glow', 'iso']) vis(id, L.front > 0);
  map.setPaintProperty('front', 'line-opacity', L.front);
  map.setPaintProperty('front-glow', 'line-opacity', 0.85 * L.front);
  map.setPaintProperty('iso', 'line-opacity', 0.4 * L.front);
  vis('deviation', L.deviation > 0);
  trees.visible = L.trees > 0;
  map.triggerRepaint();
  renderLegend();
}

// ---------- season ----------

async function setSeason(kind) {
  state.kind = kind;
  app.dataset.season = kind;
  document.querySelectorAll('.season-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === kind)));
  const c = COPY[kind];
  $('intro').textContent = c.intro;
  $('c1-title').textContent = c.c1;
  $('c2-sub').textContent = c.c2;
  setStatus('Loading forecast data…');
  pause();
  try {
    const { season, field } = await loadSeason(kind);
    if (state.kind !== kind) return;
    state.season = season;
    state.field = field;
    setStatus('');
    if (!hasWebGL2) { onSeasonReady(); return; }
    if (styleReady) onSeasonReady();
  } catch (err) {
    console.error(err);
    setStatus(`Could not load the forecast. ${err.message} Try again in a minute.`, true);
  }
}

function onSeasonReady() {
  const { season, field } = state;
  const kind = season.kind;
  const { width, height } = gridShape(FIELD_WIDTH);
  washCanvas.width = width;
  washCanvas.height = height;
  washCtx = washCanvas.getContext('2d');
  washImage = washCtx.createImageData(width, height);
  series = seasonSeries(season);
  speeds = frontSpeeds(season, field);

  const input = $('tl-range-input');
  input.min = season.start;
  input.max = season.end;
  $('tl-range').textContent = `${fmtDay(season.start)} to ${fmtDay(season.end, true)}`;
  renderAxis();
  renderEvents();
  renderCityTable();
  renderLayersPanel();
  renderLegend();

  if (map) {
    map.setPaintProperty('front', 'line-color', kind === 'sakura' ? '#b8245c' : '#9a3412');
    const iso = [];
    for (let d = Math.ceil(season.start / 7) * 7; d <= season.end; d += 7) {
      for (const line of contour(field, d, 3)) iso.push({ type: 'Feature', properties: { day: d }, geometry: { type: 'LineString', coordinates: line } });
    }
    map.getSource('iso').setData({ type: 'FeatureCollection', features: iso });
    map.getSource('deviation').setData({
      type: 'FeatureCollection',
      features: season.cities.filter((c) => Number.isFinite(c.diff)).map((c) => ({ type: 'Feature', properties: { diff: c.diff, name: c.name }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })),
    });
    // Groves stand on forecast spots, plus JMA cities that have no spots nearby (Okinawa, Amami).
    const grovePoints = season.spots.concat(season.cities.filter((c) => c.jmaOnly));
    trees.setTrees(placeTrees(grovePoints, 7), grovePoints, kind, season.start);
    buildMarkers();
    updateTreeSize();
    updateScale();
  }

  charts.bloom = bloomChart($('chart-bloom'), series, season, COPY[kind], (d) => setDay(d));
  charts.speed = speedChart($('chart-speed'), speeds, season, (d) => setDay(d));
  renderHistory();
  $('c1-sub').textContent = `of ${season.cities.length} forecast cities`;

  const params = new URLSearchParams(location.search);
  const want = Number(params.get('day'));
  state.day = Number.isFinite(want) && want >= season.start && want <= season.end && params.get('season') === kind ? want : defaultDay(season, todayDay());
  setDay(state.day, true);
  if (!hasWebGL2) {
    $('static-map').hidden = false;
    $('map').hidden = true;
  }
}

// ---------- day ----------

let paintQueued = false;
function setDay(day, force = false) {
  const s = state.season;
  if (!s) return;
  const d = Math.min(s.end, Math.max(s.start, day));
  if (!force && Math.abs(d - state.day) < 1e-3) return;
  state.day = d;
  const input = $('tl-range-input');
  input.value = d;
  input.style.setProperty('--p', `${((d - s.start) / (s.end - s.start)) * 100}%`);
  input.setAttribute('aria-valuetext', fmtDay(d, true));
  const f = frontAt(s, d);
  $('tl-date').textContent = fmtDay(d, true);
  $('tl-sub').textContent = f.reached === 0
    ? (s.kind === 'sakura' ? 'No city has bloomed yet' : 'No city has started to colour yet')
    : `${f.opening + f.peak} of ${f.total} cities ${COPY[s.kind].inBloom}`;
  for (const c of Object.values(charts)) c.setCursor(d);
  // Text panels change once per whole day, so playback does not rebuild them every frame.
  const whole = Math.floor(d);
  if (force || whole !== setDay.lastWhole) {
    setDay.lastWhole = whole;
    renderOverview(f);
    updateMarkers(d);
    document.querySelectorAll('.event-list button').forEach((b) => b.classList.toggle('past', Number(b.dataset.day) < d));
    if (!state.hoverLock) showAt(f.nearest ? { type: 'city', item: f.nearest } : null);
    else showAt(state.hoverLock);
  }
  if (!paintQueued) {
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paintDay(); });
  }
}

let washPauseTimer = 0;
function paintDay() {
  const s = state.season;
  const d = state.day;
  paintField(state.field, s.kind, d, washImage, 1);
  washCtx.putImageData(washImage, 0, 0);
  if (!hasWebGL2) { drawStaticMap($('static-map'), washCanvas, s, d); return; }
  if (!styleReady) return;
  const src = map.getSource('wash');
  src.play();
  clearTimeout(washPauseTimer);
  washPauseTimer = setTimeout(() => src.pause(), 120);
  const lines = contour(state.field, d, 2);
  map.getSource('front').setData({ type: 'FeatureCollection', features: lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })) });
  trees.day = d;
  map.triggerRepaint();
}

// ---------- playback ----------

let lastT = 0;
function tick(t) {
  if (!state.playing) return;
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  const next = state.day + dt * DAYS_PER_SECOND * state.speed;
  if (next >= state.season.end) { setDay(state.season.end); pause(); return; }
  setDay(next);
  requestAnimationFrame(tick);
}

function play() {
  if (!state.season) return;
  if (state.day >= state.season.end - 0.5) setDay(state.season.start);
  state.playing = true;
  lastT = 0;
  $('btn-play').setAttribute('aria-pressed', 'true');
  $('btn-play').setAttribute('aria-label', 'Pause');
  requestAnimationFrame(tick);
}

function pause() {
  state.playing = false;
  $('btn-play').setAttribute('aria-pressed', 'false');
  $('btn-play').setAttribute('aria-label', 'Play');
  if (state.season) setDay(Math.round(state.day), true);
}

function stepToNextEvent() {
  const s = state.season;
  if (!s) return;
  const next = s.events.find((e) => e.day > state.day + 0.5);
  setDay(next ? next.day : s.start);
}

// ---------- markers ----------

function buildMarkers() {
  for (const m of markers) m.marker.remove();
  markers = state.season.cities.map((c) => {
    const el = document.createElement('div');
    el.className = 'wp';
    const date = state.kind === 'sakura' ? c.front : c.peak;
    el.innerHTML = `<span class="wp-dot"></span><span class="wp-label">${c.name}<span class="d">${fmtDay(date)}</span></span>`;
    el.addEventListener('mouseenter', () => { state.hoverLock = { type: 'city', item: c }; showAt(state.hoverLock); });
    el.addEventListener('mouseleave', () => { state.hoverLock = null; });
    el.addEventListener('click', (ev) => { ev.stopPropagation(); state.hoverLock = { type: 'city', item: c }; setDay(c.front); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-9, 0], opacityWhenCovered: '1' }).setLngLat([c.lon, c.lat]).addTo(map);
    return { city: c, el, marker };
  });
  updateMarkerLabels();
  updateFarLabels();
}

function updateMarkerLabels() {
  const z = map.getZoom();
  for (const m of markers) {
    const n = m.city.name;
    m.el.classList.toggle('minor', z < 6.4 && !(TIER1.has(n) || (z >= 5.6 && TIER2.has(n))));
  }
  updateFarLabels();
}

// Labels crowd near the horizon on a tilted map; hide the far ones, then drop any label that
// would overlap a more important one (bigger cities first, then south to north). Boxes come
// from the rendered markers, which already include terrain height.
function updateFarLabels() {
  const wrap = map.getContainer().getBoundingClientRect();
  const cut = map.getPitch() > 20 ? wrap.height * 0.12 : -1;
  const rank = (n) => (TIER1.has(n) ? 0 : TIER2.has(n) ? 1 : 2);
  const boxes = new Map();
  for (const m of markers) {
    const dot = m.el.querySelector('.wp-dot').getBoundingClientRect();
    const far = dot.top - wrap.top < cut;
    m.el.classList.toggle('far', far);
    m.el.classList.remove('crowded');
    if (far || m.el.classList.contains('minor')) continue;
    const label = m.el.querySelector('.wp-label').getBoundingClientRect();
    boxes.set(m, { dot: [dot.left - 2, dot.top - 2, dot.right + 2, dot.bottom + 2], label: [label.left - 2, label.top - 1, label.right + 2, label.bottom + 1] });
  }
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const placed = [];
  const order = [...boxes.keys()].sort((a, b) => rank(a.city.name) - rank(b.city.name) || a.city.lat - b.city.lat);
  for (const m of order) {
    const box = boxes.get(m).label;
    if (placed.some((b) => hit(box, b)) || [...boxes].some(([o, b]) => o !== m && hit(box, b.dot))) {
      m.el.classList.add('crowded');
      continue;
    }
    placed.push(box);
  }
}

function updateMarkers(d) {
  for (const m of markers) {
    m.el.classList.toggle('reached', m.city.front <= d);
    m.el.classList.toggle('edge', m.city.front <= d && d - m.city.front <= 4);
  }
}

// ---------- hover ----------

let hoverQueued = null;
function onHover(point, lngLat, pin = false) {
  if (!state.season) return;
  const run = () => {
    hoverQueued = null;
    const hit = pickGrove(point) || pickPlace(lngLat);
    showTip(point, hit);
    if (pin || !state.hoverLock) showAt(hit);
  };
  if (pin) { run(); return; }
  if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(run); }
}

function pickGrove(point) {
  const s = state.season;
  let best = null;
  let bestD = 14 * 14;
  for (const spot of s.spots) {
    const p = map.project([spot.lon, spot.lat]);
    const dx = p.x - point.x; const dy = p.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = spot; }
  }
  return best ? { type: 'spot', item: best } : null;
}

function pickPlace(lngLat) {
  const dates = sampleField(state.field, lngLat.lng, lngLat.lat);
  const elev = map.getTerrain() ? map.queryTerrainElevation(lngLat) : null;
  const meters = elev != null ? Math.max(0, elev / (map.terrain?.exaggeration || 1)) : null;
  if (!dates && meters == null) return null;
  return { type: 'place', lngLat, dates, meters };
}

function clearHover() {
  $('cursor-tip').hidden = true;
  for (const m of markers) m.el.classList.remove('under-tip');
}

function tipHtml(hit) {
  const s = state.season;
  const c = COPY[s.kind];
  const d = state.day;
  if (hit.type === 'spot') {
    const sp = hit.item;
    return `<b>${esc(sp.name)}</b>${sp.pref ? ` <span class="sub">${esc(sp.pref)}</span>` : ''}<br>${c.front} ${fmtDay(sp.dates[1])} · ${c.peak} ${fmtDay(sp.dates[2])}<br><span class="sub">${phaseLabel(s.kind, sp.dates, d)} on ${fmtDay(d)}, forecast for this spot</span>`;
  }
  if (hit.type === 'place') {
    const parts = [];
    if (hit.meters != null) parts.push(`${Math.round(hit.meters).toLocaleString('en')} m`);
    if (hit.dates) parts.push(`${c.front} about ${fmtDay(hit.dates[1])}`);
    const second = hit.dates ? `<br><span class="sub">${phaseLabel(s.kind, hit.dates, d)} on ${fmtDay(d)}, estimated from nearby spots</span>` : '<br><span class="sub">No forecast spots nearby</span>';
    return parts.join(' · ') + second;
  }
  return '';
}

// The card goes wherever it covers the fewest city labels; any label it still covers is hidden
// until the card moves, so a date is never half-visible underneath it.
function showTip(point, hit) {
  const tip = $('cursor-tip');
  for (const m of markers) m.el.classList.remove('under-tip');
  if (!hit) { tip.hidden = true; return; }
  tip.innerHTML = tipHtml(hit);
  tip.hidden = false;
  const wrap = $('map-wrap').getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const gap = 14;
  const labels = markers
    .filter((m) => !['minor', 'far', 'crowded'].some((c) => m.el.classList.contains(c)))
    .map((m) => ({ m, r: m.el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0);
  const candidates = [
    [point.x + gap, point.y - h / 2], [point.x - gap - w, point.y - h / 2],
    [point.x - w / 2, point.y - gap - h], [point.x - w / 2, point.y + gap],
    [point.x + gap, point.y - h - gap], [point.x - gap - w, point.y + gap],
  ].map(([x, y]) => [Math.min(wrap.width - w - 6, Math.max(6, x)), Math.min(wrap.height - h - 6, Math.max(6, y))]);
  const hits = ([x, y]) => labels.filter(({ r }) => {
    const lx = r.left - wrap.left; const ly = r.top - wrap.top;
    return lx < x + w && lx + r.width > x && ly < y + h && ly + r.height > y;
  });
  let best = candidates[0];
  let bestHits = hits(best);
  for (const c of candidates.slice(1)) {
    if (!bestHits.length) break;
    const ch = hits(c);
    if (ch.length < bestHits.length) { best = c; bestHits = ch; }
  }
  for (const { m } of bestHits) m.el.classList.add('under-tip');
  tip.style.left = `${best[0]}px`;
  tip.style.top = `${best[1]}px`;
}

function showAt(hit) {
  const box = $('at-cursor');
  const s = state.season;
  if (!s) return;
  const c = COPY[s.kind];
  const d = state.day;
  if (!hit) { box.innerHTML = '<p class="muted">Point at a city, a tree or any place on the map.</p>'; return; }
  if (hit.type === 'city') {
    const city = hit.item;
    const src = city.observed ? 'observed' : 'forecast';
    if (HISTORY[COPY[s.kind].table]?.[city.name] && state.historyCity !== city.name && !state.historyKyoto) {
      state.historyCity = city.name;
      renderHistory();
    }
    const normal = city.normal != null ? fmtDay(city.normal) : 'Not published';
    box.innerHTML = `<p class="name">${esc(city.name)} <span class="muted">${esc(city.region)}</span></p>
      <dl><dt>${c.front}</dt><dd>${fmtDay(city.front)} <span class="muted">${s.kind === 'sakura' ? src : 'forecast'}</span></dd>
      <dt>${c.peak}</dt><dd>${fmtDay(city.peak)}${city.peakObserved ? ' <span class="muted">observed</span>' : ''}</dd>
      <dt>Average</dt><dd>${s.kind === 'sakura' ? normal : (city.normal != null ? `${fmtDay(city.normal)} peak` : 'Not published')}</dd>
      <dt>vs average</dt><dd>${fmtDiff(city.diff)}</dd>
      <dt>On ${fmtDay(d)}</dt><dd>${phaseLabel(s.kind, city.dates, d)}</dd>
      ${city.species ? `<dt>Tree</dt><dd>${esc(city.species)}</dd>` : ''}</dl>
      ${city.jmaOnly ? '<p class="muted">Not in the forecast. Dates are this year\'s weather station observations.</p>' : ''}`;
    return;
  }
  if (hit.type === 'spot') {
    const sp = hit.item;
    box.innerHTML = `<p class="name">${esc(sp.name)} <span class="muted">${esc(sp.nameJa || '')}</span></p>
      <dl><dt>${c.front}</dt><dd>${fmtDay(sp.dates[1])}</dd><dt>${c.peak}</dt><dd>${fmtDay(sp.dates[2])}</dd>
      <dt>On ${fmtDay(d)}</dt><dd>${phaseLabel(s.kind, sp.dates, d)}</dd><dt>Source</dt><dd>Forecast for this spot</dd></dl>`;
    return;
  }
  const ll = hit.lngLat;
  box.innerHTML = `<p class="name">${ll.lat.toFixed(2)}°N, ${ll.lng.toFixed(2)}°E</p>
    <dl>${hit.meters != null ? `<dt>Elevation</dt><dd>${Math.round(hit.meters).toLocaleString('en')} m</dd>` : ''}
    ${hit.dates ? `<dt>${c.front}</dt><dd>about ${fmtDay(hit.dates[1])}</dd><dt>${c.peak}</dt><dd>about ${fmtDay(hit.dates[2])}</dd><dt>On ${fmtDay(d)}</dt><dd>${phaseLabel(s.kind, hit.dates, d)}</dd>` : '<dt>Dates</dt><dd>No forecast spots nearby</dd>'}</dl>
    ${hit.dates ? `<p class="muted">Estimated from the nearest forecast spots.</p>` : ''}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ---------- panels ----------

function setStatus(text, error = false) {
  const el = $('map-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function renderOverview(f) {
  const s = state.season;
  const c = COPY[s.kind];
  const reached = s.cities.filter((city) => city.front <= state.day);
  const latest = reached.length ? Math.max(...reached.map((city) => city.front)) : null;
  const newest = reached.filter((city) => city.front === latest).map((city) => city.name);
  const rows = [
    ['Season', `${s.kind === 'sakura' ? 'Cherry blossom' : 'Autumn leaves'} ${s.year}`],
    [s.kind === 'sakura' ? 'Newest bloom' : 'Newest colour', latest == null ? 'None yet' : `${newest.slice(0, 3).join(', ')}${newest.length > 3 ? ` and ${newest.length - 3} more` : ''} on ${fmtDay(latest)}`],
    ['Front latitude', f.lat == null ? 'Not started' : `About ${f.lat.toFixed(1)}°N, from the last 4 days`],
    [s.kind === 'sakura' ? 'Bloomed so far' : 'Colouring so far', `${f.reached} of ${f.total} cities`],
    [c.peak, `${f.peak} ${f.peak === 1 ? 'city' : 'cities'} now`],
    ['vs average', f.meanDiff == null ? 'No cities yet' : `${fmtDiff(f.meanDiff)}, on average across cities so far`],
  ];
  $('overview').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function renderAxis() {
  const s = state.season;
  const axis = $('tl-axis');
  axis.innerHTML = '';
  for (let d = s.start; d <= s.end; d++) {
    const date = new Date(d * 86400000).getUTCDate();
    // Mid-month ticks only when there is room for them (about 60px per label).
    if (date !== 1 && (date !== 15 || axis.clientWidth / ((s.end - s.start) / 15) < 60)) continue;
    const span = document.createElement('span');
    span.style.left = `${((d - s.start) / (s.end - s.start)) * 100}%`;
    span.textContent = fmtDay(d);
    axis.appendChild(span);
  }
}

function renderEvents() {
  const s = state.season;
  const wrap = $('tl-events');
  wrap.innerHTML = '';
  const list = $('event-list');
  list.innerHTML = '';
  const today = todayDay();
  const events = s.events.slice();
  if (today >= s.start && today <= s.end) events.push({ day: today, label: 'Today', today: true });
  for (const e of events) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tl-event${e.today ? ' today' : ''}`;
    b.style.left = `${((e.day - s.start) / (s.end - s.start)) * 100}%`;
    b.title = `${e.label}, ${fmtDay(e.day)}`;
    b.setAttribute('aria-label', `${e.label}, ${fmtDay(e.day)}`);
    b.tabIndex = -1;
    b.addEventListener('click', () => setDay(e.day));
    wrap.appendChild(b);
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" data-day="${e.day}"><span>${esc(e.label)}</span><span class="when">${fmtDay(e.day)}</span></button>`;
    li.firstChild.addEventListener('click', () => setDay(e.day));
    list.appendChild(li);
  }
}

function renderCityTable() {
  const s = state.season;
  const c = COPY[s.kind];
  $('city-table-title').textContent = `All ${s.cities.length} cities`;
  const rows = s.cities.slice().sort((a, b) => a.front - b.front).map((city) => `<tr><td>${esc(city.name)}</td><td>${fmtDay(city.front)}</td><td>${fmtDay(city.peak)}</td><td>${city.diff == null ? 'n/a' : `${city.diff > 0 ? '+' : ''}${city.diff}d`}</td><td>${s.kind === 'sakura' ? (city.jmaOnly ? 'Observed, not in forecast' : city.observed ? 'Observed' : 'Forecast') : 'Forecast'}</td></tr>`).join('');
  $('city-table').innerHTML = `<thead><tr><th scope="col">City</th><th scope="col">${c.front}</th><th scope="col">${c.peak}</th><th scope="col">vs avg</th><th scope="col">Source</th></tr></thead><tbody>${rows}</tbody>`;
}

const LAYER_DEFS = [
  { id: 'relief', label: 'Elevation', thumb: 'linear-gradient(135deg,#ebe4d3,#c6b591 60%,#988a75)', opacity: true },
  { id: 'hillshade', label: 'Relief shading', thumb: 'linear-gradient(135deg,#fffaf0,#8d7a62)', opacity: true },
  { id: 'wash', label: null, thumb: null, opacity: true },
  { id: 'front', label: null, thumb: null, opacity: true },
  { id: 'trees', label: 'Forecast spots', thumb: null, opacity: false },
  { id: 'deviation', label: 'Cities vs average', thumb: 'linear-gradient(90deg,#1f6f8b,#f4f0e8,#a14a14)', opacity: false },
];

function renderLayersPanel() {
  const s = state.season;
  const c = COPY[s.kind];
  const ramp = RAMPS[s.kind];
  const washThumb = `linear-gradient(90deg,${[0.8, 1.6, 2.4, 3.3].map((v) => rgba(rampColor(ramp, v), 1)).join(',')})`;
  const treeThumb = s.kind === 'sakura' ? 'radial-gradient(circle at 50% 40%,#f7c6d8 40%,#7d6a5e 42%)' : 'radial-gradient(circle at 50% 40%,#c0392b 40%,#6d5b45 42%)';
  const list = $('layer-list');
  list.innerHTML = '';
  for (const def of LAYER_DEFS) {
    const label = def.label ?? (def.id === 'wash' ? c.wash : c.line);
    const thumb = def.thumb ?? (def.id === 'wash' ? washThumb : def.id === 'trees' ? treeThumb : `linear-gradient(90deg,transparent 45%,${s.kind === 'sakura' ? '#b8245c' : '#9a3412'} 45% 55%,transparent 55%),#f4f0e8`);
    const on = state.layers[def.id] > 0;
    const li = document.createElement('li');
    li.className = `layer${on ? '' : ' off'}`;
    const id = `layer-${def.id}`;
    li.innerHTML = `<input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="thumb" style="background:${thumb}"></span><label for="${id}">${label}</label>${def.opacity ? `<input type="range" min="0" max="1" step="0.05" value="${on ? state.layers[def.id] : 1}" aria-label="${label} opacity">` : '<span></span>'}`;
    const cb = li.querySelector('input[type="checkbox"]');
    const range = li.querySelector('input[type="range"]');
    cb.addEventListener('change', () => {
      state.layers[def.id] = cb.checked ? (range ? Number(range.value) || 1 : 1) : 0;
      li.classList.toggle('off', !cb.checked);
      applyLayers();
    });
    range?.addEventListener('input', () => {
      if (!cb.checked) return;
      state.layers[def.id] = Number(range.value);
      applyLayers();
    });
    list.appendChild(li);
  }
}

function rgba(c, a = c[3]) {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

function renderLegend() {
  const s = state.season;
  if (!s) return;
  const el = $('map-legend');
  if (state.layers.deviation > 0) {
    el.innerHTML = 'Cities vs average<div class="ramp"><i style="background:#1f6f8b"></i><i style="background:#7fb3c4"></i><i style="background:#f4f0e8"></i><i style="background:#e3a36b"></i><i style="background:#a14a14"></i></div><div class="ramp-labels"><span>12 days early</span><span>12 days late</span></div>';
    return;
  }
  const ramp = RAMPS[s.kind];
  const stops = [0.6, 1, 1.5, 2, 2.5, 3, 3.5];
  const words = COPY[s.kind].legend;
  el.innerHTML = `${COPY[s.kind].wash}<div class="ramp">${stops.map((v) => `<i style="background:${rgba(rampColor(ramp, v), 1)}"></i>`).join('')}</div><div class="ramp-labels">${words.map((w) => `<span>${w}</span>`).join('')}</div>`;
}

// ---------- history ----------

function renderHistory(force = false) {
  const s = state.season;
  if (!s) return;
  const c = COPY[s.kind];
  const kyoto = state.historyKyoto && s.kind === 'sakura';
  const key = `${s.kind}|${kyoto ? 'kyoto' : state.historyCity}`;
  if (!force && renderHistory.last === key) return;
  renderHistory.last = key;
  const svg = $('chart-trend');
  const title = $('c3-title');
  const sub = $('c3-sub');
  $('c3-kyoto').hidden = s.kind !== 'sakura';
  $('c3-kyoto').setAttribute('aria-pressed', String(kyoto));
  if (kyoto) {
    const rows = HISTORY.kyotoFullBloom;
    const h = {
      points: rows.map(([year, doy]) => ({ year, doy, substitute: false })),
      running: rows.filter((r) => r[2] != null).map(([year, , avg]) => ({ year, doy: avg })),
      normal: null,
    };
    historyChart(svg, h, { kind: s.kind });
    const recent = rows.filter((r) => r[0] >= 1997);
    const old = rows.filter((r) => r[0] >= 1800 && r[0] < 1900);
    const mean = (a) => a.reduce((x, r) => x + r[1], 0) / a.length;
    title.textContent = 'Kyoto full bloom since 812';
    sub.textContent = `Last 30 years average ${fmtDoy(Math.round(mean(recent)))}; the 1800s averaged ${fmtDoy(Math.round(mean(old)))}.`;
    sub.title = 'Mountain cherry, dated from court diaries and records before 1880';
    svg.setAttribute('aria-label', `Kyoto full bloom dates from 812 to ${rows[rows.length - 1][0]}, with the 30-year average`);
    return;
  }
  const name = state.historyCity;
  const h = cityHistory(HISTORY[c.table], name, HISTORY.firstYear);
  if (!h) {
    svg.textContent = '';
    title.textContent = `${name}: no history`;
    sub.textContent = 'The weather station records have too few years here.';
    return;
  }
  const city = s.cities.find((x) => x.name === name);
  // This year's point: an observation when it shares the history's source, otherwise the forecast, drawn hollow.
  let thisYear = null;
  if (city && s.kind === 'sakura') {
    const last = h.points[h.points.length - 1];
    thisYear = last.year === s.year ? null : { year: s.year, doy: city.front - doyToDay(s.year, 1) + 1, forecast: !city.observed };
  } else if (city && s.kind === 'koyo') {
    thisYear = { year: s.year, doy: city.peak - doyToDay(s.year, 1) + 1, forecast: true };
  }
  historyChart(svg, h, { kind: s.kind, showTrend: true, thisYear });
  const t = h.trend;
  const per = Math.abs(t.perDecade);
  const dir = t.perDecade < 0 ? 'earlier' : 'later';
  title.textContent = `${name}, ${c.history} each year`;
  sub.title = '';
  sub.textContent = per < 0.3
    ? `No clear trend since ${t.from}.`
    : `About ${per.toFixed(1)} days ${dir} per decade since ${t.from}${h.species && !h.species.startsWith('Yoshino') ? `, ${h.species.split(' (')[0]}` : ''}.`;
  svg.setAttribute('aria-label', `${name} ${c.history} dates from ${t.from} to ${t.to}. ${sub.textContent}`);
}

// ---------- wiring ----------

function wire() {
  const slider = $('tl-range-input');
  slider.addEventListener('input', (e) => { pause(); setDay(Number(e.target.value)); });
  // Whole days from the keyboard; the slider itself moves in fractions for smooth playback.
  slider.addEventListener('keydown', (e) => {
    const s = state.season;
    if (!s) return;
    const d = Math.round(state.day);
    const to = { ArrowRight: d + 1, ArrowUp: d + 1, ArrowLeft: d - 1, ArrowDown: d - 1, PageUp: d + 7, PageDown: d - 7, Home: s.start, End: s.end }[e.key];
    if (to == null) return;
    e.preventDefault();
    pause();
    setDay(e.shiftKey && e.key.startsWith('Arrow') ? d + (to - d) * 7 : to);
  });
  $('btn-play').addEventListener('click', () => (state.playing ? pause() : play()));
  $('btn-step').addEventListener('click', () => { pause(); stepToNextEvent(); });
  $('speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); });
  document.querySelectorAll('.season-seg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.season !== state.kind) setSeason(b.dataset.season);
  }));
  document.querySelectorAll('.dim-seg button').forEach((b) => b.addEventListener('click', () => applyDim(b.dataset.dim)));
  $('exag').addEventListener('change', (e) => {
    state.exag = Number(e.target.value);
    lastExag = 0;
    updateExaggeration();
    map?.triggerRepaint();
  });
  $('region').addEventListener('change', (e) => fitRegion(e.target.value));
  $('c3-kyoto').addEventListener('click', () => { state.historyKyoto = !state.historyKyoto; renderHistory(); });
  $('compass').addEventListener('click', () => map?.easeTo({ bearing: 0, duration: reducedMotion ? 0 : 500 }));

  // Arrow keys scrub the date anywhere outside form fields and the map's own controls.
  document.addEventListener('keydown', (e) => {
    if (!state.season || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      pause();
      setDay(Math.round(state.day) + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1));
    } else if (e.key === ' ' && t === document.body) {
      e.preventDefault();
      state.playing ? pause() : play();
    }
  });

  // Tabs with arrow-key roving focus.
  const tabs = [...document.querySelectorAll('.side-tabs [role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      select(next);
      next.focus();
    });
  });

  // Stop playback when the map scrolls out of view or the tab is hidden.
  new IntersectionObserver(([entry]) => { if (!entry.isIntersecting && state.playing) pause(); }, { threshold: 0.1 }).observe($('map-wrap'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) pause(); });

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const s = state.season;
      if (!s) return;
      charts.bloom = bloomChart($('chart-bloom'), series, s, COPY[s.kind], (d) => setDay(d));
      charts.speed = speedChart($('chart-speed'), speeds, s, (d) => setDay(d));
      renderHistory(true);
      renderAxis();
      setDay(state.day, true);
    }, 150);
  });
}

function start() {
  wire();
  const params = new URLSearchParams(location.search);
  let kind = params.get('season');
  if (kind !== 'sakura' && kind !== 'koyo') {
    // Autumn leaves from September to January, cherry blossom the rest of the year.
    const m = new Date().getUTCMonth();
    kind = m >= 8 || m === 0 ? 'koyo' : 'sakura';
  }
  if (hasWebGL2) {
    initMap();
    if (params.has('debug')) window.__bf = { map, state, trees };
  }
  else {
    document.querySelector('.dim-seg').hidden = true;
    $('exag').hidden = true;
    $('compass').hidden = true;
    setStatus('');
  }
  applyDim(state.dim, false);
  setSeason(kind);
}

start();

