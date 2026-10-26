// ── Colour palette — single source of truth ──
// All map dots, legend swatches, badges, and inline styles read from here.
// Mirror any change here in app.css :root variables (--pink, --orange, etc.)
// Mirror changes to app.css :root variables (--pink, --orange, --green).
const C = {
  // Sakura lifecycle: orange (bud) → pink (bloom) → green (ended)
  dormant:     '#d4d4d4',
  bud:         '#fdba74',
  budSwell:    '#fb923c',
  budOpen:     '#f97316',
  starting:    '#f9a8d4',
  blooming:    '#f472b6',
  bloom:       '#ec4899',  // = CSS --pink
  peak:        '#be185d',  // = CSS --pink-dark
  falling:     '#fbcfe8',
  ended:       '#4ade80',
  // Koyo (autumn leaves)
  koyoPeak:    '#ea580c',  // = CSS --orange
  koyoTurn:    '#f97316',
  koyoEarly:   '#fdba74',
  // Kawazu cherry (early-blooming variant, distinct magenta)
  kawazu:      '#db2777',
  // Fruit picking — blue for map markers (distinct from all sakura lifecycle colors)
  farmBlue:        '#2563eb',
  farmBlueLight:   '#eff6ff',
  farmBlueBorder:  '#93c5fd',
  // Nature greens (sidebar UI, badges, koyo early-stage) — = CSS --green
  green:       '#16a34a',
  greenDark:   '#166534',
  greenMid:    '#15803d',
  greenLight:  '#f0fdf4',
  greenSoft:   '#dcfce7',
  greenBorder: '#bbf7d0',
  // Generic semantic
  gray:        '#a3a3a3',
  error:       '#a1281f',
  pinkLight:   '#fdf2f8',
  flowers:     '#7c3aed',
};

// ── Koyo status: phase comes from the API (fresh JMC spot report first, forecast dates otherwise) ──
const KOYO_PHASES = {
  peak_now:      { label: 'Peak now',      color: C.koyoPeak,  hollow: false },
  colouring_now: { label: 'Colouring now', color: C.koyoEarly, hollow: false },
  forecast:      { label: 'Forecast',      color: C.koyoTurn,  hollow: true },
  past:          { label: 'Past peak',     color: C.dormant,   hollow: false },
};
const KOYO_HOLLOW_STROKE = 2.5;

function koyoMarkerStyle(spot) {
  const p = KOYO_PHASES[spot.phase];
  return p.hollow
    ? { fillColor: 'white', color: p.color, weight: KOYO_HOLLOW_STROKE, fillOpacity: 1 }
    : { fillColor: p.color, color: 'white', weight: 1.5, fillOpacity: 0.9 };
}

function koyoSwatchStyle(phase) {
  const p = KOYO_PHASES[phase];
  return p.hollow ? `background:white;border:2px solid ${p.color}` : `background:${p.color}`;
}

function koyoPhaseSource(spot) {
  return spot.phaseSource === 'report'
    ? `Reported at the spot: ${esc(spot.reportStatus)}`
    : 'No recent report from the spot';
}

function koyoPopupHtml(spot) {
  return `<b>${esc(spot.name)}</b><br><b>${KOYO_PHASES[spot.phase].label}</b> · ${koyoPhaseSource(spot)}<br>Forecast window: ${fmtDate(spot.bestStart)} → ${fmtDate(spot.bestEnd)} (peak ${fmtDate(spot.bestPeak)})<br><a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener">Open in Google Maps</a>`;
}

let koyoPhaseFilter = 'all';
let koyoPrefView = null; // { data, name } while a prefecture is open
let koyoDateRange = null; // { start, end } as YYYY-MM-DD
let koyoDateCities = [];

// A spot matches a trip when its JMC forecast viewing window (bestStart..bestEnd, JST dates) overlaps it.
function koyoInDateRange(spot) {
  if (!koyoDateRange) return true;
  if (!spot.bestStart || !spot.bestEnd) return false;
  return spot.bestStart.slice(0, 10) <= koyoDateRange.end && spot.bestEnd.slice(0, 10) >= koyoDateRange.start;
}

function koyoPhaseVisible(spot) {
  return koyoInDateRange(spot) && (koyoPhaseFilter === 'all' || spot.phase === koyoPhaseFilter);
}

async function applyKoyoDates() {
  const startEl = $('koyo-start'), endEl = $('koyo-end');
  endEl.setCustomValidity(endEl.value && startEl.value && endEl.value < startEl.value ? 'End date must be on or after the start date.' : '');
  if (!endEl.reportValidity() || !startEl.reportValidity()) return;
  koyoDateRange = { start: startEl.value, end: endEl.value };
  koyoPrefView = null;
  $('koyo-dates-clear').hidden = false;
  try {
    const [cities] = await Promise.all([
      api(`/api/koyo/best?start=${koyoDateRange.start}&end=${koyoDateRange.end}`).then(d => d.cities),
      (async () => { clearMarkers({ keepVersion: true }); await loadAllKoyoSpotsOnMap(); })(),
    ]);
    if (!allKoyoSpotsData) throw new Error('koyo spots missing');
    koyoDateCities = cities;
    renderKoyoDateResults(cities);
  } catch (e) {
    $('koyo-date-results').innerHTML = errorState('Could not search those dates', 'applyKoyoDates()');
  }
}

function clearKoyoDates() {
  koyoDateRange = null;
  $('koyo-dates-clear').hidden = true;
  $('koyo-start').value = $('koyo-end').value = '';
  loadKoyo();
}

const KOYO_DATE_RESULTS_SHOWN = 20;

function renderKoyoDateResults(cities) {
  $('koyo-city-list').hidden = true;
  const spots = allKoyoSpotsData.spots.filter(koyoPhaseVisible)
    .sort((a, b) => b.popularity - a.popularity || a.bestPeak.localeCompare(b.bestPeak));
  const range = `${fmtDate(koyoDateRange.start + 'T00:00:00+09:00')} – ${fmtDate(koyoDateRange.end + 'T00:00:00+09:00')}`;
  let html = `<div class="koyo-results-head">${spots.length} spots expected in colour ${range}</div>`;
  for (const spot of spots.slice(0, KOYO_DATE_RESULTS_SHOWN)) {
    const stars = spot.popularity > 0 ? '★'.repeat(spot.popularity) : '';
    html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:spot.lat,lon:spot.lon,popup:koyoPopupHtml(spot)})})">
      <h4>${esc(spot.name)} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${esc(spot.nameRomaji)}</span>` : ''} ${stars ? `<span class="muted" title="Popularity ${spot.popularity} of 3" aria-label="Popularity ${spot.popularity} of 3">${stars}</span>` : ''}</h4>
      <div class="sub">Forecast window ${fmtDate(spot.bestStart)} → ${fmtDate(spot.bestEnd)} · peak <strong>${fmtDate(spot.bestPeak)}</strong></div>
      <div class="sub"><span class="koyo-swatch" style="display:inline-block;vertical-align:-1px;${koyoSwatchStyle(spot.phase)}"></span> Status today: ${KOYO_PHASES[spot.phase].label}</div>
    </div>`;
  }
  if (spots.length > KOYO_DATE_RESULTS_SHOWN) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-600)">+ ${spots.length - KOYO_DATE_RESULTS_SHOWN} more on the map</div>`;
  if (!spots.length) html += stateHtml({ title: 'No spots in colour for these dates', body: 'Try a wider date range.' });
  html += `<div class="koyo-results-head">${cities.length} forecast cities in colour</div>`;
  html += `<div class="sub" style="padding:8px 16px">${cities.map(c => esc(c.nameEn || c.name)).join(', ') || 'None in these dates.'}</div>`;
  $('koyo-date-results').innerHTML = html;
}

function updateKoyoFilterCounts(spots) {
  const counts = { all: spots.length };
  for (const spot of spots) counts[spot.phase] = (counts[spot.phase] || 0) + 1;
  document.querySelectorAll('#koyo-filters .filter-pill').forEach(btn => {
    const phase = btn.dataset.phase;
    btn.setAttribute('aria-pressed', String(phase === koyoPhaseFilter));
    btn.querySelector('.koyo-swatch')?.setAttribute('style', koyoSwatchStyle(phase));
    let count = btn.querySelector('.koyo-count');
    if (!count) { count = document.createElement('span'); count.className = 'koyo-count'; btn.append(' ', count); }
    count.textContent = counts[phase] || 0;
  });
}

async function setKoyoPhaseFilter(phase) {
  koyoPhaseFilter = phase;
  if (koyoPrefView) { renderKoyoPrefSpots(koyoPrefView.data, koyoPrefView.name); return; }
  clearMarkers({ keepVersion: true });
  await loadAllKoyoSpotsOnMap();
  if (koyoDateRange) renderKoyoDateResults(koyoDateCities);
}

// ── State ──
let mode = 'sakura';
let sakuraData = null;
let allSpotsData = null;
let allKoyoSpotsData = null;
let mapInstance = null;
let markers = [];
let clusterGroup = null;
let mapVersion = 0;

function scheduleMapWork(fn) {
  setTimeout(fn, 0);
}

// ── Spot click registry (prevents XSS via inline onclick strings) ──
const _registry = new Map();
let _rid = 0;
function reg(data) { const id = _rid++; _registry.set(id, data); return id; }
function handleSpotClick(id) {
  const d = _registry.get(id);
  if (!d) return;
  if (d.action === 'flyToSpot') flyToSpot(d);
  if (d.action === 'loadPrefSpots') loadPrefSpots(d.prefCode, d.prefName);
  if (d.action === 'flyToFarm') mapInstance.flyTo([d.lat, d.lon], d.zoom || 14);
  if (d.action === 'flyToKoyo') {
    mapInstance.flyTo([d.lat, d.lon], d.zoom || 13);
    if (d.popup) L.popup().setLatLng([d.lat, d.lon]).setContent(d.popup).openOn(mapInstance);
  }
  if (d.action === 'setMode') setMode(d.mode);
  if (d.action === 'loadKoyoSpots') loadKoyoSpots(d.prefCode, d.name);
}

// ── Map setup ──
// Base map: OpenFreeMap vector tiles drawn with a warm paper style and English-only labels.
// Falls back to OSM.de raster tiles if WebGL or the vector libraries are unavailable.
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const EN_NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en']];
const BASE_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: {
      type: 'vector', url: 'https://tiles.openfreemap.org/planet',
      attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#f3ede2' } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#e7e6d2', 'fill-opacity': 0.7 } },
    { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': '#e9e6d3', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.6] } },
    { id: 'urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail']]], minzoom: 8, paint: { 'fill-color': '#ece4d6', 'fill-opacity': 0.8 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#cbd8d8' } },
    { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': '#cbd8d8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.5] } },
    { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#e6dccb' } },
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fffcf7', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 4] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#e8d3b4', '#fffcf7'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.8, 16, 7] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#cbbfae', 'line-width': 0.8, 'line-dasharray': [3, 2] } },
    { id: 'pref-border', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5, filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#c4b8a3', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
    { id: 'country-border', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#b3a690', 'line-width': 1 } },
    { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13, filter: ['has', 'name:en'], layout: { 'symbol-placement': 'line', 'text-field': EN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#6b6258', 'text-halo-color': '#fffcf7', 'text-halo-width': 1.2 } },
    { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10, filter: ['all', ['in', ['get', 'class'], ['literal', ['town', 'village', 'suburb']]], ['any', ['has', 'name:en'], ['has', 'name_en']]], layout: { 'text-field': EN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11.5 }, paint: { 'text-color': '#5a534b', 'text-halo-color': '#f6f1e8', 'text-halo-width': 1.4 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 6, filter: ['all', ['==', ['get', 'class'], 'city'], ['any', ['has', 'name:en'], ['has', 'name_en']]], layout: { 'text-field': EN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 14] }, paint: { 'text-color': '#4c453c', 'text-halo-color': '#f6f1e8', 'text-halo-width': 1.5 } },
  ],
};

function addRasterBase(map) {
  L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { attribution: OSM_ATTRIBUTION, maxZoom: 19, className: 'osm-raster' }).addTo(map);
}

function addBaseMap(map) {
  let webgl = false;
  try { webgl = !!document.createElement('canvas').getContext('webgl2'); } catch {}
  if (!webgl || typeof L.maplibreGL !== 'function' || typeof maplibregl === 'undefined') { addRasterBase(map); return; }
  try {
    const gl = L.maplibreGL({ style: BASE_STYLE, attributionControl: false, interactive: false }).addTo(map);
    gl.getMaplibreMap().on('error', (e) => console.warn('Base map tile error', e?.error?.message || e));
    map.attributionControl.addAttribution(BASE_STYLE.sources.omt.attribution);
    if (window.matchMedia('(max-width: 768px)').matches) map.attributionControl.setPrefix(false);
  } catch (e) {
    console.warn('Vector base map failed, using raster tiles', e);
    addRasterBase(map);
  }
}

function initMap() {
  anchorClustersOnSpots();
  mapInstance = L.map('map', { zoomControl: false, maxZoom: 18 }).setView([36.5, 137.5], 6);
  L.control.zoom({ position: 'topright' }).addTo(mapInstance);
  addBaseMap(mapInstance);

  // Lazy-load weather when a spot popup opens
  // Weather cache: avoid re-fetching on every popup open (1-hour TTL)
  const weatherCache = new Map();
  // GSI reverse geocoder cache: lat,lon → JMA class20s area code (permanent — cities don't move)
  const jmaCityCache = new Map();

  mapInstance.on('popupopen', async (e) => {
    const popupEl = e.popup.getElement();
    const el = popupEl?.querySelector('.popup-weather');
    if (!el) return;
    const lat = parseFloat(el.dataset.lat);
    const lon = parseFloat(el.dataset.lon);
    if (!lat || !lon) { el.innerHTML = ''; return; }

    // ── Upgrade JMA link to exact city level (class20s) via GSI geocoder ──
    const jmaLink = popupEl?.querySelector('.jma-city-link');
    if (jmaLink) {
      const geoKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      const cachedCode = jmaCityCache.get(geoKey);
      if (cachedCode) {
        jmaLink.href = `https://www.jma.go.jp/bosai/forecast/#area_type=class20s&area_code=${cachedCode}`;
        jmaLink.textContent = 'JMA city weather';
      } else {
        // GSI (Geospatial Info Authority of Japan) reverse geocoder — free, official
        fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`)
          .then(r => r.json())
          .then(data => {
            const muniCd = data?.results?.muniCd; // 5-digit municipality code e.g. "13101"
            if (muniCd && muniCd.length === 5) {
              const areaCode = muniCd + '00'; // JMA class20s = muniCd + "00"
              jmaCityCache.set(geoKey, areaCode);
              jmaLink.href = `https://www.jma.go.jp/bosai/forecast/#area_type=class20s&area_code=${areaCode}`;
              jmaLink.textContent = 'JMA city weather';
            }
          })
          .catch(() => {}); // silently keep prefecture link on failure
      }
    }

    // Serve from cache instantly if fresh (< 1 hour)
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = weatherCache.get(key);
    if (cached && Date.now() - cached.ts < 3_600_000) {
      el.innerHTML = cached.html;
      return;
    }

    el.innerHTML = '<div style="color:var(--ink-2);font-size:12px;padding:4px 0">Loading weather…</div>';

    try {
      // Route through our own server — caches responses for 1 hour, much faster on repeat
      const url = `/api/weather?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('weather');
      const data = await res.json();

      const cw    = data.current_weather || {};
      const daily = data.daily || {};
      const dates    = daily.time || [];
      const codes    = daily.weathercode || [];
      const maxTemps = daily.temperature_2m_max || [];
      const minTemps = daily.temperature_2m_min || [];
      const rainProb = daily.precipitation_probability_max || [];

      if (!dates.length) { el.innerHTML = ''; return; }

      // Current conditions row
            const curTemp = cw.temperature != null ? Math.round(cw.temperature) : null;
      const curDesc = wmoDesc(cw.weathercode ?? 0);
      const nowHtml = curTemp != null ? `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--line)">
          <div>
            <span style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums">${curTemp}°C</span>
            <span style="font-size:12px;color:var(--ink-2);margin-left:4px">${curDesc} now</span>
          </div>
        </div>` : '';

      // 3-day forecast cards
      const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const cols = dates.slice(0, 3).map((date, i) => {
        const icon = wmoShort(codes[i] ?? 0);
        const hi   = maxTemps[i] != null ? Math.round(maxTemps[i]) : '?';
        const lo   = minTemps[i] != null ? Math.round(minTemps[i]) : '?';
        const rain = rainProb[i]  != null ? Math.round(rainProb[i]) : 0;
        const label = i === 0 ? 'Today' : DAY[new Date(date + 'T12:00:00+09:00').getDay()];
        return `<div style="text-align:center;flex:1;background:var(--surface-2);border-radius:6px;padding:4px 2px;font-variant-numeric:tabular-nums">
          <div style="font-size:11px;color:var(--ink-2);font-weight:600">${label}</div>
          <div style="font-size:11px;color:var(--ink)">${icon}</div>
          <div style="font-weight:700;font-size:12px">${hi}° <span style="font-weight:400;color:var(--ink-2)">${lo}°</span></div>
          ${rain > 10 ? `<div style="font-size:11px;color:var(--ink-2)">Rain ${rain}%</div>` : ''}
        </div>`;
      }).join('');

      const html = `
        <div>
          ${nowHtml}
          <div style="display:flex;gap:3px;margin-bottom:4px">${cols}</div>
        </div>`;

      weatherCache.set(key, { html, ts: Date.now() });
      el.innerHTML = html;
    } catch { el.innerHTML = '<div style="font-size:12px;color:var(--ink-2);padding:4px 0">Weather is unavailable right now.</div>'; }
  });
}

// ── Helpers ──
const $ = id => document.getElementById(id);
const NA = 'TBA';

// Designed empty/error state. retry is an inline handler string.
function stateHtml({ title, body = '', retry = '', retryLabel = 'Try again', error = false }) {
  return `<div class="state${error ? ' error' : ''}" role="${error ? 'alert' : 'status'}">
    <h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}
    ${retry ? `<button type="button" onclick="${retry}">${esc(retryLabel)}</button>` : ''}
  </div>`;
}
function errorState(title, retry) {
  return stateHtml({ title, body: 'Check your connection and try again.', retry, error: true });
}
// White or ink, whichever reads at 4.5:1 on a marker fill.
// Cluster bubbles never overlap: each one sits on its anchor spot (markercluster keeps anchors
// more than CLUSTER_RADIUS px apart at every zoom) and no bubble is wider than CLUSTER_MAX_SIZE.
const CLUSTER_MAX_SIZE = 44;
const CLUSTER_RADIUS = 52;
function clusterSize(n) {
  return Math.round(Math.min(CLUSTER_MAX_SIZE, 28 + Math.log10(n) * 7));
}
function anchorClustersOnSpots() {
  const proto = L.MarkerCluster && L.MarkerCluster.prototype;
  if (!proto || proto._anchored) return;
  const recalc = proto._recalculateBounds;
  proto._recalculateBounds = function () {
    recalc.call(this);
    if (this._cLatLng) this._latlng = this._cLatLng;
  };
  proto._anchored = true;
}

function inkOn(hex) {
  const c = hex.replace('#', '');
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(parseInt(c.slice(0, 2), 16)) + 0.7152 * lin(parseInt(c.slice(2, 4), 16)) + 0.0722 * lin(parseInt(c.slice(4, 6), 16));
  return 1.05 / (L + 0.05) >= 4.5 ? '#fff' : '#1f1c18';
}
function dotHtml(color) { return `<span class="dot" style="background:${color}" aria-hidden="true"></span>`; }
function seasonForMonth(m) {
  if (m >= 2 && m <= 5) return 'sakura';
  if (m >= 9 && m <= 12) return 'koyo';
  if (m >= 6 && m <= 8) return 'flowers';
  return 'sakura';
}

function setMapPlaceholder(state = null) {
  const el = $('map-placeholder');
  if (!el) return;
  if (!state) {
    el.className = 'map-placeholder hidden';
    el.innerHTML = '';
    return;
  }
  el.className = 'map-placeholder';
  el.innerHTML = `
    <h3>${esc(state.title || '')}</h3>
    <p>${esc(state.body || '')}</p>
  `;
}

// Returns n skeleton placeholder rows for use while content is loading.
function skeletonHtml(n = 5) {
  return Array.from({ length: n }, () =>
    `<div class="skeleton-item">
      <div class="skeleton-line w-70"></div>
      <div class="skeleton-line w-50"></div>
      <div class="skeleton-line w-40"></div>
    </div>`
  ).join('');
}

// Escape user/API-sourced strings before inserting into innerHTML.
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Error: ${r.status}`);
  return r.json();
}

// Browser cache — survives refreshes and new tabs, expires after 1 hour.
const SESSION_TTL = 3_600_000;
function sessionGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    const fallbackRaw = raw || localStorage.getItem(key);
    if (!fallbackRaw) return null;
    if (!raw) sessionStorage.setItem(key, fallbackRaw);
    const { data, ts } = JSON.parse(fallbackRaw);
    if (Date.now() - ts > SESSION_TTL) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch { return null; }
}
function sessionSet(key, data) {
  try {
    const raw = JSON.stringify({ data, ts: Date.now() });
    sessionStorage.setItem(key, raw);
    localStorage.setItem(key, raw);
  } catch {}
}

// ── Farm popup — single source, used in trip/fruit/whatson modes ──
function farmPopupHtml(farm, m) {
  const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
  return `<div style="min-width:170px">
    <b>${esc(farm.name)}</b><br>
    <span style="font-size:12px;color:var(--ink-2)">${esc(farm.address||'')}</span><br>
    <span style="font-size:11px">${(farm.fruits||[]).map(esc).join(' · ')}</span>
    <div style="margin-top:6px">
      <a href="https://www.google.com/maps/search/?api=1&query=${farm.lat},${farm.lon}" target="_blank" rel="noopener">Google Maps</a>
      ${farm.url ? ` &middot; <a href="${esc(farm.url)}" target="_blank" rel="noopener">View on ${esc(srcLabel)}</a>` : ''}
    </div>
  </div>`;
}
// JMC dates are JST calendar days; format in Tokyo time so viewers west of Japan do not see the previous day.
const JST_MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
function fmtDate(iso) {
  if (!iso) return NA;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NA;
  return JST_MONTH_DAY.format(d);
}
function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function sakuraPhase(bloomRate, fullRate, fullBloomForecast) {
  const bloom = Number(bloomRate) || 0;
  const full = Number(fullRate) || 0;

  if (full >= 100) {
    const days = fullBloomForecast ? Math.max(0, daysSince(fullBloomForecast)) : 0;
    if (days > 10) return 'ended';
    if (days > 6) return 'falling';
    if (days > 3) return 'past_peak';
    return 'peak';
  }
  if (full >= 70) return 'blooming';
  if (full > 0) return 'starting';
  if (bloom >= 85) return 'bud_open';
  if (bloom >= 60) return 'bud_swell';
  if (bloom > 0) return 'buds';
  return 'dormant';
}

function sakuraPhaseColor(phase) {
  if (phase === 'ended') return C.ended;
  if (phase === 'falling') return C.falling;
  if (phase === 'past_peak') return C.blooming;
  if (phase === 'peak') return C.peak;
  if (phase === 'blooming') return C.bloom;
  if (phase === 'starting') return C.starting;
  if (phase === 'bud_open') return C.budOpen;
  if (phase === 'bud_swell') return C.budSwell;
  if (phase === 'buds') return C.bud;
  return C.dormant;
}

function sakuraPhaseLabel(phase) {
  if (phase === 'ended') return 'Ended, green leaves';
  if (phase === 'falling') return 'Petals falling';
  if (phase === 'past_peak') return 'Past peak, some petals left';
  if (phase === 'peak') return 'Full bloom, best viewing';
  if (phase === 'blooming') return 'Blooming, near full bloom';
  if (phase === 'starting') return 'Starting to bloom';
  if (phase === 'bud_open') return 'Buds opening';
  if (phase === 'bud_swell') return 'Buds swelling';
  if (phase === 'buds') return 'Bud stage';
  return 'Dormant';
}

function sakuraPhaseRadius(phase) {
  if (phase === 'peak') return 9;
  if (phase === 'past_peak' || phase === 'blooming') return 8;
  if (phase === 'starting') return 7;
  if (phase === 'falling') return 6;
  if (phase === 'ended' || phase === 'bud_open') return 5;
  if (phase === 'bud_swell' || phase === 'buds') return 5;
  return 4;
}

function sakuraPhaseCategory(phase) {
  if (phase === 'peak') return 'peak';
  if (phase === 'past_peak' || phase === 'falling' || phase === 'ended') return 'ended';
  if (phase === 'blooming' || phase === 'starting') return 'blooming';
  if (phase === 'bud_open' || phase === 'bud_swell' || phase === 'buds') return 'buds';
  return 'dormant';
}

function isPostPeakSakuraPhase(phase) {
  return phase === 'past_peak' || phase === 'falling' || phase === 'ended';
}

const SAKURA_PHASES = new Set(['dormant', 'buds', 'bud_swell', 'bud_open', 'starting', 'blooming', 'peak', 'past_peak', 'falling', 'ended']);

function isSpotRecord(value) {
  return Boolean(value) && typeof value === 'object';
}

function normalizeSakuraSpotPhase(phase) {
  return SAKURA_PHASES.has(phase) ? phase : null;
}

function sakuraSpotPhase(spot) {
  const apiPhase = normalizeSakuraSpotPhase(spot?.phase);
  if (apiPhase) return apiPhase;
  return sakuraPhase(spot?.bloomRate, spot?.fullRate, spot?.fullBloomForecast);
}

function hasSakuraTimelineData(bloomRate, fullRate, bloomForecast, fullBloomForecast) {
  return Boolean(fullBloomForecast || bloomForecast || (Number(bloomRate) || 0) > 0 || (Number(fullRate) || 0) > 0);
}

function cityStatusPhase(status) {
  const s = status || '';
  if (s.includes('Ended') || s.includes('green leaves')) return 'ended';
  if (s.includes('Falling') || s.includes('scattering')) return 'falling';
  if (s.includes('Past peak')) return 'past_peak';
  if (s.includes('Full bloom') || s.includes('mankai') || s.includes('best')) return 'peak';
  if (s.includes('Starting to bloom')) return 'starting';
  if (s.includes('Blooming') || s.includes('Approaching') || s.includes('咲き')) return 'blooming';
  if (s.includes('Buds opening')) return 'bud_open';
  if (s.includes('Buds swelling')) return 'bud_swell';
  if (s.includes('Coming') || s.includes('soon') || s.includes('Bud') || s.includes('つぼみ')) return 'buds';
  return 'dormant';
}

function sakuraBadgeClass(phase) {
  if (phase === 'peak') return 'peak';
  if (phase === 'ended') return 'ended';
  if (isPostPeakSakuraPhase(phase) || phase === 'blooming' || phase === 'starting') return 'bloom';
  if (phase === 'bud_open' || phase === 'bud_swell' || phase === 'buds') return 'soon';
  return 'ended';
}

// WMO weather code → short label (https://open-meteo.com/en/docs)
function wmoShort(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code <= 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow';
  return 'Storms';
}
function wmoDesc(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code <= 3) return 'Overcast';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rainy';
  if (code <= 77) return 'Snowy';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

// Sanity-check sakura dates: bloom happens Jan–Jun or Oct–Dec at the latest (Hokkaido).
// A date in Jul–Sep is always stale/bad API data.
function sakuraDateOk(iso) {
  if (!iso) return false;
  const mo = new Date(iso).getMonth() + 1;
  return mo < 7 || mo > 9; // Jun is ok (late Hokkaido), Jul–Sep are never sakura
}
// Full date line: confirmed = plain date, forecast = "(est.)" suffix
function fmtDates(bloomForecast, bloomRate, fullBloomForecast, fullRate) {
  const bDate = sakuraDateOk(bloomForecast) ? fmtDate(bloomForecast) : NA;
  const fDate = sakuraDateOk(fullBloomForecast) ? fmtDate(fullBloomForecast) : NA;
  const b = bloomRate >= 100 ? `Bloomed: ${bDate}` : `Bloom: ${bDate === NA ? NA : bDate + ' (est.)'}`;
  const f = fullRate >= 100 ? `Full bloom: ${fDate}` : `Full bloom: ${fDate === NA ? NA : fDate + ' (est.)'}`;
  return `${b} · ${f}`;
}

function spotDisplayStatus(spot) {
  if (spot?.displayStatus) return spot.displayStatus;
  if (hasSakuraTimelineData(spot?.bloomRate, spot?.fullRate, spot?.bloomForecast, spot?.fullBloomForecast)) {
    return spotStatusWithDate(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
  }
  return spot?.status || 'Dormant';
}

function spotStatusNote(spot) {
  if (!isSpotRecord(spot)) return '';
  if (spot.statusSource === 'observation') {
    return spot.statusUpdated ? `Current observation · ${fmtDate(spot.statusUpdated)}` : 'Current observation';
  }
  if (spot.observationFresh === false && spot.observationUpdated && spot.observationStatus) {
    return `Last observed ${fmtDate(spot.observationUpdated)} · ${spot.observationStatus}`;
  }
  return '';
}

function spotForecastDates(spot) {
  const line = fmtDates(spot?.bloomForecast, spot?.bloomRate, spot?.fullBloomForecast, spot?.fullRate);
  return spot?.statusSource === 'observation' ? `Forecast meter · ${line}` : line;
}

// ── Color by phase ──
// Prefer backend phase for sakura spots so map/filtering follows the same
// source-selection rule as the MCP output. Fall back to local forecast logic.
function sakuraColor(spotOrBloomRate, fullRate, fullBloomForecast) {
  const phase = isSpotRecord(spotOrBloomRate)
    ? sakuraSpotPhase(spotOrBloomRate)
    : sakuraPhase(spotOrBloomRate, fullRate, fullBloomForecast);
  return sakuraPhaseColor(phase);
}

// Spot status text reads from the same shared phase thresholds as map dots.
function spotStatusWithDate(bloomRate, fullRate, fullBloomForecast) {
  return sakuraPhaseLabel(sakuraPhase(bloomRate, fullRate, fullBloomForecast));
}

function spotLiveStatus(spot) {
  return spotDisplayStatus(spot);
}

function sakuraRadius(spotOrBloomRate, fullRate, fullBloomForecast) {
  const phase = isSpotRecord(spotOrBloomRate)
    ? sakuraSpotPhase(spotOrBloomRate)
    : sakuraPhase(spotOrBloomRate, fullRate, fullBloomForecast);
  return sakuraPhaseRadius(phase);
}

// ── Bloom category (for filter) ──
let bloomFilter = 'all'; // kept for legacy compat
let bloomFilters = new Set(); // empty = show all

function bloomCategory(spotOrBloomRate, fullRate, fullBloomForecast) {
  const phase = isSpotRecord(spotOrBloomRate)
    ? sakuraSpotPhase(spotOrBloomRate)
    : sakuraPhase(spotOrBloomRate, fullRate, fullBloomForecast);
  return sakuraPhaseCategory(phase);
}

function matchesBloomFilter(category) {
  return bloomFilters.size === 0 || bloomFilters.has(category);
}

function cityBloomCategory(city) {
  return sakuraPhaseCategory(cityStatusPhase(city?.status));
}

function applyBloomFilter(filter, el) {
  const allBtn = document.querySelector('.filter-pill[data-filter="all"]');

  if (filter === 'all') {
    bloomFilters.clear();
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    allBtn?.classList.add('active');
  } else {
    if (bloomFilters.has(filter)) {
      bloomFilters.delete(filter);
      el?.classList.remove('active');
    } else {
      bloomFilters.add(filter);
      el?.classList.add('active');
      allBtn?.classList.remove('active');
    }
    if (bloomFilters.size === 0) allBtn?.classList.add('active');
  }
  bloomFilter = bloomFilters.size === 1 ? [...bloomFilters][0] : 'all'; // legacy compat

  if (!allSpotsData) return;
  clearMarkers();
  loadAllSpotsOnMap();

  if (bloomFilters.size === 0) {
    let html = '';
    for (const region of sakuraData.regions) {
      html += `<div class="section-head">${region.nameEn}</div>`;
      for (const city of region.cities) {
        html += cityRowHtml(city);
      }
    }
    $('sidebar-content').innerHTML = html;
  } else {
    const labelMap = { peak:'Full bloom', blooming:'Blooming', buds:'Budding', ended:'Past peak' };
    const labels = [...bloomFilters].map(f => labelMap[f]).join(' + ');
    const filtered = allSpotsData.spots.filter(s => matchesBloomFilter(bloomCategory(s)));
    const listHtml = filtered.length
      ? filtered.slice(0, 80).map(s => spotCardHtml(s, s.prefecture || '')).join('')
      : stateHtml({ title: 'No spots at this stage', body: 'Choose All to see every spot.' });
    $('sidebar-content').innerHTML = `<div class="section-head">${labels}: <span class="num">${filtered.length}</span> spots</div>` + listHtml;
  }
}

// Returns human-readable stage name from the bloom/full rates
function growthStage(bloomRate) {
  if (bloomRate >= 100) return 'Bloomed';
  if (bloomRate >= 85) return 'Buds opening';
  if (bloomRate >= 60) return 'Buds swelling';
  if (bloomRate > 0) return 'Bud stage';
  return 'Dormant';
}
function floweringStage(fullRate) {
  if (fullRate >= 100) return 'Full bloom';
  if (fullRate >= 90) return 'Nearly full';
  if (fullRate >= 70) return '70%';
  if (fullRate >= 40) return '50%';
  if (fullRate >= 20) return '30%';
  if (fullRate > 0) return 'Starting';
  return 'Not yet';
}
// Show only the most relevant bar. Hide entirely once past peak (> 3 days after full bloom).
function bloomBar(spotOrBloomRate, fullRate, fullBloomForecast) {
  const spot = isSpotRecord(spotOrBloomRate) ? spotOrBloomRate : null;
  const bloomRate = spot ? (Number(spot.bloomRate) || 0) : (Number(spotOrBloomRate) || 0);
  const full = spot ? (Number(spot.fullRate) || 0) : (Number(fullRate) || 0);
  const forecast = spot ? spot.fullBloomForecast : fullBloomForecast;
  const phase = spot ? sakuraSpotPhase(spot) : sakuraPhase(bloomRate, full, forecast);

  if (spot?.statusSource === 'observation') return '';
  if (isPostPeakSakuraPhase(phase)) return '';
  if (full >= 100 && forecast) {
    const days = daysSince(forecast);
    if (days > 3) return '';
  }
  if (full > 0) {
    return `<div class="bloom-row"><span class="bloom-label">Flowering</span><div class="bloom-track"><div class="bloom-fill f" style="width:${Math.min(full,100)}%">${full}%</div></div><span style="font-size:0.72rem;color:var(--gray-600);width:80px;text-align:right">${floweringStage(full)}</span></div>`;
  }
  return `<div class="bloom-row"><span class="bloom-label">Growth</span><div class="bloom-track"><div class="bloom-fill b" style="width:${Math.min(bloomRate,100)}%">${bloomRate}%</div></div><span style="font-size:0.72rem;color:var(--gray-600);width:80px;text-align:right">${growthStage(bloomRate)}</span></div>`;
}

// Map city status text to dot color/size for the overview map
function statusToColor(status) {
  return sakuraPhaseColor(cityStatusPhase(status));
}
function statusToRadius(status) {
  return sakuraPhaseRadius(cityStatusPhase(status));
}

function cityRowHtml(city) {
  const st = statusText(city.status);
  const day = (fc, obs) => obs ? fmtDate(obs) : (sakuraDateOk(fc) ? `${fmtDate(fc)} (forecast)` : NA);
  return `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:city.prefCode,prefName:city.prefName})})">
    <h4>${esc(city.cityName)} <span style="font-weight:400;color:var(--ink-2)">${esc(city.prefName)}</span></h4>
    <div class="sub"><span class="badge ${st.cls}">${esc(st.text)}</span></div>
    <div class="sub num">${city.bloom?.observation ? 'Bloomed' : 'Bloom'} ${day(city.bloom?.forecast, city.bloom?.observation)} · Full bloom ${day(city.fullBloom?.forecast, city.fullBloom?.observation)}${avgDiffLabel(city.fullBloom?.forecast, city.fullBloom?.normal)}</div>
  </div>`;
}

function statusText(status) {
  const phase = cityStatusPhase(status);
  const text = (status || 'Dormant').split('—')[0].trim();
  return { text, cls: sakuraBadgeClass(phase) };
}

// ── City coordinates for map markers (48 JMA observation cities) ──
const CITY_COORDS = {
  "Wakkanai":[45.415,141.673],"Asahikawa":[43.771,142.365],"Abashiri":[44.02,144.273],
  "Kushiro":[42.985,144.381],"Obihiro":[42.92,143.197],"Sapporo":[43.062,141.354],
  "Muroran":[42.315,140.974],"Hakodate":[41.769,140.729],
  "Aomori":[40.824,140.74],"Morioka":[39.702,141.153],"Sendai":[38.268,140.872],
  "Akita":[39.717,140.103],"Yamagata":[38.256,140.339],"Fukushima":[37.75,140.468],
  "Mito":[36.366,140.471],"Utsunomiya":[36.549,139.87],"Maebashi":[36.391,139.061],
  "Kumagaya":[36.147,139.389],"Choshi":[35.735,140.827],"Tokyo":[35.689,139.692],
  "Yokohama":[35.448,139.642],"Kofu":[35.662,138.568],"Nagano":[36.651,138.181],
  "Nagoya":[35.18,136.906],"Gifu":[35.423,136.761],"Shizuoka":[34.976,138.383],"Tsu":[34.73,136.509],
  "Niigata":[37.902,139.024],"Toyama":[36.695,137.211],"Kanazawa":[36.594,136.625],"Fukui":[36.054,136.222],
  "Osaka":[34.694,135.502],"Hikone":[35.276,136.246],"Kyoto":[35.012,135.768],
  "Kobe":[34.691,135.183],"Nara":[34.685,135.833],"Wakayama":[34.226,135.168],
  "Hiroshima":[34.397,132.46],"Tottori":[35.501,134.235],"Matsue":[35.472,133.051],
  "Okayama":[34.662,133.935],"Shimonoseki":[33.95,130.941],
  "Tokushima":[34.066,134.559],"Takamatsu":[34.34,134.043],"Matsuyama":[33.842,132.766],"Kochi":[33.559,133.531],
  "Fukuoka":[33.59,130.402],"Saga":[33.263,130.301],"Nagasaki":[32.745,129.873],
  "Kumamoto":[32.803,130.707],"Oita":[33.238,131.613],"Miyazaki":[31.911,131.424],"Kagoshima":[31.596,130.557],
};

// ── URL state ──
function pushUrlState(params = {}) {
  const u = new URL(location.href);
  Object.entries(params).forEach(([k, v]) => v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  history.replaceState(null, '', u);
}

// ── Mode switching ──
const JMC_LINK = '<a href="https://n-kishou.com" target="_blank" rel="noopener">Japan Meteorological Corporation</a>';
const FOOTER_NOTES = {
  sakura:  `Forecasts from ${JMC_LINK}, updated daily at 9:00 Japan time.`,
  koyo:    `Spot reports from ${JMC_LINK}, updated daily at 9:00 Japan time. The forecast itself is issued a few times each autumn.`,
  fruit:   'Farms listed on Jalan. Seasons are regional averages, so check with the farm before you go.',
  flowers: 'Typical bloom dates. Timing moves with the weather, so check the official site before you go.',
  whatson: 'Typical dates. Check the official site before you go.',
  trip:    `Cherry blossom and autumn leaves dates from ${JMC_LINK}. Other dates are typical.`,
};

const MODE_TITLES = {
  sakura:  'Japan in Seasons: cherry blossom forecast and spots',
  koyo:    'Japan in Seasons: autumn leaves forecast and spots',
  fruit:   'Japan in Seasons: fruit picking by month',
  flowers: 'Japan in Seasons: seasonal flower spots',
  whatson: 'Japan in Seasons: festivals and events by month',
  trip:    'Japan in Seasons: plan a trip by date',
};

// Views that moved to their own page.
const MODE_PAGES = { fruit: '/fruit', whatson: '/festivals', trip: '/plan' };

function setMode(m) {
  if (MODE_PAGES[m]) { location.assign(MODE_PAGES[m]); return; }
  mode = m;
  document.body.dataset.mode = m;
  mapInstance?.invalidateSize(); // koyo's phone layout changes the map height
  document.title = MODE_TITLES[m] || 'Japan in Seasons';
  setMapPlaceholder(null);
  ['sakura','koyo','fruit','flowers','whatson','trip'].forEach(k => {
    const b = $(`btn-${k}`);
    if (!b) return;
    b.classList.toggle('active', k === m);
    if (k === m) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  const sel = document.getElementById('mode-select'); if (sel) sel.value = m;
  updateExploreLink(m);
  if (m !== 'sakura') { const bf = $('bloom-filters'); if (bf) bf.hidden = true; }
  $('koyo-filters').hidden = m !== 'koyo';
  $('koyo-dates').hidden = m !== 'koyo';
  if (m === 'koyo' && matchMedia('(min-width: 769px)').matches) $('koyo-dates').open = true; // phones start collapsed
  const fn = $('footer-data-note'); if (fn) fn.innerHTML = FOOTER_NOTES[m] || '';
  if (m === 'sakura') loadSakura();
  if (m === 'trip') loadTripPlanner();
  if (m === 'koyo') loadKoyo();
  if (m === 'fruit') loadFruitPicking();
  if (m === 'flowers') loadFlowers();
  if (m === 'whatson') loadWhatsOn();
  pushUrlState({ mode: m });
}

// The 3D link follows the season on screen: autumn opens the colour front, everything else the
// season of the month.
function updateExploreLink(m) {
  const month = new Date().getMonth();
  const koyo = m === 'koyo' || (m !== 'sakura' && (month >= 8 || month === 0));
  const label = koyo ? 'Autumn colour 3D' : 'Bloom front 3D';
  document.querySelectorAll('a[href^="/explore"]').forEach((a) => {
    a.href = `/explore?season=${koyo ? 'koyo' : 'sakura'}`;
    const span = a.querySelector('span');
    if (span) span.textContent = label;
    if (a.classList.contains('explore-link')) a.setAttribute('aria-label', koyo ? 'Colour front, a 3D view of autumn leaves moving across Japan' : 'Bloom front, a 3D view of cherry blossom moving across Japan');
  });
}

function handleModeSelect(val) {
  if (val === 'nearme') { findNearMe(); return; }
  setMode(val);
}

// ── Static config tables ──
// These are the UI-side data tables (colors, months, notes for rendering).
// src/lib/constants.ts has the MCP-server-side versions (no colors, more regional detail).
// Keep months in sync between both files when updating seasons.

const FRUITS = [
  { name:'Strawberry', ja:'いちご', months:[12,1,2,3,4,5], peak:[2,3,4], color:'#ef4444',
    regions:['Tochigi','Nagano','Chiba','Ibaraki','Hokkaido'], note:'Kyushu (Fukuoka) season ends ~April; May is Kanto & northern only' },
  { name:'Melon', ja:'メロン', months:[5,6,7,8], peak:[6,7], color:'#16a34a',
    regions:['Hokkaido (Yubari)','Ibaraki','Kumamoto'], note:'Yubari King is Japan\'s most prized melon' },
  { name:'Cherry', ja:'さくらんぼ', months:[6,7], peak:[6,7], color:'#dc2626',
    regions:['Yamagata','Hokkaido','Nagano','Aomori'], note:'Very short season. Book farms early.' },
  { name:'Watermelon', ja:'すいか', months:[6,7,8], peak:[7], color:'#16a34a',
    regions:['Kumamoto','Yamagata','Chiba'] },
  { name:'Peach', ja:'もも', months:[7,8,9], peak:[7,8], color:C.budOpen,
    regions:['Yamanashi','Fukushima','Nagano','Okayama'] },
  { name:'Blueberry', ja:'ブルーベリー', months:[7,8,9], peak:[7,8], color:'#6d28d9',
    regions:['Nagano','Chiba','Tokyo (suburbs)','Hokkaido'] },
  { name:'Grape', ja:'ぶどう', months:[8,9,10,11], peak:[9,10], color:'#7c3aed',
    regions:['Yamanashi','Nagano','Yamagata','Okayama'], note:'50+ varieties; shine muscat is very popular' },
  { name:'Pear', ja:'なし', months:[8,9,10], peak:[8,9], color:'#65a30d',
    regions:['Tottori','Chiba','Ibaraki','Nagano'], note:'Japanese pears are round and crisp' },
  { name:'Fig', ja:'いちじく', months:[8,9,10], peak:[9], color:'#a855f7',
    regions:['Aichi','Osaka','Hyogo'] },
  { name:'Apple', ja:'りんご', months:[9,10,11], peak:[10,11], color:'#dc2626',
    regions:['Aomori','Nagano','Iwate','Yamagata'], note:'Aomori produces ~60% of Japan\'s apples' },
  { name:'Persimmon', ja:'柿', months:[10,11,12], peak:[10,11], color:'#ea580c',
    regions:['Nara','Wakayama','Gifu','Fukuoka'] },
  { name:'Kiwi', ja:'キウイ', months:[10,11,12], peak:[11], color:'#65a30d',
    regions:['Ehime','Kanagawa','Fukuoka'] },
  { name:'Chestnut', ja:'栗', months:[9,10,11], peak:[9,10], color:'#92400e',
    regions:['Ibaraki','Kumamoto','Ehime','Aichi'], note:'Japan\'s most prized variety is Tanba (Kyoto/Hyogo)' },
  { name:'Mikan', ja:'みかん', months:[11,12,1], peak:[11,12], color:C.budOpen,
    regions:['Wakayama','Ehime','Shizuoka','Nagasaki'], note:'Japan\'s most popular winter citrus' },
];

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const FLOWER_TYPES = [
  { type: 'plum',      name: 'Plum Blossom', ja: '梅',        color: '#e11d48', peakLabel: 'Jan–Mar',
    months: [1,2,3],   peak: [2],
    note: 'Peak: mid-January (Atami) to March. Japan\'s first spring bloom, 4 to 6 weeks before cherry blossom.' },
  { type: 'nanohana',  name: 'Rapeseed',     ja: '菜の花',    color: '#ca8a04', peakLabel: 'Feb–Apr',
    months: [2,3,4],   peak: [3],
    note: 'Peak: February–April. Golden rapeseed carpets river banks and hillsides across Japan. Okinawa blooms earliest in January.' },
  { type: 'wisteria',  name: 'Wisteria',     ja: '藤',        color: '#7c3aed', peakLabel: 'late Apr–early May',
    months: [4,5],     peak: [4,5],
    note: 'Peak: late April to early May. Famous spots often need timed entry tickets.' },
  { type: 'iris',      name: 'Iris',         ja: '菖蒲',      color: '#4f46e5', peakLabel: 'May–Jun',
    months: [5,6],     peak: [6],
    note: 'Peak: June (July in northern Tohoku). Traditional Japanese iris gardens are a quintessential early-summer experience.' },
  { type: 'hydrangea', name: 'Hydrangea',    ja: '紫陽花',    color: '#2563eb', peakLabel: 'June',
    months: [6,7],     peak: [6],
    note: 'Peak: June. Kamakura has more than 10 spots. Weekdays are less crowded.' },
  { type: 'lavender',  name: 'Lavender',     ja: 'ラベンダー', color: '#9333ea', peakLabel: 'July',
    months: [6,7],     peak: [7],
    note: 'Peak: July in Furano, Hokkaido. Farm Tomita is the best-known field.' },
  { type: 'sunflower', name: 'Sunflower',    ja: 'ひまわり',  color: '#f59e0b', peakLabel: 'Jul–Aug',
    months: [7,8],     peak: [7,8],
    note: 'Peak: late July to August. Hokuryu in Hokkaido has the largest field; fields in Yamanashi face Mt Fuji.' },
  { type: 'cosmos',    name: 'Cosmos',       ja: 'コスモス',  color: '#db2777', peakLabel: 'Sep–Oct',
    months: [9,10],    peak: [10],
    note: 'Peak: October. Showa Kinen Park and Hitachi Seaside Park are the largest fields.' },
];

const FESTIVAL_TYPES = [
  { type: 'fireworks', name: 'Fireworks', color: C.budOpen },
  { type: 'matsuri',   name: 'Festival',  color: '#dc2626' },
  { type: 'winter',    name: 'Winter',    color: '#0ea5e9' },
];

// Season month ranges — single source of truth
const SAKURA_MONTHS  = [2, 3, 4, 5];   // Feb–May (Hokkaido peaks in May)
const KOYO_MONTHS    = [9, 10, 11, 12]; // Sep–Dec

function fruitSeasonLabel(months, peak) {
  // Find start/end handling wrap-around (e.g. [12,1,2])
  const sorted = [...months].sort((a,b) => a-b);
  const hasWrap = sorted[sorted.length-1] - sorted[0] > 6;
  let start, end;
  if (hasWrap) {
    // wrap-around: find the gap and read the other way
    const wrapStart = sorted.find((m,i) => i>0 && m - sorted[i-1] > 1) ?? sorted[0];
    start = wrapStart; end = sorted[sorted.length-1];
    // e.g. [1,2,3,12] → Dec–Mar
    const before = sorted.filter(m => m >= wrapStart);
    const after = sorted.filter(m => m < wrapStart);
    start = before[0]; end = after[after.length-1];
  } else {
    start = sorted[0]; end = sorted[sorted.length-1];
  }
  const peakLabels = peak.map(m => MO[m-1]).join('–');
  return { season: `${MO[start-1]}–${MO[end-1]}`, peak: peakLabels };
}

let farmDataCache = null;
let fruitSelectedMonth = new Date().getMonth() + 1;
let fruitFilter = null; // null = show all, else fruit name like 'Strawberry'

function setFruitFilter(name) {
  fruitFilter = fruitFilter === name ? null : name;
  renderFruitMonth(fruitSelectedMonth);
}

async function loadFruitPicking() {
  $('sidebar-header').innerHTML = '<h2>Fruit picking</h2><p>Loading farms…</p>';
  $('sidebar-content').innerHTML = skeletonHtml();
  clearMarkers();
  updateLegend('fruit');

  if (!farmDataCache) {
    try { farmDataCache = await api('/api/fruit/farms'); } catch {}
  }
  const farmCount = farmDataCache?.total ?? farmDataCache?.spots?.length ?? null;
  $('sidebar-header').innerHTML = `<h2>Fruit picking</h2><p>${farmCount ? `${farmCount.toLocaleString('en-US')} farms across Japan` : 'Farms across Japan'}</p>`;
  if (!farmDataCache) {
    $('sidebar-content').innerHTML = errorState('Could not load the farm list', 'farmDataCache=null;loadFruitPicking()');
    return;
  }

  fruitSelectedMonth = new Date().getMonth() + 1;
  fruitFilter = null; // reset fruit filter on tab switch
  renderFruitMonth(fruitSelectedMonth);
}

function renderFruitMonth(m) {
  fruitSelectedMonth = m;
  const farms = farmDataCache?.spots || [];
  const scrapedAt = farmDataCache?.scraped_at
    ? new Date(farmDataCache.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Rebuild map markers for selected month
  clearMarkers();
  let markersAdded = 0;
  if (farms.length) {
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: CLUSTER_RADIUS, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const n = cluster.getChildCount();
        const size = clusterSize(n);
        return L.divIcon({
          html: `<div style="background:${C.green};color:${inkOn(C.green)};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`,
          className: '', iconSize: [size, size],
        });
      }
    });

    // Group farms by location (4dp ≈ 11m) so overlapping markers become one
    const byLocation = new Map();
    for (const farm of farms) {
      if (!farm.lat || !farm.lon) continue;
      const key = `${farm.lat.toFixed(4)},${farm.lon.toFixed(4)}`;
      if (!byLocation.has(key)) byLocation.set(key, []);
      byLocation.get(key).push(farm);
    }

    for (const [locKey, locFarms] of byLocation) {
      // Only farms that have an in-season fruit this month and pass the fruit filter
      const activeFarms = locFarms.filter(farm => {
        const inSeason = FRUITS.some(f => farm.fruits?.includes(f.name) && f.months.includes(m));
        if (!inSeason) return false;
        if (fruitFilter && !farm.fruits?.includes(fruitFilter)) return false;
        return true;
      });
      if (!activeFarms.length) continue;

      const [lat, lon] = locKey.split(',').map(Number);

      // Collect unique in-season fruits across all farms at this location
      const seen = new Set();
      const inSeasonFruits = [];
      for (const farm of activeFarms) {
        for (const fruitName of (farm.fruits || [])) {
          const f = FRUITS.find(fr => fr.name === fruitName && fr.months.includes(m));
          if (f && !seen.has(fruitName)) { seen.add(fruitName); inSeasonFruits.push(f); }
        }
      }

      // Icon: up to two fruit-colour dots
      const n = inSeasonFruits.length;
      const dots = inSeasonFruits.slice(0, 2).map(f => `<span style="width:8px;height:8px;border-radius:50%;background:${f.color}"></span>`).join('');
      const sz = n > 1 ? 26 : 22;
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          html: `<div title="${inSeasonFruits.map(f => f.name).join(', ')}" style="background:white;border:2px solid ${C.green};border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.2);gap:2px">${dots}</div>`,
          className: '', iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
        })
      });

      // Popup: list every farm at this location, separated by a divider
      const popupRows = activeFarms.map((farm, i) => {
        const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
        return `${i > 0 ? `<div style="border-top:1px solid #eee;margin:8px 0"></div>` : ''}
          <b>${esc(farm.name)}</b><br>
          <span style="font-size:12px;color:var(--ink-2)">${esc(farm.address||'')}</span><br>
          <span style="font-size:12px">${(farm.fruits||[]).map(esc).join(' · ')}</span>
          <div style="margin-top:4px">
            <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Google Maps</a>
            ${farm.url ? ` · <a href="${esc(farm.url)}" target="_blank" rel="noopener">View on ${esc(srcLabel)}</a>` : ''}
          </div>`;
      }).join('');
      marker.bindPopup(`<div style="min-width:190px">${popupRows}</div>`);
      clusterGroup.addLayer(marker);
      markers.push(marker);
      markersAdded++;
    }
    mapInstance.addLayer(clusterGroup);
  }

  // Month pill selector
  const todayM = new Date().getMonth() + 1;
  const monthPills = MO.map((mo, i) => {
    const mn = i + 1;
    const hasInSeason = FRUITS.some(f => f.months.includes(mn));
    const isActive = mn === m;
    const isToday = mn === todayM;
    return `<button type="button" class="month-btn${isActive ? ' active' : ''}${isToday ? ' is-today' : ''}${hasInSeason ? '' : ' is-quiet'}" aria-pressed="${isActive}" onclick="renderFruitMonth(${mn})">${mo}</button>`;
  }).join('');

  // Update header
  $('sidebar-header').innerHTML = `
    <h2>Fruit picking</h2>
    <p><span class="num">${markersAdded.toLocaleString('en-US')}</span> of <span class="num">${(farms.length || 0).toLocaleString('en-US')}</span> farms have fruit in season in ${MO[m-1]}</p>
    <div class="month-grid" role="group" aria-label="Month">${monthPills}</div>`;

  // Fruit list for selected month
  const inSeason = FRUITS.filter(f => f.months.includes(m));
  const nextM = m === 12 ? 1 : m + 1;
  const nextM2 = nextM === 12 ? 1 : nextM + 1;
  const comingSoon = FRUITS.filter(f => !f.months.includes(m) && (f.months.includes(nextM) || f.months.includes(nextM2)));
  const other = FRUITS.filter(f => !f.months.includes(m) && !f.months.includes(nextM) && !f.months.includes(nextM2));

  function fruitCard(f) {
    const { season, peak } = fruitSeasonLabel(f.months, f.peak);
    const isPeak = f.peak.includes(m);
    const farmCount = farms.filter(fm => fm.fruits?.includes(f.name)).length;
    const isActive = fruitFilter === f.name;
    return `<div class="spot-item" role="button" tabindex="0" aria-pressed="${isActive}" onclick="setFruitFilter('${f.name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setFruitFilter('${f.name}')}" style="${isActive ? 'background:var(--surface-2);' : ''}">
      <h4>${dotHtml(f.color)}${f.name} <span style="font-weight:400;color:var(--ink-2)">${f.ja}</span>${isPeak ? ' <span class="badge ended">Peak</span>' : ''}</h4>
      <div class="sub">Season ${season} · peak ${peak}</div>
      <div class="sub">Best regions: ${f.regions.join(', ')}</div>
      ${farmCount ? `<div class="sub"><span class="num">${farmCount}</span> farms${isActive ? ', shown on the map. Select again to show all.' : '. Select to show them on the map.'}</div>` : ''}
      ${f.note ? `<div class="sub">${f.note}</div>` : ''}
    </div>`;
  }

  const isCurrentMonth = m === todayM;
  let html = `<div class="note">
    Seasons are regional averages. Check with the farm before you go.
    ${scrapedAt ? `<br><span class="muted">Farm list updated ${scrapedAt}.</span>` : ''}
  </div>`;

  if (inSeason.length) {
    html += `<div class="section-head">In season in ${MO[m-1]}${isCurrentMonth ? ' (this month)' : ''}</div>`;
    inSeason.forEach(f => html += fruitCard(f));
  }
  if (comingSoon.length) {
    html += `<div class="section-head">Coming up in ${MO[nextM-1]} and ${MO[nextM2-1]}</div>`;
    comingSoon.forEach(f => html += fruitCard(f));
  }
  if (other.length) {
    html += `<div class="section-head">Other months</div>`;
    other.forEach(f => html += fruitCard(f));
  }

  $('sidebar-content').innerHTML = html;
}

// ── Days vs average helper ──
// normalIso from the API is "M/D" (e.g. "3/24") — no year.
// Parse it against the forecast year so the diff is correct.
function avgDiffLabel(forecastIso, normalIso) {
  if (!forecastIso || !normalIso) return '';
  if (!sakuraDateOk(forecastIso)) return '';
  const forecastDate = new Date(forecastIso);
  let normalDate;
  if (/^\d{1,2}\/\d{1,2}$/.test(normalIso)) {
    const [mo, day] = normalIso.split('/').map(Number);
    normalDate = new Date(forecastDate.getFullYear(), mo - 1, day);
  } else {
    normalDate = new Date(normalIso);
  }
  if (isNaN(normalDate.getTime())) return '';
  const diff = Math.round((forecastDate - normalDate) / 86400000);
  if (Math.abs(diff) < 1) return '';
  const n = Math.abs(diff);
  return ` · ${n} day${n === 1 ? '' : 's'} ${diff < 0 ? 'earlier' : 'later'} than average`;
}

// ── SAKURA ──
function addSakuraCityMarkers() {
  for (const region of (sakuraData?.regions || [])) {
    for (const city of region.cities) {
      const coords = CITY_COORDS[city.cityName];
      if (!coords) continue;
      if (!matchesBloomFilter(cityBloomCategory(city))) continue;
      const color = statusToColor(city.status);
      const radius = statusToRadius(city.status);
      const marker = L.circleMarker(coords, {
        radius, fillColor: color, color: 'white', weight: 2, fillOpacity: 0.9,
      }).addTo(mapInstance);
      marker.bindPopup(`<div style="min-width:180px"><b>${city.cityName}</b> (${city.prefName})<br><b>${statusText(city.status).text}</b><br><span style="font-size:12px;color:var(--ink-2)">Bloom ${fmtDate(city.bloom?.forecast)} · Full bloom ${fmtDate(city.fullBloom?.forecast)}</span></div>`);
      marker.on('click', () => loadPrefSpots(city.prefCode, city.prefName));
      markers.push(marker);
    }
  }
}

async function loadSakura() {
  $('sidebar-header').innerHTML = '<h2>Cherry blossom forecast</h2><p>Forecast cities by region. Select one to see its spots.<span id="sakura-spot-count"></span></p>';
  $('sidebar-content').innerHTML = skeletonHtml();
  updateLegend('sakura');

  // Show bloom filters, reset to 'all'
  bloomFilter = 'all'; bloomFilters.clear();
  const bf = $('bloom-filters');
  if (bf) { bf.hidden = false; bf.querySelectorAll('.filter-pill').forEach((b,i) => b.classList.toggle('active', i===0)); }

  try {
    if (!sakuraData) sakuraData = await api('/api/sakura/forecast');
    clearMarkers();
    const token = mapVersion;
    addSakuraCityMarkers();

    // Render sidebar with regions
    let html = '';
    for (const region of sakuraData.regions) {
      html += `<div class="section-head">${region.nameEn}</div>`;
      for (const city of region.cities) {
        html += cityRowHtml(city);
      }
    }
    $('sidebar-content').innerHTML = html;

    // Upgrade from fast city markers to the full spot cluster after the
    // forecast list has had a chance to paint.
    scheduleMapWork(() => loadAllSpotsOnMap({ token, replaceExisting: true, expectedMode: 'sakura' }));
  } catch (e) {
    $('sidebar-content').innerHTML = errorState('Could not load the cherry blossom forecast', 'loadSakura()');
  }
}

async function loadPrefSpots(prefCode, prefName) {
  pushUrlState({ mode: 'sakura', pref: prefCode });
  $('sidebar-header').innerHTML = `<h2>${esc(prefName)}</h2><p>Cherry blossom spots</p>`;
  $('sidebar-content').innerHTML = skeletonHtml();
  const bf = $('bloom-filters'); if (bf) bf.hidden = true;

  try {
    const data = await api(`/api/sakura/spots?pref=${prefCode}`);
    clearMarkers();

    // Add spots to map
    const bounds = [];
    for (const spot of data.spots) {
      if (!spot.lat || !spot.lon) continue;
      const color = sakuraColor(spot);
      const radius = sakuraRadius(spot);
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius, fillColor: color, color: 'white', weight: 1.5,
        fillOpacity: 0.9,
      }).addTo(mapInstance);
      marker.bindPopup(spotPopupHtml(spot));
      markers.push(marker);
      bounds.push([spot.lat, spot.lon]);
    }
    if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });

    // Sidebar
    const forecastUpdated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Tokyo'}) : 'Unknown';
    const observationUpdated = data.observationUpdated ? new Date(data.observationUpdated).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Tokyo'}) : null;
    $('sidebar-header').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><h2>${esc(prefName)}</h2><p><span class="num">${data.spots.length}</span> spots · forecast ${forecastUpdated}${observationUpdated ? ` · reports ${observationUpdated}` : ''}</p></div>
        <button type="button" class="back-btn" onclick="loadSakura()">Back to all cities</button>
      </div>`;

    let html = '';
    if (data.jmaStation) {
      const jma = data.jmaStation;
      html += `<div class="spot-item" style="background:var(--surface-2);cursor:default">
        <h4>${esc(jma.name)} official observation tree</h4>
        ${bloomBar(jma.bloomRate, jma.fullRate, jma.fullForecast) || '<div class="sub">Past full bloom for this season.</div>'}
      </div>`;

      // Load weather for this city
      loadWeatherCard(jma.name);
    }
    for (const spot of data.spots) {
      html += spotCardHtml(spot);
    }
    if (!data.spots.length) html += stateHtml({ title: 'No spots listed here yet', body: 'Try a neighbouring prefecture on the map.' });
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = errorState('Could not load these spots', `handleSpotClick(${reg({action:'loadPrefSpots',prefCode,prefName})})`);
  }
}

function flyToSpot(spot) {
  const lat = spot?.lat;
  const lon = spot?.lon;
  const name = spot?.name || 'Spot';
  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar').scrollTop = 0;
    mapInstance.invalidateSize();
  }
  mapInstance.flyTo([lat, lon], 14, { duration: 0.8 });
  const phase = sakuraSpotPhase(spot);
  const liveStatus = spotLiveStatus(spot);
  const statusNote = spotStatusNote(spot);
  const statusColor = phase ? sakuraPhaseColor(phase) : C.gray;
  const barHtml = bloomBar(spot);
  const forecastLine = hasSakuraTimelineData(spot?.bloomRate, spot?.fullRate, spot?.bloomForecast, spot?.fullBloomForecast)
    ? `<div style="font-size:12px;color:var(--ink-2)">${spotForecastDates(spot)}</div>`
    : '';
  const statusNoteHtml = statusNote ? `<div style="font-size:12px;color:var(--ink-2)">${statusNote}</div>` : '';
  L.popup().setLatLng([lat, lon])
    .setContent(`<div style="min-width:220px">
      <b>${esc(name)}</b>
      ${barHtml}
      <div style="margin:4px 0;display:flex;align-items:center"><span class="dot" style="background:${statusColor}" aria-hidden="true"></span><b>${esc(liveStatus)}</b></div>
      ${statusNoteHtml}
      ${forecastLine}
      <div class="popup-weather" data-lat="${lat}" data-lon="${lon}" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);min-height:54px">
        <div style="color:var(--ink-2);font-size:12px">Loading weather…</div>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Google Maps</a>
    </div>`)
    .openOn(mapInstance);
}

// ── KOYO ──
async function loadKoyo() {
  $('sidebar-header').innerHTML = '<h2>Autumn leaves forecast</h2><p>Forecast cities by region. Select one to see its spots.<span id="koyo-spot-count"></span></p>';
  $('sidebar-content').innerHTML = skeletonHtml();
  updateLegend('koyo');
  clearMarkers();
  koyoPrefView = null;
  const token = mapVersion;
  setMapPlaceholder(null);
  scheduleMapWork(() => loadAllKoyoSpotsOnMap({ token, expectedMode: 'koyo' }));

  try {
    const data = await api('/api/koyo/forecast');
    const currentYear = Number(new Intl.DateTimeFormat('en', {
      year: 'numeric',
      timeZone: 'Asia/Tokyo',
    }).format(new Date()));
    const dataYear = Number(String(data.lastUpdated || '').slice(0, 4));
    const lastUpdated = data.lastUpdated
      ? new Intl.DateTimeFormat('en-SG', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Tokyo',
        }).format(new Date(data.lastUpdated))
      : null;
    const freshnessBanner = dataYear && dataYear < currentYear
      ? `<div class="note">
          <b>The ${currentYear} autumn leaves forecast is not out yet.</b><br>
          The dates below are from last season's forecast (${lastUpdated || dataYear}). This list updates when Japan Meteorological Corporation publishes the new one.
        </div>`
      : '';
    const fresh = data.freshness || {};
    const issuedLine = lastUpdated && !freshnessBanner
      ? `<p class="koyo-issued${fresh.overdue ? ' is-overdue' : ''}">Forecast issued ${lastUpdated}.${fresh.nextUpdate ? ` Next update ${esc(fresh.nextUpdate.replace(' (planned)', ''))}${fresh.overdue ? ', which is late, so dates may have moved' : ''}.` : ''}</p>`
      : '';
    let html = '<div id="koyo-date-results" aria-live="polite"></div>' + freshnessBanner + issuedLine + '<div id="koyo-city-list">';
    for (const region of data.regions) {
      html += `<div class="section-head">${region.name}</div>`;
      for (const city of region.cities) {
        const mapleDate = city.maple ? fmtDate(city.maple.forecast) : NA;
        const ginkgoDate = city.ginkgo ? fmtDate(city.ginkgo.forecast) : NA;
        const prefCode = city.code.slice(0, 2);
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadKoyoSpots',prefCode:prefCode,name:city.prefNameEn||city.prefName||city.nameEn||city.name})})">
          <h4>${city.nameEn||city.name} <span style="font-weight:400;color:var(--ink-2)">${city.prefNameEn||city.prefName||''}</span></h4>
          <div class="sub">Maple ${mapleDate}${city.maple ? ' ('+String(city.maple.normalDiffClass||'').toLowerCase()+')' : ''} · Ginkgo ${ginkgoDate}</div>
        </div>`;
      }
    }
    $('sidebar-content').innerHTML = html + '</div>';
    if (koyoDateRange) await applyKoyoDates();
  } catch (e) {
    setMapPlaceholder({
      title: 'Autumn leaves forecast unavailable',
      body: 'The forecast did not load. Try again in a moment.'
    });
    $('sidebar-content').innerHTML = errorState('Could not load the autumn leaves forecast', 'loadKoyo()');
  }
}

async function loadKoyoSpots(prefCode, name) {
  pushUrlState({ mode: 'koyo', pref: prefCode });
  $('sidebar-header').innerHTML = `<h2>${esc(name)}</h2><p>Autumn leaves spots</p>`;
  $('sidebar-content').innerHTML = skeletonHtml();
  setMapPlaceholder(null);
  try {
    const data = await api(`/api/koyo/spots?pref=${prefCode}`);
    koyoPrefView = { data, name };
    renderKoyoPrefSpots(data, name);
  } catch (e) {
    $('sidebar-content').innerHTML = errorState('Could not load these spots', `handleSpotClick(${reg({action:'loadKoyoSpots',prefCode,name})})`);
  }
}

function renderKoyoPrefSpots(data, name) {
  clearMarkers({ keepVersion: true });
  updateKoyoFilterCounts(data.spots.filter(koyoInDateRange));
  const visible = data.spots.filter(koyoPhaseVisible);
  const bounds = [];
  for (const spot of visible) {
    if (!spot.lat || !spot.lon) continue;
    const marker = L.circleMarker([spot.lat, spot.lon], { radius: 7, ...koyoMarkerStyle(spot) }).addTo(mapInstance);
    marker.bindPopup(koyoPopupHtml(spot));
    markers.push(marker);
    bounds.push([spot.lat, spot.lon]);
  }
  if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });

  $('sidebar-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><h2>${esc(name)}</h2><p><span class="num">${visible.length}</span> of <span class="num">${data.spots.length}</span> spots${data.reportsAvailable ? '' : ' · spot reports unavailable right now'}</p></div>
      <button type="button" class="back-btn" onclick="loadKoyo()">Back to all cities</button>
    </div>`;

  let html = '';
  for (const spot of visible) {
    const stars = spot.popularity > 0 ? '★'.repeat(spot.popularity) : '';
    html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:spot.lat,lon:spot.lon,popup:koyoPopupHtml(spot)})})">
      <h4>${esc(spot.name)} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${esc(spot.nameRomaji)}</span>` : ''} ${stars ? `<span class="muted" title="Popularity ${spot.popularity} of 3" aria-label="Popularity ${spot.popularity} of 3">${stars}</span>` : ''}</h4>
      <div class="sub"><span class="koyo-swatch" style="display:inline-block;vertical-align:-1px;${koyoSwatchStyle(spot.phase)}"></span> <b>${KOYO_PHASES[spot.phase].label}</b> · ${koyoPhaseSource(spot)}</div>
      <div class="sub">${spot.leafType} &middot; Forecast peak: <strong>${fmtDate(spot.bestPeak)}</strong> (${fmtDate(spot.bestStart)} → ${fmtDate(spot.bestEnd)})
        · <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Maps</a>
      </div>
    </div>`;
  }
  $('sidebar-content').innerHTML = html || stateHtml({ title: 'No spots with this status', body: 'Choose All to see every spot.' });
}

// ── Trip date sync ──
// When the start date changes and the end is now before it, push end forward
// to start + 7 days. When the end date changes and it's before start, pull
// start back to the same day (user is narrowing, not widening).
function syncTripDates(changed) {
  const startEl = $('trip-start');
  const endEl   = $('trip-end');
  if (!startEl || !endEl) return;
  const startVal = startEl.value;
  const endVal   = endEl.value;
  if (!startVal && !endVal) return;

  const fmt = d => d.toISOString().slice(0, 10);

  if (changed === 'start' && startVal) {
    const start = new Date(startVal + 'T00:00:00');
    if (!endVal || new Date(endVal + 'T00:00:00') < start) {
      const newEnd = new Date(start);
      newEnd.setDate(newEnd.getDate() + 7);
      endEl.value = fmt(newEnd);
    }
    // Keep end's min in sync so the browser date picker won't show dates before start
    endEl.min = startVal;
  }

  if (changed === 'end' && endVal) {
    const end = new Date(endVal + 'T00:00:00');
    if (!startVal || new Date(startVal + 'T00:00:00') > end) {
      startEl.value = endVal; // snap start to same day as end
    }
    // Keep start's max in sync
    startEl.max = endVal;
  }
}

// ── Map helpers ──
function clearMarkers(options = {}) {
  if (!options.keepVersion) mapVersion++;
  markers.forEach(m => mapInstance.removeLayer(m));
  markers = [];
  if (clusterGroup) { mapInstance.removeLayer(clusterGroup); clusterGroup = null; }
}

function updateLegend(type) {
  const el = $('legend');
  let body = '';
  if (type === 'sakura') {
    body = `
      <div class="legend-title">Bloom stage</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.dormant}"></div> Dormant</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.bud}"></div> Bud stage</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.budSwell}"></div> Buds swelling</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.budOpen}"></div> Buds opening</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.starting}"></div> Starting to bloom</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.bloom}"></div> Blooming</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.peak}"></div> Full bloom (mankai)</div>
      <div class="legend-row"><div class="legend-dot" style="background:${sakuraPhaseColor('past_peak')}"></div> Past peak (some petals left)</div>
      <div class="legend-row"><div class="legend-dot" style="background:${sakuraPhaseColor('falling')}"></div> Falling petals</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.ended}"></div> Ended (green leaves)</div>
      <div class="legend-row"><div class="legend-square" style="background:${C.kawazu}"></div> Kawazu cherry (early variety)</div>`;
  } else if (type === 'koyo') {
    body = `
      <div class="legend-title">Leaf status</div>
      ${Object.entries(KOYO_PHASES).map(([phase, p]) => `<div class="legend-row"><div class="legend-dot" style="${koyoSwatchStyle(phase)}"></div> ${p.label}</div>`).join('')}
      <div class="legend-note">"Now" means someone at the spot reported it in the last 2 days.</div>`;
  } else if (type === 'flowers') {
    body = `
      <div class="legend-title">Flowers</div>
      ${FLOWER_TYPES.map(ft => `<div class="legend-row"><div class="legend-dot" style="background:${ft.color}"></div> ${ft.name} (${ft.peakLabel})</div>`).join('')}
      <div class="legend-note">Faded dots are out of season this month.</div>`;
  } else if (type === 'whatson') {
    body = `
      <div class="legend-title">Festivals and events</div>
      ${FESTIVAL_TYPES.map(ft => `<div class="legend-row"><div class="legend-square" style="background:${ft.color}"></div> ${ft.name}</div>`).join('')}
      <div class="legend-row"><div class="legend-dot" style="background:white;border:2px solid ${C.flowers}"></div> Flowers in season</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.farmBlue}"></div> Fruit farm</div>`;
  } else {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.className = 'legend';
  el.innerHTML = `<button type="button" class="legend-toggle-btn" aria-expanded="false" onclick="const l=this.closest('.legend');l.classList.toggle('expanded');this.setAttribute('aria-expanded',l.classList.contains('expanded'));this.textContent=l.classList.contains('expanded')?'Hide legend':'Legend'">Legend</button><div class="legend-body">${body}</div>`;
}

// ── FLOWERS ──
let flowersCache = null;
let flowersTypeFilter = 'all'; // 'all', 'wisteria', or 'hydrangea'

async function loadFlowers() {
  $('sidebar-header').innerHTML = '<h2>Seasonal flowers</h2><p>Loading spots…</p>';
  $('sidebar-content').innerHTML = skeletonHtml();
  clearMarkers();
  updateLegend('flowers');

  if (!flowersCache) {
    try { flowersCache = await api('/api/flowers'); } catch (e) {
      $('sidebar-content').innerHTML = errorState('Could not load the flower spots', 'loadFlowers()');
      return;
    }
  }
  flowersTypeFilter = 'all';
  renderFlowers();
}

function renderFlowers() {
  const spots = flowersCache?.spots || [];
  const currentMonth = new Date().getMonth() + 1;

  // Determine which types to show
  const activeTypes = flowersTypeFilter === 'all'
    ? FLOWER_TYPES
    : FLOWER_TYPES.filter(f => f.type === flowersTypeFilter);

  // ── Map markers ──
  clearMarkers();
  for (const spot of spots) {
    if (!spot.lat || !spot.lon) continue;
    const ft = FLOWER_TYPES.find(f => f.type === spot.type);
    if (!ft) continue;
    if (flowersTypeFilter !== 'all' && spot.type !== flowersTypeFilter) continue;

    const isInSeason = ft.months.includes(currentMonth);
    const peakMonths = spot.peakStart ? parseInt(spot.peakStart.split('-')[0]) : null;
    const isPeak = peakMonths === currentMonth;

    const opacity = isInSeason ? 1 : 0.45;
    const marker = L.marker([spot.lat, spot.lon], {
      icon: L.divIcon({
        html: `<div title="${ft.name}" style="background:${ft.color};border:2px solid white;border-radius:50%;width:16px;height:16px;box-shadow:0 1px 4px rgba(0,0,0,0.25);opacity:${opacity}"></div>`,
        className: '', iconSize: [16, 16], iconAnchor: [8, 8],
      })
    });

    const peakLabel = spot.peakStart && spot.peakEnd
      ? `${spot.peakStart.replace(/^0/, '').replace('-', '/')} – ${spot.peakEnd.replace(/^0/, '').replace('-', '/')}`
      : '';

    marker.bindPopup(`<div style="min-width:220px">
      <b>${esc(spot.name)}</b>
      ${spot.nameJa ? `<span style="color:var(--ink-2);font-size:12px;margin-left:4px">${esc(spot.nameJa)}</span>` : ''}
      <div style="margin:6px 0 2px;font-size:12px;color:var(--ink-2)">${dotHtml(ft.color)}${ft.name} · ${esc(spot.prefecture)}</div>
      ${peakLabel ? `<div style="font-size:12px">Peak <b>${peakLabel}</b></div>` : ''}
      ${spot.note ? `<div style="font-size:12px;color:var(--ink-2);margin-top:4px">${esc(spot.note)}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:12px">
        ${spot.url ? `<a href="${esc(spot.url)}" target="_blank" rel="noopener">Official site</a>` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener">Google Maps</a>
      </div>
    </div>`);
    marker.addTo(mapInstance);
    markers.push(marker);
  }

  // ── Sidebar ──
  const isWisteriaSeason = currentMonth >= 4 && currentMonth <= 5;
  const isHydrangeaSeason = currentMonth >= 6 && currentMonth <= 7;
  const isFlowerSeason = isWisteriaSeason || isHydrangeaSeason;

  // Season info banner — dynamic from FLOWER_TYPES
  const inSeasonTypes = FLOWER_TYPES.filter(ft => ft.months.includes(currentMonth));
  let bannerHtml = '';
  if (inSeasonTypes.length > 0) {
    const primary = inSeasonTypes[0];
    const typeList = inSeasonTypes.map(ft => `<b>${ft.name}</b>`).join(', ');
    bannerHtml = `<div class="note">
      <div style="margin-bottom:4px">In season now: ${typeList}</div>
      ${inSeasonTypes.map(ft => `<div class="muted" style="margin-top:4px">${ft.note}</div>`).join('')}
    </div>`;
  } else {
    const nextFt = FLOWER_TYPES.find(ft => ft.months[0] > currentMonth) || FLOWER_TYPES[0];
    bannerHtml = `<div class="note">
      <b>No flowers on this map are in season this month.</b><br>
      Next: <b>${nextFt.name} (${nextFt.peakLabel})</b><br>
      <span class="muted">Dates are typical averages and move with the weather each year.</span>
    </div>`;
  }

  // Type filter tabs — built from FLOWER_TYPES
  const typeTabHtml = `<div class="filter-row" role="group" aria-label="Flower type">
    ${[{type:'all',label:'All'}, ...FLOWER_TYPES.map(ft=>({type:ft.type,label:ft.name,color:ft.color}))].map(({type,label,color}) => {
      const isActive = flowersTypeFilter === type;
      return `<button type="button" class="filter-pill" aria-pressed="${isActive}" onclick="flowersTypeFilter='${type}';renderFlowers()">${color && !isActive ? dotHtml(color).replace('margin-right:6px','') : ''}${label}</button>`;
    }).join('')}
  </div>`;

  // Spot cards grouped by type
  function flowerCard(spot) {
    const ft = FLOWER_TYPES.find(f => f.type === spot.type);
    const peakLabel = spot.peakStart && spot.peakEnd
      ? `${spot.peakStart.slice(0,5).replace('-','/')} – ${spot.peakEnd.slice(0,5).replace('-','/')}`
      : '';
    const isInSeason = ft && ft.months.includes(currentMonth);
    return `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToFarm',lat:spot.lat,lon:spot.lon})})" style="cursor:pointer">
      <h4>${esc(spot.name)} <span style="font-weight:400;color:var(--ink-2)">${esc(spot.nameJa || '')}</span>${isInSeason ? ' <span class="badge ended">In season</span>' : ''}</h4>
      <div class="sub">${esc(spot.prefecture)} · ${esc(spot.region)}</div>
      ${peakLabel ? `<div class="sub">Peak <b>${peakLabel}</b></div>` : ''}
      ${spot.note ? `<div class="sub">${esc(spot.note)}</div>` : ''}
      <div class="sub" style="margin-top:4px">
        ${spot.url ? `<a href="${esc(spot.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Official site</a> · ` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Maps</a>
      </div>
    </div>`;
  }

  let html = bannerHtml + typeTabHtml;

  for (const ft of FLOWER_TYPES) {
    if (flowersTypeFilter !== 'all' && ft.type !== flowersTypeFilter) continue;
    const typeSpots = spots.filter(s => s.type === ft.type);
    const inSeason = typeSpots.filter(s => ft.months.includes(currentMonth));
    const offSeason = typeSpots.filter(s => !ft.months.includes(currentMonth));

    const peakLabel = ft.peakLabel || '';
    html += `<div class="section-head">
      ${dotHtml(ft.color)}${ft.name} (${ft.ja}): <span class="num">${typeSpots.length}</span> spots<span style="display:block;font-weight:400;color:var(--ink-2)">Peak ${peakLabel}</span>
    </div>`;
    html += `<div style="padding:8px 16px 0;font-size:13px;color:var(--ink-2)">${ft.note}</div>`;

    if (inSeason.length) {
      html += `<div style="padding:8px 16px 4px;font-size:13px;font-weight:600">In season now (${inSeason.length})</div>`;
      inSeason.forEach(s => html += flowerCard(s));
    }
    if (offSeason.length) {
      const label = ft.months[0] > currentMonth ? 'Coming up' : 'Past season';
      html += `<div style="padding:8px 16px 4px;font-size:13px;font-weight:600;color:var(--ink-2)">${label} (${offSeason.length})</div>`;
      offSeason.forEach(s => html += flowerCard(s));
    }
  }

  $('sidebar-header').innerHTML = `
    <h2>Seasonal flowers</h2>
    <p><span class="num">${spots.length}</span> spots, ${FLOWER_TYPES.length} kinds of flower, each with its official site</p>`;
  $('sidebar-content').innerHTML = html;
}

// ── Major tourist cities for trip planner ──
const TOURIST_CITIES = {
  // Major tourist destinations
  "tokyo":[35.689,139.692],"osaka":[34.694,135.502],"kyoto":[35.012,135.768],
  "hiroshima":[34.397,132.46],"nara":[34.685,135.833],"kobe":[34.691,135.183],
  "yokohama":[35.448,139.642],"nagoya":[35.18,136.906],"sapporo":[43.062,141.354],
  "fukuoka":[33.59,130.402],"kanazawa":[36.594,136.625],"hakone":[35.233,139.107],
  "nikko":[36.75,139.597],"kamakura":[35.319,139.547],"takayama":[36.146,137.252],
  "matsumoto":[36.238,137.972],"sendai":[38.268,140.872],"hakodate":[41.769,140.729],
  "nagasaki":[32.745,129.873],"kumamoto":[32.803,130.707],"kagoshima":[31.596,130.557],
  "okayama":[34.662,133.935],"miyajima":[34.296,132.319],"naoshima":[34.46,133.995],
  "beppu":[33.28,131.491],"fuji":[35.361,138.727],"kawaguchiko":[35.514,138.752],
  "shirakawago":[36.257,136.906],"izu":[34.772,138.946],"uji":[34.884,135.808],
  "aomori":[40.824,140.74],"akita":[39.717,140.103],"morioka":[39.702,141.153],
  "matsue":[35.472,133.051],"takamatsu":[34.34,134.043],"matsuyama":[33.842,132.766],
  "okinawa":[26.334,127.8],"naha":[26.334,127.8],
  "niigata":[37.916,139.036],"toyama":[36.695,137.211],"gifu":[35.423,136.761],
  "kofu":[35.664,138.568],"nagano":[36.651,138.181],"shizuoka":[34.977,138.383],
  "hamamatsu":[34.71,137.727],"utsunomiya":[36.555,139.883],"maebashi":[36.391,139.061],
  // All koyo/sakura JMA observation cities not already covered above
  "asahikawa":[43.771,142.364],"obihiro":[42.918,143.197],"kushiro":[42.975,144.375],
  "muroran":[42.315,140.974],"yamagata":[38.240,140.363],"fukushima":[37.760,140.474],
  "mito":[36.341,140.446],"kumagaya":[36.147,139.388],"choshi":[35.735,140.853],
  "fukui":[36.065,136.219],"hikone":[35.274,136.255],"wakayama":[34.231,135.167],
  "tottori":[35.501,134.237],"shimonoseki":[33.955,130.921],"tokushima":[34.066,134.559],
  "kochi":[33.560,133.531],"saga":[33.249,130.299],"oita":[33.238,131.612],
  "miyazaki":[31.911,131.423],"tsu":[34.730,136.508],
};

// City → prefecture code (for koyo/sakura spot lookup in trip planner)
const CITY_PREF = {
  "tokyo":"13","yokohama":"14","kamakura":"14","hakone":"14","kawaguchiko":"19","fuji":"22","izu":"22",
  "osaka":"27","kyoto":"26","nara":"29","kobe":"28","uji":"26",
  "hiroshima":"34","miyajima":"34","okayama":"33","naoshima":"37",
  "sapporo":"01","hakodate":"01","asahikawa":"01","obihiro":"01","kushiro":"01","muroran":"01",
  "aomori":"02","morioka":"03","sendai":"04","akita":"05","yamagata":"06","fukushima":"07",
  "mito":"08","utsunomiya":"09","nikko":"09","maebashi":"10","kumagaya":"11","choshi":"12",
  "kofu":"19","nagano":"20","matsumoto":"20",
  "niigata":"15","toyama":"16","kanazawa":"17","shirakawago":"17","fukui":"18",
  "shizuoka":"22","gifu":"21","nagoya":"23","takayama":"21","tsu":"24",
  "hikone":"25","matsue":"32","tottori":"31","wakayama":"30",
  "okayama":"33","hiroshima":"34","shimonoseki":"35",
  "takamatsu":"37","matsuyama":"38","tokushima":"36","kochi":"39",
  "fukuoka":"40","saga":"41","nagasaki":"42","kumamoto":"43","oita":"44","beppu":"44",
  "miyazaki":"45","kagoshima":"46","okinawa":"47","naha":"47",
  "hamamatsu":"22","uji":"26","izu":"22","miyajima":"34","naoshima":"37",
};

// Popular cities for quick-pick chips
const QUICK_CITIES = [
  "Tokyo","Kyoto","Osaka","Hiroshima","Sapporo","Hakone","Nara","Kanazawa",
  "Nikko","Fukuoka","Yokohama","Kawaguchiko","Takayama","Nagasaki",
];

let selectedTripCities = new Set();

function toggleCity(city, el) {
  if (selectedTripCities.has(city)) {
    selectedTripCities.delete(city);
    el.classList.remove('active');
  } else {
    selectedTripCities.add(city);
    el.classList.add('active');
  }
}

function renderFreetextTags() {
  const container = $('city-freetext-tags');
  if (!container) return;
  // Only show tags for cities added via free text (not chip selections)
  const chipCities = new Set(QUICK_CITIES.map(c => c.toLowerCase()));
  const freeTags = [...selectedTripCities].filter(c => !chipCities.has(c));
  container.innerHTML = freeTags.map(c =>
    `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 8px;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;font-size:13px">
      ${c.charAt(0).toUpperCase()+c.slice(1)}
      <button type="button" onclick="removeFreetextCity('${c}')" aria-label="Remove ${c}" style="background:none;border:none;color:var(--ink-2);font-size:16px;line-height:1;padding:2px 4px">×</button>
    </span>`
  ).join('');
}

function removeFreetextCity(city) {
  selectedTripCities.delete(city);
  renderFreetextTags();
}

function addTypedCities() {
  const input = $('city-freetext');
  const errEl = $('city-freetext-err');
  if (!input) return;
  const names = input.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return;
  const notFound = [];
  for (const name of names) {
    if (TOURIST_CITIES[name]) {
      selectedTripCities.add(name);
    } else {
      // Fuzzy: try substring match
      const match = Object.keys(TOURIST_CITIES).find(k => k.startsWith(name) || name.startsWith(k));
      if (match) { selectedTripCities.add(match); }
      else notFound.push(name);
    }
  }
  input.value = '';
  errEl.textContent = notFound.length
    ? `Not found: ${notFound.join(', ')}. Try a nearby city or check the spelling.`
    : '';
  renderFreetextTags();
}

// Add a koyo city to the trip planner and re-run
function selectKoyoCityForTrip(cityName) {
  const input = $('city-freetext');
  if (input) { input.value = cityName; addTypedCities(); }
  searchTrip();
}

function haversineKm(lat1,lon1,lat2,lon2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Trip Planner ──
let tripMonth = new Date().getMonth() + 1;

function selectTripMonth(m, el) {
  tripMonth = m;
  document.querySelectorAll('.trip-month-pill').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function loadTripPlanner() {
  selectedTripCities = new Set();
  $('sidebar-header').innerHTML = '<h2>Plan a trip</h2><p>Pick your dates and cities to see what will be in season.</p>';
  updateLegend(KOYO_MONTHS.includes(new Date().getMonth() + 1) ? 'koyo' : 'sakura');

  // Default dates: today + 7 days
  const today = new Date();
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  const fmt = d => d.toISOString().slice(0, 10);
  const chips = QUICK_CITIES.map(c =>
    `<button type="button" class="city-chip" onclick="toggleCity('${c.toLowerCase()}',this);this.setAttribute('aria-pressed',this.classList.contains('active'))" aria-pressed="false">${c}</button>`
  ).join('');

  $('sidebar-content').innerHTML = `
    <div style="padding:16px 16px 12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px" id="trip-dates-label">Travel dates</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px" role="group" aria-labelledby="trip-dates-label">
        <input type="date" id="trip-start" aria-label="Start date" value="${fmt(today)}" onchange="syncTripDates('start')" style="flex:1;min-width:0;min-height:36px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)">
        <span style="color:var(--ink-2);font-size:13px">to</span>
        <input type="date" id="trip-end" aria-label="End date" value="${fmt(nextWeek)}" min="${fmt(today)}" onchange="syncTripDates('end')" style="flex:1;min-width:0;min-height:36px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)">
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Where are you going? <span style="color:var(--ink-2);font-weight:400">Optional. Leave blank for all of Japan.</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">${chips}</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <label for="city-freetext" class="sr-only">Other cities</label>
        <input type="text" id="city-freetext" placeholder="Other cities, separated by commas" style="flex:1;min-width:0;min-height:36px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-size:14px" onkeydown="if(event.key==='Enter')addTypedCities()">
        <button type="button" onclick="addTypedCities()" style="min-height:36px;padding:0 12px;background:var(--surface);color:var(--ink);border:1px solid var(--ink-2);border-radius:6px;font-size:14px;white-space:nowrap">Add</button>
      </div>
      <div id="city-freetext-tags" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px"></div>
      <div id="city-freetext-err" role="alert" style="font-size:13px;color:var(--danger);min-height:16px;margin-bottom:4px"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <label for="trip-radius" style="font-size:13px;color:var(--ink-2);white-space:nowrap">Within</label>
        <select id="trip-radius" style="min-height:36px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);font-size:14px">
          <option value="15">15 km</option>
          <option value="30" selected>30 km</option>
          <option value="50">50 km</option>
          <option value="100">100 km</option>
        </select>
        <button type="button" class="primary-btn" onclick="searchTrip()" style="flex:1">Show what's in season</button>
      </div>
    </div>
    <div id="trip-results"></div>`;
}

async function searchTrip() {
  const startVal = $('trip-start')?.value;
  const endVal = $('trip-end')?.value;
  if (!startVal || !endVal) { $('trip-results').innerHTML = stateHtml({ title: 'Pick both travel dates', error: true }); return; }
  const startDate = new Date(startVal), endDate = new Date(endVal);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) { $('trip-results').innerHTML = stateHtml({ title: 'Those dates don\'t look right', body: 'Use the date picker to choose them.', error: true }); return; }

  const midMs = (startDate.getTime() + endDate.getTime()) / 2;
  const m = new Date(midMs).getMonth() + 1;
  tripMonth = m;

  // Resolve cities from chips (selectedTripCities is a Set of lowercase names)
  const resolved = [], unknown = [];
  for (const city of selectedTripCities) {
    const coords = TOURIST_CITIES[city];
    if (coords) resolved.push({ name: city, lat: coords[0], lon: coords[1] });
    else unknown.push(city);
  }
  const noCities = resolved.length === 0;
  const radiusKm = parseInt($('trip-radius').value);

  $('trip-results').innerHTML = skeletonHtml(3);

  try {
    const isSakuraSeason = SAKURA_MONTHS.includes(m);
    const isKoyoSeason = KOYO_MONTHS.includes(m);
    const inSeasonFruits = FRUITS.filter(f => f.months.includes(m));

    // Parallel data fetches
    const fetches = [];
    if (!allSpotsData && isSakuraSeason) fetches.push(api('/api/sakura/all-spots').then(d => { allSpotsData = d; }));
    if (!farmDataCache) fetches.push(api('/api/fruit/farms').then(d => { farmDataCache = d; }).catch(() => {}));

    let bestCities = [];
    if (isSakuraSeason) fetches.push(api(`/api/sakura/best?start=${startVal}&end=${endVal}`).then(d => { bestCities = d.matches || []; }).catch(() => {}));

    // Koyo forecast for no-city trip view (inline city list)
    let tripKoyoForecast = null;
    if (isKoyoSeason && noCities) {
      fetches.push(api(`/api/koyo/best?start=${startVal}&end=${endVal}`).then(d => { tripKoyoForecast = d; }).catch(() => {}));
    }

    // Koyo pref codes for selected cities
    let koyoData = null;
    if (isKoyoSeason && !noCities) {
      const prefCodes = [...new Set(resolved.map(c => CITY_PREF[c.name]).filter(Boolean))];
      if (prefCodes.length) {
        fetches.push(
          Promise.all(prefCodes.map(pc => api(`/api/koyo/spots?pref=${pc}`).catch(() => ({ spots: [] }))))
            .then(results => { koyoData = results.flatMap(r => r.spots || []); })
        );
      }
    }

    await Promise.all(fetches);
    clearMarkers();
    const bounds = [];

    function nearCity(lat, lon) {
      for (const city of resolved) {
        const d = haversineKm(city.lat, city.lon, lat, lon);
        if (d <= radiusKm) return { city: city.name, dist: Math.round(d) };
      }
      return null;
    }

    // ── No-city mode: Japan-wide view ──
    if (noCities) {
      // Show individual sakura spots on map (clustered by status color)
      if (isSakuraSeason && allSpotsData) {
        const sakuraCluster = L.markerClusterGroup({ maxClusterRadius: CLUSTER_RADIUS, showCoverageOnHover: false,
          iconCreateFunction: cluster => {
            const n = cluster.getChildCount();
            const sz = clusterSize(n);
            return L.divIcon({ html: `<div style="background:${C.bloom};color:${inkOn(C.bloom)};width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${n}</div>`, className: '', iconSize: [sz, sz] });
          }
        });
        for (const spot of allSpotsData.spots) {
          if (!spot.lat || !spot.lon) continue;
          // Use date-aware filtering: hide spots past their viewing window for the trip dates
          const state = tripSakuraState(spot);
          if (!state.show) continue;
          const col = sakuraColor(spot);
          const mk = L.circleMarker([spot.lat, spot.lon], { radius: 6, fillColor: col, color: 'white', weight: 1, fillOpacity: 0.85 });
          mk.bindPopup(spotPopupHtml(spot));
          sakuraCluster.addLayer(mk);
        }
        mapInstance.addLayer(sakuraCluster);
        markers.push(sakuraCluster);
      } else if (isSakuraSeason && bestCities.length) {
        // Fallback: city-level circles until allSpots loads
        for (const c of bestCities.slice(0, 20)) {
          const coords = TOURIST_CITIES[c.cityName?.toLowerCase()] || TOURIST_CITIES[c.prefName?.toLowerCase()];
          if (!coords) continue;
          const col = c.status?.includes('Full Bloom') ? C.bloom : c.status?.includes('Blooming') ? C.blooming : C.starting;
          const mk = L.circleMarker(coords, { radius: 10, fillColor: col, color: 'white', weight: 2, fillOpacity: 0.9 });
          mk.bindPopup(`<b>${c.cityName}</b><br>${c.prefName}<br>${esc(statusText(c.status).text)}<br>Full bloom ${sakuraDateOk(c.fullBloom?.forecast) ? fmtDate(c.fullBloom.forecast) : NA}`);
          mk.addTo(mapInstance);
          markers.push(mk);
          bounds.push(coords);
        }
      }
      if (bounds.length) mapInstance.fitBounds(bounds, { padding: [40, 40] });
      else mapInstance.setView([36.5, 136.5], 5);

      // All in-season fruit farms (Japan-wide)
      const farms = farmDataCache?.spots || [];
      const seasonFarms = farms.filter(f => f.lat && f.lon && f.fruits?.some(fr => FRUITS.find(ff => ff.name === fr && ff.months.includes(m))));
      if (seasonFarms.length) {
        clusterGroup = L.markerClusterGroup({ maxClusterRadius: CLUSTER_RADIUS, showCoverageOnHover: false,
          iconCreateFunction: cluster => {
            const n = cluster.getChildCount();
            const sz = clusterSize(n);
            return L.divIcon({ html: `<div style="background:${C.farmBlue};color:${inkOn(C.farmBlue)};width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
          }
        });
        for (const farm of seasonFarms) {
          const mk = L.marker([farm.lat, farm.lon], {
            icon: L.divIcon({ html: `<div style="background:${C.farmBlue};border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 1px 4px rgba(0,0,0,0.2)"></div>`, className: '', iconSize: [14, 14], iconAnchor: [7, 7] })
          });
          mk.bindPopup(farmPopupHtml(farm, m));
          clusterGroup.addLayer(mk);
        }
        mapInstance.addLayer(clusterGroup);
      }

      // ── Sidebar (no-city) ──
      const seasonItems = [];
      if (isSakuraSeason) seasonItems.push(`Cherry blossom${m >= 3 && m <= 4 ? ' (peak season)' : ''}`);
      if (inSeasonFruits.length) seasonItems.push(`Fruit picking: ${inSeasonFruits.map(f=>f.name).join(', ')}`);
      if (isKoyoSeason) seasonItems.push(`Autumn leaves${m >= 10 && m <= 11 ? ' (peak season)' : ''}`);
      if (!seasonItems.length) seasonItems.push('Between the main seasons. Try the Festivals and Flowers views.');

      const spotCount = allSpotsData?.spots?.length || 0;
      let html = `<div class="note">
        <b>Across Japan in ${MO[m-1]}:</b>${seasonItems.map(s=>`<div style="margin-top:4px">${s}</div>`).join('')}
        <div class="muted" style="margin-top:8px">${isSakuraSeason && spotCount ? `${spotCount.toLocaleString('en-US')} cherry blossom spots on the map. ` : ''}Pick cities above to narrow it down.</div>
      </div>`;

      if (isSakuraSeason && bestCities.length) {
        html += `<div class="section-head">Best cherry blossom cities for ${fmtDate(startVal + 'T00:00:00+09:00')} to ${fmtDate(endVal + 'T00:00:00+09:00')}</div>`;
        bestCities.slice(0, 12).forEach(c => {
          const st = statusText(c.status);
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:c.prefCode,prefName:c.prefName})})">
            <h4>${c.cityName} <span style="font-weight:400;color:var(--gray-400)">${c.prefName}</span></h4>
            <div class="sub"><span class="badge ${st.cls}">${esc(st.text)}</span> · Full bloom ${sakuraDateOk(c.fullBloom?.forecast) ? fmtDate(c.fullBloom.forecast) : NA}</div>
          </div>`;
        });
      }
      if (inSeasonFruits.length) {
        html += `<div class="section-head">Fruit picking: ${seasonFarms.length.toLocaleString('en-US')} farms across Japan</div>`;
        html += `<div style="padding:8px 16px;font-size:13px;color:var(--ink-2)">Pick cities above to see farms near them.</div>`;
      }
      if (isKoyoSeason) {
        // Same city rule as the koyo_best_dates MCP tool.
        const peakCities = tripKoyoForecast?.cities || [];
        html += `<div class="section-head">Autumn leaves: cities at peak on your dates</div>`;
        if (peakCities.length) {
          peakCities.slice(0, 10).forEach(c => {
            const name = c.nameEn || c.name;
            const pref = c.prefNameEn || c.prefName;
            const maple = c.maple?.forecast ? fmtDate(c.maple.forecast) : null;
            const ginkgo = c.ginkgo?.forecast ? fmtDate(c.ginkgo.forecast) : null;
            const diff = c.maple?.normalDiffClass || c.ginkgo?.normalDiffClass || '';
            html += `<div class="spot-item" onclick="selectKoyoCityForTrip('${esc(name)}')">
              <h4>${esc(name)} <span style="font-weight:400;color:var(--gray-400)">${esc(pref)}</span></h4>
              <div class="sub">${maple ? `Maple: ${maple}` : ''}${ginkgo ? ` · Ginkgo: ${ginkgo}` : ''}${diff ? ` · ${diff}` : ''}</div>
            </div>`;
          });
        } else if (tripKoyoForecast) {
          html += stateHtml({ title: 'No cities at peak on these dates', body: 'Try other dates, or open the Autumn leaves view.' });
        }
      }
      $('trip-results').innerHTML = html;
      return;
    }

    // ── City-based mode ──

    // City pin markers
    for (const city of resolved) {
      const pin = L.marker([city.lat, city.lon], {
        icon: L.divIcon({
          html: `<div style="background:var(--ink);width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
          className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        })
      }).addTo(mapInstance);
      pin.bindPopup(`<b>${city.name.charAt(0).toUpperCase()+city.name.slice(1)}</b>`);
      markers.push(pin);
      bounds.push([city.lat, city.lon]);
    }

    // ── Sakura spots — predict state at trip dates, hide the fully post-peak tail ──
    // fullBloomForecast = date trees reach 100%. We keep spots only while the
    // trip still overlaps a useful viewing window, rather than showing green / falling dots.
    function tripSakuraState(spot) {
      const DAY_MS = 86400000;
      const fullBloom = spot.fullBloomForecast && sakuraDateOk(spot.fullBloomForecast)
        ? new Date(spot.fullBloomForecast) : null;
      const bloomStart = spot.bloomForecast && sakuraDateOk(spot.bloomForecast)
        ? new Date(spot.bloomForecast)
        : fullBloom ? new Date(fullBloom.getTime() - 10 * DAY_MS) : null;
      const peakStart = fullBloom ? new Date(fullBloom.getTime() - 3 * DAY_MS) : null;
      const peakEnd = fullBloom ? new Date(fullBloom.getTime() + 3 * DAY_MS) : null;
      const pastPeakEnd = fullBloom ? new Date(fullBloom.getTime() + 6 * DAY_MS) : null;

      // No usable forecast → fall back to current live data, but still drop
      // post-peak spots from the planner.
      if (!fullBloom) {
        const phase = sakuraPhase(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
        const show = !isPostPeakSakuraPhase(phase);
        return { show, phase };
      }

      // Trip is entirely after the worthwhile post-peak window → hide
      if (startDate > pastPeakEnd) return { show: false };

      // Trip is entirely before bloom starts → not yet open (bud)
      if (endDate < bloomStart) return { show: true, phase: 'bud_swell' };

      // Trip is before peak but bloom should be underway
      if (endDate < peakStart) return { show: true, phase: 'blooming' };

      // Trip is after the best viewing window but still within the "some petals left" period
      if (startDate > peakEnd) return { show: true, phase: 'past_peak' };

      // Otherwise the trip overlaps the best viewing window
      return { show: true, phase: 'peak' };
    }

    // Trip-context display labels — what the spot will be like during the trip,
    // not what it is live today.
    const TRIP_PHASE_LABELS = {
      bud_swell:  'Not yet open during your trip',
      blooming:   'Opening during your trip',
      peak:       'Full bloom during your trip',
      past_peak:  'Just past peak during your trip',
      falling:    'Petals falling during your trip',
      ended:      'Bloom over by your trip',
    };
    function asTripSpot(spot) {
      const ph = spot._tripPhase;
      if (!ph) return spot;
      return {
        ...spot,
        phase: ph,
        displayStatus: TRIP_PHASE_LABELS[ph] || spotDisplayStatus(spot),
        statusSource: 'estimate',
        // Clear live observation fields so popup doesn't show stale "observed today" notes
        observationUpdated: null,
        observationFresh: false,
        observationStatus: null,
        statusUpdated: null,
      };
    }

    const nearbySakura = [];
    if (isSakuraSeason && allSpotsData) {
      for (const spot of allSpotsData.spots) {
        if (!spot.lat || !spot.lon) continue;
        const nc = nearCity(spot.lat, spot.lon);
        if (!nc) continue;
        const state = tripSakuraState(spot);
        if (state.show) nearbySakura.push({ ...spot, ...nc, _tripPhase: state.phase, _tripColor: sakuraPhaseColor(state.phase) });
      }
      nearbySakura.sort((a, b) => a.dist - b.dist);
    }

    // ── Fruit farms ──
    const nearbyFarms = [];
    for (const farm of (farmDataCache?.spots || [])) {
      if (!farm.lat || !farm.lon) continue;
      const inSeason = farm.fruits?.some(fr => FRUITS.find(f => f.name === fr && f.months.includes(m)));
      if (!inSeason) continue;
      const nc = nearCity(farm.lat, farm.lon);
      if (nc) nearbyFarms.push({ ...farm, ...nc });
    }
    nearbyFarms.sort((a, b) => a.dist - b.dist);

    // ── Koyo spots (Oct–Dec) ──
    const nearbyKoyo = [];
    if (koyoData) {
      for (const spot of koyoData) {
        if (!spot.lat || !spot.lon) continue;
        const nc = nearCity(spot.lat, spot.lon);
        if (nc) nearbyKoyo.push({ ...spot, ...nc });
      }
      nearbyKoyo.sort((a, b) => a.dist - b.dist);
    }

    // Sakura cluster — color reflects predicted state at trip dates
    if (nearbySakura.length) {
      const clusterColor = nearbySakura.some(s => s._tripPhase === 'peak')
        ? sakuraPhaseColor('peak')
        : nearbySakura.some(s => s._tripPhase === 'past_peak')
          ? sakuraPhaseColor('past_peak')
          : nearbySakura.some(s => s._tripPhase === 'blooming')
            ? sakuraPhaseColor('blooming')
            : sakuraPhaseColor('bud_swell');
      clusterGroup = L.markerClusterGroup({ maxClusterRadius: CLUSTER_RADIUS, showCoverageOnHover: false,
        iconCreateFunction: cluster => {
          const n = cluster.getChildCount();
          const sz = clusterSize(n);
          return L.divIcon({ html: `<div style="background:${clusterColor};color:${inkOn(clusterColor)};width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
        }
      });
      for (const spot of nearbySakura) {
        const mk = L.circleMarker([spot.lat, spot.lon], {
          radius: 7,
          fillColor: spot._tripColor,
          color: 'white', weight: 1.5, fillOpacity: 0.9,
        });
        mk.bindPopup(spotPopupHtml(asTripSpot(spot)));
        clusterGroup.addLayer(mk);
        bounds.push([spot.lat, spot.lon]);
      }
      mapInstance.addLayer(clusterGroup);
    }

    // Fruit markers
    for (const farm of nearbyFarms) {
      const mk = L.marker([farm.lat, farm.lon], {
        icon: L.divIcon({ html: `<div style="background:${C.farmBlue};border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 1px 4px rgba(0,0,0,0.2)"></div>`, className: '', iconSize: [14, 14], iconAnchor: [7, 7] })
      });
      mk.bindPopup(farmPopupHtml(farm, m));
      mk.addTo(mapInstance);
      markers.push(mk);
      bounds.push([farm.lat, farm.lon]);
    }

    // Koyo markers (orange dots)
    for (const spot of nearbyKoyo) {
      const mk = L.circleMarker([spot.lat, spot.lon], { radius: 7, ...koyoMarkerStyle(spot) });
      mk.bindPopup(koyoPopupHtml(spot));
      mk.addTo(mapInstance);
      markers.push(mk);
      bounds.push([spot.lat, spot.lon]);
    }

    if (bounds.length > resolved.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });

    // ── Sidebar (city-based) ──
    const cityLabel = resolved.map(c => c.name.charAt(0).toUpperCase()+c.name.slice(1)).join(', ');
    const sakuraPeakCount = nearbySakura.filter(s => s._tripPhase === 'peak').length;
    const sakuraPastPeakCount = nearbySakura.filter(s => s._tripPhase === 'past_peak').length;
    const sakuraOpeningCount = nearbySakura.filter(s => s._tripPhase === 'blooming').length;
    const sakuraBudCount = nearbySakura.filter(s => s._tripPhase === 'bud_swell').length;
    const seasonItems = [];
    if (isSakuraSeason) {
      if (nearbySakura.length > 0) {
        const sakuraParts = [];
        if (sakuraPeakCount) sakuraParts.push(`${sakuraPeakCount} near peak`);
        if (sakuraPastPeakCount) sakuraParts.push(`${sakuraPastPeakCount} just past peak`);
        if (sakuraOpeningCount) sakuraParts.push(`${sakuraOpeningCount} opening`);
        if (sakuraBudCount) sakuraParts.push(`${sakuraBudCount} coming soon`);
        seasonItems.push(`Cherry blossom: ${nearbySakura.length} spots match your dates${sakuraParts.length ? ` (${sakuraParts.join(', ')})` : ''}`);
      } else {
        seasonItems.push('Cherry blossom: mostly past peak for these cities and dates');
      }
    }
    if (inSeasonFruits.length) seasonItems.push(`Fruit picking: ${inSeasonFruits.map(f=>f.name).join(', ')}`);
    if (isKoyoSeason) seasonItems.push(`Autumn leaves${m >= 10 && m <= 11 ? ' (peak season)' : ''}`);
    if (!seasonItems.length) seasonItems.push('Between the main seasons. Try the Festivals and Flowers views.');

    let html = `<div class="note">
      <b>${MO[m-1]} near ${cityLabel}:</b>
      ${seasonItems.map(s=>`<div style="margin-top:4px">${s}</div>`).join('')}
    </div>`;

    // Sakura section
    if (isSakuraSeason) {
      if (nearbySakura.length) {
        const stateParts = [];
        if (sakuraPeakCount) stateParts.push(`${sakuraPeakCount} near peak`);
        if (sakuraPastPeakCount) stateParts.push(`${sakuraPastPeakCount} just past peak`);
        if (sakuraOpeningCount) stateParts.push(`${sakuraOpeningCount} opening`);
        if (sakuraBudCount) stateParts.push(`${sakuraBudCount} coming soon`);
        const stateNote = stateParts.join(', ') || 'matched to your dates';
        html += `<div class="section-head">Cherry blossom: ${nearbySakura.length} spots match your dates (${stateNote})</div>`;
        nearbySakura.slice(0, 20).forEach(spot => {
          html += spotCardHtml(asTripSpot(spot), `${spot.dist}km from ${spot.city.charAt(0).toUpperCase()+spot.city.slice(1)}`);
        });
        if (nearbySakura.length > 20) html += `<div class="sub" style="padding:8px 16px">${nearbySakura.length - 20} more on the map</div>`;
      } else {
        html += `<div class="section-head">Cherry blossom: over for ${cityLabel} in ${MO[m-1]}</div>`;
        html += `<div style="padding:12px 16px;font-size:13px;color:var(--ink-2)">The trees here are green by ${MO[m-1]}. Hokkaido blooms last, usually in early May.</div>`;
      }
    }

    // Fruit section
    if (inSeasonFruits.length) {
      html += `<div class="section-head">Fruit picking: ${nearbyFarms.length} farms within ${radiusKm} km</div>`;
      if (nearbyFarms.length) {
        nearbyFarms.slice(0, 15).forEach(farm => {
          const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToFarm',lat:farm.lat,lon:farm.lon})})">
            <h4>${esc(farm.name)}</h4>
            <div class="sub">${farm.dist} km · ${(farm.fruits||[]).map(esc).join(', ')}</div>
            <div class="sub">${esc(farm.address||'')}${farm.url ? ` · <a href="${esc(farm.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View on ${srcLabel}</a>` : ''}</div>
          </div>`;
        });
        if (nearbyFarms.length > 15) html += `<div class="sub" style="padding:8px 16px">${nearbyFarms.length - 15} more on the map</div>`;
      } else {
        html += stateHtml({ title: `No farms within ${radiusKm} km in ${MO[m-1]}`, body: 'Try a larger distance.' });
      }
    }

    // Koyo section
    if (isKoyoSeason) {
      html += `<div class="section-head">Autumn leaves: ${nearbyKoyo.length} spots within ${radiusKm} km</div>`;
      if (nearbyKoyo.length) {
        nearbyKoyo.slice(0, 12).forEach(spot => {
          const stars = spot.popularity > 0 ? '★'.repeat(spot.popularity) : '';
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:spot.lat,lon:spot.lon})})">
            <h4>${esc(spot.name)} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--ink-2)">${esc(spot.nameRomaji)}</span>` : ''} ${stars ? `<span class="muted" aria-label="Popularity ${spot.popularity} of 3">${stars}</span>` : ''}</h4>
            <div class="sub">${spot.dist} km · peak <strong>${fmtDate(spot.bestPeak)}</strong> · ${KOYO_PHASES[spot.phase].label}</div>
          </div>`;
        });
        if (nearbyKoyo.length > 12) html += `<div class="sub" style="padding:8px 16px">${nearbyKoyo.length - 12} more on the map</div>`;
      } else {
        html += stateHtml({ title: 'No autumn leaves spots near here', body: 'Try a nearby city.' });
      }
    }

    $('trip-results').innerHTML = html;
  } catch (e) {
    $('trip-results').innerHTML = errorState('Could not check these dates', 'searchTrip()');
  }
}

// ── Find Near Me (geolocation) ──
async function findNearMe() {
  if (!navigator.geolocation) {
    $('sidebar-content').innerHTML = stateHtml({ title: 'This browser can\'t share your location', body: 'Search for a city instead.', error: true });
    return;
  }

  $('btn-nearme-label').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    $('btn-nearme-label').textContent = 'Near me';

    $('sidebar-header').innerHTML = `<h2>Near you</h2><p>Cherry blossom spots within 30 km</p>`;
    $('sidebar-content').innerHTML = skeletonHtml();
    updateLegend('sakura');

    try {
      if (!allSpotsData) allSpotsData = await api('/api/sakura/all-spots');
      clearMarkers();

      // Your location marker
      const myMarker = L.marker([lat, lon], {
        icon: L.divIcon({
          html: '<div style="background:#3b82f6;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
          className: '', iconSize: [16, 16], iconAnchor: [8, 8],
        })
      }).addTo(mapInstance);
      myMarker.bindPopup('<b>You are here</b>');
      markers.push(myMarker);

      // Find spots within 30km
      const nearby = [];
      for (const spot of allSpotsData.spots) {
        if (!spot.lat || !spot.lon) continue;
        const dist = haversineKm(lat, lon, spot.lat, spot.lon);
        if (dist <= 30) {
          nearby.push({ ...spot, distance: Math.round(dist * 10) / 10 });
        }
      }
      nearby.sort((a, b) => a.distance - b.distance);

      // Add to map
      for (const spot of nearby) {
        const color = sakuraColor(spot);
        const marker = L.circleMarker([spot.lat, spot.lon], {
          radius: sakuraRadius(spot),
          fillColor: color, color: 'white', weight: 1.5, fillOpacity: 0.9,
        }).addTo(mapInstance);
        marker.bindPopup(spotPopupHtml(spot));
        markers.push(marker);
      }

      mapInstance.setView([lat, lon], 12);

      // Sidebar
      $('sidebar-header').innerHTML = `<h2>Near you</h2><p><span class="num">${nearby.length}</span> cherry blossom spots within 30 km</p>`;
      let html = '';
      for (const spot of nearby) {
        html += spotCardHtml(spot, `${spot.distance} km away`);
      }
      if (nearby.length === 0) {
        html = stateHtml({ title: 'No cherry blossom spots within 30 km', body: 'The map covers Japan only. Search for a city to look elsewhere.' });
      }
      $('sidebar-content').innerHTML = html;
    } catch (e) {
      $('sidebar-content').innerHTML = errorState('Could not load nearby spots', 'findNearMe()');
    }
  }, (err) => {
    $('btn-nearme-label').textContent = 'Near me';
    $('sidebar-content').innerHTML = stateHtml({ title: 'Could not get your location', body: 'Allow location access for this site, then try again.', retry: 'findNearMe()', error: true });
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// ── Shared spot popup/card HTML builders ──

function spotPopupHtml(spot) {
  const displayName = spot.nameRomaji ? `${esc(spot.name)} <span style="color:var(--ink-2)">${esc(spot.nameRomaji)}</span>` : esc(spot.name);
  const phase = sakuraSpotPhase(spot);
  const liveStatus = spotLiveStatus(spot);
  const barsHtml = bloomBar(spot);
  const statusNote = spotStatusNote(spot);

  // Link to JMA prefecture forecast text page (shows city-level table directly)
  // Hokkaido (01) has multiple offices — default to Sapporo/Ishikari area
  const prefCode = spot.code?.slice(0, 2);
  const jmaOffice = prefCode === '01' ? '015010' : prefCode ? `${prefCode}0000` : null;
  const jmaUrl = jmaOffice
    ? `https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${jmaOffice}`
    : `https://www.jma.go.jp/bosai/map.html#5/${spot.lat?.toFixed(2)}/${spot.lon?.toFixed(2)}/&contents=forecast`;

  const statusColor = phase ? sakuraPhaseColor(phase) : C.gray;
  return `<div style="min-width:220px">
    <b>${displayName}</b>
    ${barsHtml}
    <div style="margin:4px 0;display:flex;align-items:center"><span class="dot" style="background:${statusColor}" aria-hidden="true"></span><b>${esc(liveStatus)}</b></div>
    ${statusNote ? `<div style="font-size:12px;color:var(--ink-2)">${esc(statusNote)}</div>` : ''}
    <span style="font-size:12px;color:var(--ink-2)">${esc(spotForecastDates(spot))}</span>
    <div class="popup-weather" data-lat="${spot.lat}" data-lon="${spot.lon}" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line);min-height:60px">
      <div style="color:var(--ink-2);font-size:12px">Loading weather…</div>
    </div>
    <div style="margin-top:4px;display:flex;gap:12px;align-items:center">
      <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener">Google Maps</a>
      <a href="${jmaUrl}" target="_blank" rel="noopener" class="jma-city-link" data-lat="${spot.lat}" data-lon="${spot.lon}">JMA weather</a>
    </div>
  </div>`;
}

function spotCardHtml(spot, extra) {
  const phase = sakuraSpotPhase(spot);
  const status = spotLiveStatus(spot);
  const statusNote = spotStatusNote(spot);
  const extraText = extra ? `${esc(extra)} &middot; ` : '';
  return `<div class="spot-item" onclick="handleSpotClick(${reg({...spot, action:'flyToSpot'})})">
    <h4>${esc(spot.name)} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${esc(spot.nameRomaji)}</span>` : ''}</h4>
    <div class="sub">
      <span class="badge ${sakuraBadgeClass(phase)}">${esc(status)}</span>${statusNote ? ` &middot; ${esc(statusNote)}` : ''}
    </div>
    ${bloomBar(spot)}
    <div class="sub" style="margin-top:4px">
      ${extraText}${esc(spotForecastDates(spot))}
      · <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Maps</a>
    </div>
  </div>`;
}

// ── Weather card ──
async function loadWeatherCard(cityName) {
  try {
    const data = await api(`/api/weather?city=${encodeURIComponent(cityName)}`);
    const weatherDiv = document.createElement('div');
    weatherDiv.className = 'spot-item';
    weatherDiv.style.cssText = 'background:var(--surface-2);cursor:default';
    let whtml = '<h4>Weather</h4>';
    const DAY_LABELS = ['Today', 'Tomorrow', 'Day after'];
    for (const [i, day] of data.forecasts.entries()) {
      const temp = day.temperature;
      const maxC = temp?.max?.celsius;
      const rain = day.chanceOfRain;
      const rainHigh = Math.max(
        parseInt(rain?.T06_12, 10) || 0,
        parseInt(rain?.T12_18, 10) || 0,
        parseInt(rain?.T18_24, 10) || 0
      );
      whtml += `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:13px;font-variant-numeric:tabular-nums">
        <span>${DAY_LABELS[i] || esc(day.date?.slice(5) || '')}</span>
        <span>${maxC ? 'High '+esc(maxC)+'°C' : ''}${maxC && rainHigh > 0 ? ' · ' : ''}${rainHigh > 0 ? '<span style="color:var(--ink-2)">rain '+rainHigh+'%</span>' : ''}</span>
      </div>`;
    }
    weatherDiv.innerHTML = whtml;
    // Insert after the JMA station card
    const firstSpot = $('sidebar-content').querySelector('.spot-item:nth-child(2)');
    if (firstSpot) {
      $('sidebar-content').insertBefore(weatherDiv, firstSpot);
    } else {
      $('sidebar-content').appendChild(weatherDiv);
    }
  } catch {
    // Weather is supplementary — show a minimal card so the space doesn't silently vanish
    const weatherDiv = document.createElement('div');
    weatherDiv.className = 'spot-item';
    weatherDiv.style.cssText = 'background:var(--surface-2);cursor:default';
    weatherDiv.innerHTML = '<h4>Weather</h4><div class="sub">Weather is unavailable right now.</div>';
    const firstSpot = $('sidebar-content').querySelector('.spot-item:nth-child(2)');
    if (firstSpot) $('sidebar-content').insertBefore(weatherDiv, firstSpot);
    else $('sidebar-content').appendChild(weatherDiv);
  }
}

// ── Load all sakura spots on map ──
async function loadAllSpotsOnMap(options = {}) {
  const expectedMode = options.expectedMode || mode;
  const token = options.token ?? mapVersion;
  try {
    if (!allSpotsData) {
      allSpotsData = sessionGet('allSpots');
      if (!allSpotsData) {
        allSpotsData = await api('/api/sakura/all-spots');
        sessionSet('allSpots', allSpotsData);
      }
    }
    if (mode !== expectedMode || token !== mapVersion) return;
    if (options.replaceExisting) clearMarkers({ keepVersion: true });
    const sc = $('sakura-spot-count');
    if (sc) sc.textContent = ` ${allSpotsData.spots.length.toLocaleString('en-US')} spots on the map.`;

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: CLUSTER_RADIUS,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const childMarkers = cluster.getAllChildMarkers();
        // Count spots by shared phase so cluster colors match dots and labels.
        let ended = 0, falling = 0, pastPeak = 0, peak = 0, blooming = 0, buds = 0, dormant = 0;
        childMarkers.forEach(m => {
          const phase = normalizeSakuraSpotPhase(m.options.phase) || sakuraPhase(m.options.bloomRate, m.options.fullRate, m.options.fullBloomForecast);
          if (phase === 'ended') { ended++; return; }
          if (phase === 'falling') { falling++; return; }
          if (phase === 'past_peak') { pastPeak++; return; }
          if (phase === 'peak') { peak++; return; }
          if (phase === 'blooming' || phase === 'starting') { blooming++; return; }
          if (phase === 'bud_open' || phase === 'bud_swell' || phase === 'buds') { buds++; return; }
          dormant++;
        });

        // Color by majority status
        const n = childMarkers.length;
        let color, textColor;
        if (ended > n * 0.5) { color = C.ended; textColor = C.greenDark; }      // mostly ended
        else if (peak > n * 0.3) { color = C.peak; textColor = 'white'; }       // peak
        else if (falling + pastPeak > n * 0.3) {
          color = falling >= pastPeak ? C.falling : sakuraPhaseColor('past_peak');
          textColor = C.peak;
        }
        else if (blooming > n * 0.3) { color = C.bloom; textColor = 'white'; }   // blooming
        else if (buds > n * 0.3) { color = C.budOpen; textColor = 'white'; }       // buds
        else if (ended > 0 && (peak > 0 || pastPeak > 0 || blooming > 0)) { color = C.falling; textColor = C.peak; } // mixed late-season
        else { color = C.dormant; textColor = '#333'; }                             // dormant

        textColor = inkOn(color);
        const size = clusterSize(n);
        return L.divIcon({
          html: `<div style="background:${color};color:${textColor};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`,
          className: '',
          iconSize: [size, size],
        });
      }
    });

    for (const spot of allSpotsData.spots) {
      if (!spot.lat || !spot.lon) continue;
      if (!matchesBloomFilter(bloomCategory(spot))) continue;
      const color = sakuraColor(spot);
      const radius = sakuraRadius(spot);
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius, fillColor: color, color: 'white', weight: 1.5, fillOpacity: 0.9,
        bloomRate: spot.bloomRate, fullRate: spot.fullRate, fullBloomForecast: spot.fullBloomForecast, phase: sakuraSpotPhase(spot),
      });
      marker.bindPopup(spotPopupHtml(spot));
      clusterGroup.addLayer(marker);
    }
    mapInstance.addLayer(clusterGroup);

    // Kawazu cherry spots get distinct square markers
    try {
      const kawazu = await api('/api/kawazu');
      if (mode !== expectedMode || token !== mapVersion) return;
      for (const spot of kawazu.spots || []) {
        if (!spot.lat || !spot.lon) continue;
        if (!matchesBloomFilter(bloomCategory(spot.bloomRate, spot.fullRate, spot.fullBloomForecast))) continue;
        const kPhase = sakuraPhase(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
        const kawazuColor = kPhase === 'ended' ? C.ended : C.kawazu;
        const m = L.marker([spot.lat, spot.lon], {
          icon: L.divIcon({
            html: `<div style="background:${kawazuColor};width:14px;height:14px;border-radius:3px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25)" title="Kawazu cherry"></div>`,
            className: '', iconSize: [14, 14], iconAnchor: [7, 7],
          })
        });
        const kStatus = spotStatusWithDate(spot.bloomRate, spot.fullRate, spot.fullBloomForecast) || 'Kawazu Cherry';
        m.bindPopup(
          `<div style="min-width:200px"><b>${esc(spot.name)}</b> ${esc(spot.nameRomaji || '')}<br>` +
          `<span>Kawazu cherry (河津桜), an early variety</span><br>` +
          `<b>${kStatus}</b><br>` +
          `<span style="font-size:12px;color:var(--ink-2)">${fmtDates(spot.bloomForecast, spot.bloomRate, spot.fullBloomForecast, spot.fullRate)}</span><br>` +
          `<a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener">Google Maps</a></div>`
        );
        if (mode !== expectedMode || token !== mapVersion) return;
        m.addTo(mapInstance);
        markers.push(m);
      }
    } catch {} // Kawazu is optional; never break the main view

  } catch (e) {
    if (mode !== expectedMode || token !== mapVersion) return;
    // Fallback to city markers if all-spots fails
    if (!markers.length) addSakuraCityMarkers();
  }
}

// ── Fuzzy search/filter ──
function fuzzyMatch(text, query) {
  if (text.includes(query)) return true;
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = text.indexOf(query[qi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

let searchTimeout = null;
function filterSidebar(query) {
  const q = query.toLowerCase().replace(/[\s\-]/g, '');

  // If empty, restore the current view
  if (!q) {
    document.querySelectorAll('.spot-item, #sidebar-content .section-head').forEach(el => el.style.display = '');
    $('search-empty')?.remove();
    return;
  }

  // If we have all spots loaded and query is 3+ chars, do a global search
  if (allSpotsData && q.length >= 3) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => globalSpotSearch(q), 300);
    return;
  }

  localFilter(q);
}

function localFilter(q) {
  let shown = 0;
  document.querySelectorAll('#sidebar-content .spot-item').forEach(el => {
    const text = el.textContent.toLowerCase().replace(/[\s\-]/g, '');
    const hit = fuzzyMatch(text, q);
    el.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  document.querySelectorAll('#sidebar-content .section-head').forEach(el => { el.style.display = shown ? '' : 'none'; });
  $('search-empty')?.remove();
  if (!shown) $('sidebar-content').insertAdjacentHTML('afterbegin', `<div id="search-empty">${stateHtml({ title: 'No matches', body: 'Check the spelling, or try a city or prefecture name.' })}</div>`);
}

function globalSpotSearch(q) {
  const matches = allSpotsData.spots.filter(spot => {
    const text = `${spot.name} ${spot.nameRomaji || ''} ${spot.nameReading || ''} ${spot.prefecture || ''}`.toLowerCase().replace(/[\s\-]/g, '');
    return fuzzyMatch(text, q);
  }).slice(0, 50); // limit to 50 results

  if (matches.length === 0) {
    localFilter(q);
    return;
  }

  // Show results in sidebar
  $('sidebar-header').innerHTML = `<h2>Results for "${esc(q)}"</h2><p>${matches.length >= 50 ? 'First 50 cherry blossom spots' : `<span class="num">${matches.length}</span> cherry blossom spots`}</p>`;
  let html = '';
  for (const spot of matches) {
    html += spotCardHtml(spot, spot.prefecture || '');
  }
  $('sidebar-content').innerHTML = html;

  // Highlight on map
  clearMarkers();
  const bounds = [];
  for (const spot of matches) {
    if (!spot.lat || !spot.lon) continue;
    const color = sakuraColor(spot);
    const marker = L.circleMarker([spot.lat, spot.lon], {
      radius: 8, fillColor: color, color: 'white', weight: 2, fillOpacity: 0.9,
    }).addTo(mapInstance);
    marker.bindPopup(spotPopupHtml(spot));
    markers.push(marker);
    bounds.push([spot.lat, spot.lon]);
  }
  if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });
}

// ── KOYO ALL-SPOTS MAP ──
async function loadAllKoyoSpotsOnMap(options = {}) {
  const expectedMode = options.expectedMode || mode;
  const token = options.token ?? mapVersion;
  try {
    if (!allKoyoSpotsData) {
      allKoyoSpotsData = sessionGet('allKoyoSpotsV2');
      if (!allKoyoSpotsData) {
        allKoyoSpotsData = await api('/api/koyo/all-spots');
        sessionSet('allKoyoSpotsV2', allKoyoSpotsData);
      }
    }
    if (mode !== expectedMode || token !== mapVersion || koyoPrefView) return;
    updateKoyoFilterCounts(allKoyoSpotsData.spots.filter(koyoInDateRange));
    const kc = $('koyo-spot-count');
    if (kc) kc.textContent = ` ${allKoyoSpotsData.spots.length.toLocaleString('en-US')} spots on the map.`;
    if (clusterGroup) mapInstance.removeLayer(clusterGroup); // a filter change can overlap the initial load

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: CLUSTER_RADIUS,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const children = cluster.getAllChildMarkers();
        const counts = {};
        children.forEach(m => { counts[m.options.koyoPhase] = (counts[m.options.koyoPhase] || 0) + 1; });
        const n = children.length;
        // A cluster takes the colour of its most common phase.
        const top = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
        const p = KOYO_PHASES[top];
        const bg = p.hollow ? 'white' : p.color;
        const border = p.hollow ? `${KOYO_HOLLOW_STROKE}px solid ${p.color}` : '2px solid white';
        const textColor = p.hollow ? '#8a2f0a' : inkOn(p.color);
        const size = clusterSize(n);
        return L.divIcon({
          html: `<div style="background:${bg};color:${textColor};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:${border};box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`,
          className: '',
          iconSize: [size, size],
        });
      }
    });

    for (const spot of allKoyoSpotsData.spots.filter(koyoPhaseVisible)) {
      if (!spot.lat || !spot.lon) continue;
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius: 6, ...koyoMarkerStyle(spot),
        koyoPhase: spot.phase,
      });
      marker.bindPopup(koyoPopupHtml(spot));
      clusterGroup.addLayer(marker);
    }

    mapInstance.addLayer(clusterGroup);
  } catch (e) {
    console.error('loadAllKoyoSpotsOnMap', e);
    if (mode === expectedMode) setMapPlaceholder({ title: 'Spots did not load', body: 'The forecast list still works. Reload the page to try the map again.' });
  }
}

// ── WHAT'S ON ──
let festivalsCache = null;
let whatsOnMonth = new Date().getMonth() + 1;

async function loadWhatsOn() {
  $('sidebar-header').innerHTML = '<h2>Festivals and events</h2><p>Loading this month…</p>';
  $('sidebar-content').innerHTML = skeletonHtml();
  clearMarkers();
  updateLegend('whatson');

  // Load data sources in parallel (reuse caches)
  const fetches = [];
  if (!festivalsCache) fetches.push(api('/api/festivals').then(d => { festivalsCache = d; }).catch(() => {}));
  if (!flowersCache) fetches.push(api('/api/flowers').then(d => { flowersCache = d; }).catch(() => {}));
  if (!farmDataCache) fetches.push(api('/api/fruit/farms').then(d => { farmDataCache = d; }).catch(() => {}));
  await Promise.all(fetches);

  whatsOnMonth = new Date().getMonth() + 1;
  renderWhatsOn(whatsOnMonth);
}

function renderWhatsOn(m) {
  whatsOnMonth = m;
  const todayM = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  // Filter festivals: must be in month AND pass biennial year check
  const festivals = (festivalsCache?.spots || []).filter(f => {
    if (!f.months?.includes(m)) return false;
    if (f.years === 'odd'  && currentYear % 2 === 0) return false; // odd-year event, even year
    if (f.years === 'even' && currentYear % 2 !== 0) return false; // even-year event, odd year
    return true;
  });
  const flowers = (flowersCache?.spots || []).filter(s => {
    const ft = FLOWER_TYPES.find(f => f.type === s.type);
    return ft ? ft.months.includes(m) : false;
  });
  const inSeasonFruits = FRUITS.filter(f => f.months.includes(m));
  const farms = (farmDataCache?.spots || []).filter(f =>
    f.lat && f.lon && f.fruits?.some(fr => FRUITS.find(ff => ff.name === fr && ff.months.includes(m)))
  );

  // ── Map markers ──
  clearMarkers();

  // Festival markers
  for (const f of festivals) {
    if (!f.lat || !f.lon) continue;
    const ft = FESTIVAL_TYPES.find(t => t.type === f.type) || { name: 'Event', color: '#64748b' };
    const marker = L.marker([f.lat, f.lon], {
      icon: L.divIcon({
        html: `<div title="${ft.name}" style="background:${ft.color};width:18px;height:18px;border-radius:4px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)"></div>`,
        className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      })
    });
    marker.bindPopup(`<div style="min-width:210px">
      <b>${esc(f.name)}</b>
      ${f.nameJa ? `<span style="color:var(--ink-2);font-size:12px;margin-left:4px">${esc(f.nameJa)}</span>` : ''}
      <div style="margin:4px 0 2px;font-size:12px;color:var(--ink-2)">${ft.name} · ${esc(f.prefecture)} · ${esc(f.typicalDate)}</div>
      ${f.attendance ? `<div style="font-size:12px;color:var(--ink-2)">About ${f.attendance.toLocaleString('en-US')} visitors</div>` : ''}
      ${f.note ? `<div style="font-size:12px;color:var(--ink-2);margin-top:4px">${esc(f.note)}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:12px">
        ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">Official site</a>` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}" target="_blank" rel="noopener">Google Maps</a>
      </div>
    </div>`);
    marker.addTo(mapInstance);
    markers.push(marker);
  }

  // Flower markers (smaller, dimmer)
  for (const s of flowers) {
    if (!s.lat || !s.lon) continue;
    const ft = FLOWER_TYPES.find(f => f.type === s.type);
    if (!ft) continue;
    const marker = L.marker([s.lat, s.lon], {
      icon: L.divIcon({
        html: `<div title="${ft.name}" style="background:white;border:3px solid ${ft.color};border-radius:50%;width:14px;height:14px;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></div>`,
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      })
    });
    marker.bindPopup(`<div style="min-width:180px"><b>${esc(s.name)}</b><br><div style="font-size:12px;color:var(--ink-2);margin-top:4px">${ft.name} · ${esc(s.prefecture)}</div>${s.peakStart ? `<div style="font-size:12px">Peak <b>${s.peakStart.slice(0,5).replace('-','/')}–${s.peakEnd.slice(0,5).replace('-','/')}</b></div>` : ''}${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Official site</a>` : ''}</div>`);
    marker.addTo(mapInstance);
    markers.push(marker);
  }

  // Fruit farm cluster
  if (farms.length) {
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: CLUSTER_RADIUS, showCoverageOnHover: false,
      iconCreateFunction: cluster => {
        const n = cluster.getChildCount();
        const sz = clusterSize(n);
        return L.divIcon({ html: `<div style="background:${C.farmBlue};color:${inkOn(C.farmBlue)};width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
      }
    });
    for (const farm of farms) {
      const mk = L.marker([farm.lat, farm.lon], {
        icon: L.divIcon({ html: `<div style="background:${C.farmBlue};border:2px solid white;border-radius:50%;width:12px;height:12px;box-shadow:0 1px 3px rgba(0,0,0,0.15)"></div>`, className: '', iconSize: [12, 12], iconAnchor: [6, 6] })
      });
      mk.bindPopup(farmPopupHtml(farm, m));
      clusterGroup.addLayer(mk);
    }
    mapInstance.addLayer(clusterGroup);
  }

  // ── Month picker ──
  const monthPills = MO.map((mo, i) => {
    const mn = i + 1;
    const hasFestival = (festivalsCache?.spots || []).some(f => f.months?.includes(mn));
    const hasFruit = FRUITS.some(f => f.months.includes(mn));
    const hasFlower = FLOWER_TYPES.some(ft => ft.months.includes(mn));
    const hasAnything = hasFestival || hasFruit || hasFlower;
    const isActive = mn === m;
    const isToday = mn === todayM;
    return `<button type="button" class="month-btn${isActive ? ' active' : ''}${isToday ? ' is-today' : ''}${hasAnything ? '' : ' is-quiet'}" aria-pressed="${isActive}" onclick="renderWhatsOn(${mn})">${mo}</button>`;
  }).join('');

  // ── Season context banner ──
  const isSakuraSeason = SAKURA_MONTHS.includes(m);
  const isKoyoSeason = KOYO_MONTHS.includes(m);
  const isPlum = m >= 1 && m <= 3;
  const isWisteria = m >= 4 && m <= 5;
  const isHydrangea = m >= 6 && m <= 7;
  const isFireworksSeason = m === 7 || m === 8;
  const isWinterEvent = m === 1 || m === 2;

  let seasonCues = [];
  if (isPlum) seasonCues.push('Plum blossom' + (m === 2 ? ' (peak)' : ''));
  if (isSakuraSeason) seasonCues.push('Cherry blossom' + (m === 4 ? ' (peak in most of Japan)' : ''));
  if (isWisteria) seasonCues.push('Wisteria');
  if (isHydrangea) seasonCues.push('Hydrangea');
  if (isFireworksSeason) seasonCues.push('Fireworks');
  if (isKoyoSeason) seasonCues.push('Autumn leaves');
  if (isWinterEvent) seasonCues.push('Winter festivals');
  if (inSeasonFruits.length) seasonCues.push(`Fruit picking: ${inSeasonFruits.slice(0,3).map(f=>f.name).join(', ')}${inSeasonFruits.length > 3 ? ' and more' : ''}`);

  const bannerHtml = seasonCues.length
    ? `<div class="note">
        <b>${MO[m-1]}${m === todayM ? ' (this month)' : ''}:</b> ${seasonCues.join(' · ')}
       </div>`
    : '';

  // ── Sidebar sections ──
  let html = bannerHtml;

  // Festivals section
  if (festivals.length) {
    html += `<div class="section-head">Festivals and events: ${festivals.length} in ${MO[m-1]}</div>`;
    const byType = {};
    for (const f of festivals) {
      if (!byType[f.type]) byType[f.type] = [];
      byType[f.type].push(f);
    }
    for (const ft of FESTIVAL_TYPES) {
      const group = byType[ft.type];
      if (!group) continue;
      html += `<div style="padding:8px 16px 4px;font-size:13px;font-weight:600;display:flex;align-items:center"><span class="dot" style="background:${ft.color};border-radius:2px" aria-hidden="true"></span>${ft.name} (${group.length})</div>`;
      for (const f of group) {
        const bigEvent = f.attendance >= 500000;
        const biennialBadge = f.years ? ` <span class="badge ended">${f.years === 'odd' ? 'Odd years only' : 'Even years only'}</span>` : '';
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToFarm',lat:f.lat,lon:f.lon,zoom:12})})" style="cursor:pointer">
          <h4>${esc(f.name)}${biennialBadge}</h4>
          <div class="sub">${esc(f.prefecture)} · ${esc(f.typicalDate)}</div>
          ${f.attendance ? `<div class="sub">About ${f.attendance.toLocaleString('en-US')} visitors${bigEvent ? ', one of the largest' : ''}</div>` : ''}
          ${f.note ? `<div class="sub">${esc(f.note)}</div>` : ''}
          <div class="sub" style="margin-top:4px">
            ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Official site</a> · ` : ''}
            <a href="https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Maps</a>
          </div>
        </div>`;
      }
    }
  } else {
    html += stateHtml({ title: `No festivals listed for ${MO[m-1]}`, body: 'The busiest months are July and August for fireworks, October and November for autumn festivals, and January and February for winter events.' });
  }

  // Flowers section
  if (flowers.length) {
    const inSeasonFtypes = FLOWER_TYPES.filter(ft => ft.months.includes(m));
    const flowerLabel = inSeasonFtypes.map(ft => ft.name).join(', ');
    html += `<div class="section-head">${flowerLabel}: ${flowers.length} spots in season</div>`;
    flowers.slice(0, 6).forEach(s => {
      const ft = FLOWER_TYPES.find(f => f.type === s.type);
      html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:s.lat,lon:s.lon})})" style="cursor:pointer">
        <h4>${ft ? dotHtml(ft.color) : ''}${esc(s.name)} <span style="font-weight:400;color:var(--ink-2)">${esc(s.nameJa||'')}</span></h4>
        <div class="sub">${esc(s.prefecture)} · ${esc(s.region)}</div>
        ${s.peakStart ? `<div class="sub">Peak <b>${s.peakStart.slice(0,5).replace('-','/')}–${s.peakEnd.slice(0,5).replace('-','/')}</b></div>` : ''}
        <div class="sub" style="margin-top:4px">
          ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Official site</a> · ` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Maps</a>
        </div>
      </div>`;
    });
    if (flowers.length > 6) html += `<div class="sub" style="padding:8px 16px">${flowers.length - 6} more. <button type="button" onclick="setMode('flowers')" style="background:none;border:none;color:var(--accent);text-decoration:underline;font-size:13px;padding:0">See all flowers</button></div>`;
  }

  // Fruit section
  if (inSeasonFruits.length) {
    html += `<div class="section-head">
      Fruit picking: ${farms.length.toLocaleString('en-US')} farms on the map</div>`;
    inSeasonFruits.slice(0, 5).forEach(f => {
      const isPeak = f.peak.includes(m);
      html += `<div class="spot-item" role="button" tabindex="0" onclick="setMode('fruit');" onkeydown="if(event.key==='Enter')setMode('fruit')">
        <h4>${dotHtml(f.color)}${f.name} <span style="font-weight:400;color:var(--ink-2)">${f.ja}</span>${isPeak ? ' <span class="badge ended">Peak</span>' : ''}</h4>
        <div class="sub">Best regions: ${f.regions.slice(0,3).join(', ')}</div>
        <div class="sub">${farms.filter(fm => fm.fruits?.includes(f.name)).length} farms. Open in Fruit picking.</div>
      </div>`;
    });
    if (inSeasonFruits.length > 5) html += `<div class="sub" style="padding:8px 16px">${inSeasonFruits.length - 5} more fruits. <button type="button" onclick="setMode('fruit')" style="background:none;border:none;color:var(--accent);text-decoration:underline;font-size:13px;padding:0">See all fruit</button></div>`;
  }

  // Sakura/koyo cross-links
  if (isSakuraSeason) {
    html += `<div class="note">
      It's cherry blossom season. <button type="button" onclick="setMode('sakura')" style="background:none;border:none;color:var(--accent);text-decoration:underline;padding:0;font:inherit">Open the cherry blossom forecast</button>
    </div>`;
  }
  if (isKoyoSeason) {
    html += `<div class="note">
      It's autumn leaves season. <button type="button" onclick="setMode('koyo')" style="background:none;border:none;color:var(--accent);text-decoration:underline;padding:0;font:inherit">Open the autumn leaves forecast</button>
    </div>`;
  }

  $('sidebar-header').innerHTML = `
    <h2>Festivals and events</h2>
    <p>What's on in ${MO[m-1]}${m === todayM ? ', this month' : ''}</p>
    <div class="month-grid" role="group" aria-label="Month">${monthPills}</div>`;
  $('sidebar-content').innerHTML = html;
}

// ── Smart season detection ──
// Returns the most relevant mode for the current month.
// Priority: peak seasons first, then shoulder, then fallback.
function detectSeasonMode() {
  const m = new Date().getMonth() + 1; // 1–12
  if (m >= 2 && m <= 5)  return 'sakura';   // Feb–May
  if (m >= 10 && m <= 12) return 'koyo';    // Oct–Dec
  if (m === 6 || m === 7) return 'flowers'; // Jun–Jul (hydrangea, lavender)
  if (m === 8 || m === 9) return 'flowers'; // Aug–Sep (sunflower, cosmos)
  return 'flowers'; // Jan (plum blossom)
}

// ── 30-second tour ──
(function() {
  const dlg = document.getElementById('tour');
  const open = document.getElementById('tour-open');
  if (!dlg || !open || typeof dlg.showModal !== 'function') return;
  const video = document.getElementById('tour-video');
  let returnTo = open;
  const show = () => { returnTo = document.activeElement || open; if (!dlg.open) dlg.showModal(); };
  open.addEventListener('click', show);
  document.getElementById('tour-close').addEventListener('click', () => dlg.close());
  // Clicks on the backdrop land on the dialog element itself.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { video.pause(); (returnTo && returnTo.isConnected ? returnTo : open).focus(); });
  if (new URLSearchParams(location.search).get('tour') === '1') { returnTo = open; dlg.showModal(); }
})();

// ── Init ──
// Read URL state on load
(function() {
  try {
    document.body.dataset.season = seasonForMonth(new Date().getMonth() + 1);
    if (typeof L === 'undefined') throw new Error('map library missing');
    const p = new URLSearchParams(location.search);
    const m = p.get('mode');
    if (m && MODE_PAGES[m]) { location.replace(MODE_PAGES[m]); return; }
    if (m && ['sakura','koyo','fruit','flowers','whatson','trip'].includes(m)) {
      initMap(); setMode(m);
      const pref = p.get('pref');
      if (pref && m === 'sakura') loadPrefSpots(pref, pref);
      if (pref && m === 'koyo') loadKoyoSpots(pref, pref);
      return;
    }
    initMap(); setMode(detectSeasonMode());
  } catch (e) {
    const el = document.getElementById('sidebar-content');
    if (el) el.innerHTML = stateHtml({ title: 'The map could not load', body: 'Check your connection. If you use a content blocker, allow unpkg.com for this site.', retry: 'location.reload()', retryLabel: 'Reload', error: true });
    const hdr = document.getElementById('sidebar-header');
    if (hdr) hdr.innerHTML = '<h2>Japan in Seasons</h2><p>Something went wrong while loading.</p>';
    console.error('Init error:', e);
  }
})();
