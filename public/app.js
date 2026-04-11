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
  // Kawazu cherry (early-blooming variant — distinct magenta)
  kawazu:      '#db2777',
  // Fruit picking / nature greens — = CSS --green
  green:       '#16a34a',
  greenDark:   '#166534',
  greenMid:    '#15803d',
  greenLight:  '#f0fdf4',
  greenSoft:   '#dcfce7',
  greenBorder: '#bbf7d0',
  // Generic semantic
  gray:        '#a3a3a3',
  error:       '#dc2626',
  pinkLight:   '#fdf2f8',
};

// ── State ──
let mode = 'sakura';
let sakuraData = null;
let allSpotsData = null;
let mapInstance = null;
let markers = [];
let clusterGroup = null;

// ── Spot click registry (prevents XSS via inline onclick strings) ──
const _registry = new Map();
let _rid = 0;
function reg(data) { const id = _rid++; _registry.set(id, data); return id; }
function handleSpotClick(id) {
  const d = _registry.get(id);
  if (!d) return;
  if (d.action === 'flyToSpot') flyToSpot(d.lat, d.lon, d.name, d.bloomRate, d.fullRate, d.status, d.fullBloomForecast);
  if (d.action === 'loadPrefSpots') loadPrefSpots(d.prefCode, d.prefName);
  if (d.action === 'flyToFarm') mapInstance.flyTo([d.lat, d.lon], d.zoom || 14);
  if (d.action === 'flyToKoyo') mapInstance.flyTo([d.lat, d.lon], d.zoom || 13);
  if (d.action === 'setMode') setMode(d.mode);
  if (d.action === 'loadKoyoSpots') loadKoyoSpots(d.prefCode, d.name);
}

// ── Map setup ──
function initMap() {
  mapInstance = L.map('map', { zoomControl: false }).setView([36.5, 137.5], 6);
  L.control.zoom({ position: 'topright' }).addTo(mapInstance);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18,
  }).addTo(mapInstance);

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
        jmaLink.textContent = 'JMA city forecast →';
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
              jmaLink.textContent = 'JMA city forecast →';
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

    el.innerHTML = '<div style="color:#ccc;font-size:11px;padding:4px 0">Loading weather…</div>';

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
      const curIcon = wmoIcon(cw.weathercode ?? 0);
      const curTemp = cw.temperature != null ? Math.round(cw.temperature) : null;
      const curDesc = wmoDesc(cw.weathercode ?? 0);
      const nowHtml = curTemp != null ? `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">
          <span style="font-size:22px;line-height:1">${curIcon}</span>
          <div>
            <span style="font-size:15px;font-weight:700;color:#1e293b">${curTemp}°C</span>
            <span style="font-size:11px;color:#64748b;margin-left:4px">${curDesc}</span>
          </div>
        </div>` : '';

      // 3-day forecast cards
      const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const cols = dates.slice(0, 3).map((date, i) => {
        const icon = wmoIcon(codes[i] ?? 0);
        const hi   = maxTemps[i] != null ? Math.round(maxTemps[i]) : '—';
        const lo   = minTemps[i] != null ? Math.round(minTemps[i]) : '—';
        const rain = rainProb[i]  != null ? Math.round(rainProb[i]) : 0;
        const label = i === 0 ? 'Today' : DAY[new Date(date + 'T12:00:00+09:00').getDay()];
        return `<div style="text-align:center;flex:1;background:#f8fafc;border-radius:5px;padding:4px 2px">
          <div style="font-size:10px;color:#64748b;font-weight:500;margin-bottom:1px">${label}</div>
          <div style="font-size:18px;line-height:1.3">${icon}</div>
          <div style="font-weight:700;font-size:12px;color:#1e293b">${hi}°</div>
          <div style="font-size:10px;color:#94a3b8">${lo}°</div>
          ${rain > 10 ? `<div style="font-size:9px;color:#60a5fa;font-weight:500">${rain}%</div>` : ''}
        </div>`;
      }).join('');

      const html = `
        <div style="margin-top:6px;padding-top:5px;border-top:1px solid #f1f5f9">
          ${nowHtml}
          <div style="display:flex;gap:3px;margin-bottom:4px">${cols}</div>
        </div>`;

      weatherCache.set(key, { html, ts: Date.now() });
      el.innerHTML = html;
    } catch { el.innerHTML = ''; }
  });
}

// ── Helpers ──
const $ = id => document.getElementById(id);

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

// sessionStorage cache — survives page refresh, expires after 1 hour
const SESSION_TTL = 3_600_000;
function sessionGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > SESSION_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function sessionSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

// ── Farm popup — single source, used in trip/fruit/whatson modes ──
function farmPopupHtml(farm, m) {
  const emoji = FRUITS.find(f => farm.fruits?.includes(f.name) && (m ? f.months.includes(m) : true))?.emoji || '🌿';
  const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
  return `<div style="min-width:170px">
    <b>${esc(farm.name)}</b><br>
    <span style="font-size:11px;color:#666">${esc(farm.address||'')}</span><br>
    <span style="font-size:11px">${(farm.fruits||[]).map(esc).join(' · ')}</span>
    <div style="margin-top:6px">
      <a href="https://www.google.com/maps/search/?api=1&query=${farm.lat},${farm.lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
      ${farm.url ? ` &middot; <a href="${esc(farm.url)}" target="_blank" style="color:#0369a1;font-size:12px">${esc(srcLabel)} →</a>` : ''}
    </div>
  </div>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getMonth()+1}/${d.getDate()}`;
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
  if (phase === 'ended') return 'Ended — green leaves';
  if (phase === 'falling') return 'Falling — petals scattering';
  if (phase === 'past_peak') return 'Past peak — still some petals';
  if (phase === 'peak') return 'Full bloom — best viewing!';
  if (phase === 'blooming') return 'Blooming — near full bloom';
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

// WMO weather code → emoji (https://open-meteo.com/en/docs)
function wmoIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code <= 3) return '🌥️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
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
  const bDate = sakuraDateOk(bloomForecast) ? fmtDate(bloomForecast) : '—';
  const fDate = sakuraDateOk(fullBloomForecast) ? fmtDate(fullBloomForecast) : '—';
  const b = bloomRate >= 100 ? `Bloomed: ${bDate}` : `Bloom: ${bDate === '—' ? '—' : bDate + ' (est.)'}`;
  const f = fullRate >= 100 ? `Full bloom: ${fDate}` : `Full bloom: ${fDate === '—' ? '—' : fDate + ' (est.)'}`;
  return `${b} · ${f}`;
}

// ── Color by bloom rate + date ──
// Lifecycle: orange (bud/growth) → pink (flowering) → green (ended/leaves)
// fullRate stays at 100% forever after peak — use forecast date to detect "ended"
function sakuraColor(bloomRate, fullRate, fullBloomForecast) {
  return sakuraPhaseColor(sakuraPhase(bloomRate, fullRate, fullBloomForecast));
}

// Spot status text reads from the same shared phase thresholds as map dots.
function spotStatusWithDate(bloomRate, fullRate, fullBloomForecast) {
  return sakuraPhaseLabel(sakuraPhase(bloomRate, fullRate, fullBloomForecast));
}

function spotLiveStatus(spot) {
  if (hasSakuraTimelineData(spot.bloomRate, spot.fullRate, spot.bloomForecast, spot.fullBloomForecast)) {
    return spotStatusWithDate(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
  }
  return spot.status || 'Dormant';
}

function sakuraRadius(bloomRate, fullRate, fullBloomForecast) {
  return sakuraPhaseRadius(sakuraPhase(bloomRate, fullRate, fullBloomForecast));
}

// ── Bloom category (for filter) ──
let bloomFilter = 'all'; // kept for legacy compat
let bloomFilters = new Set(); // empty = show all

function bloomCategory(bloomRate, fullRate, fullBloomForecast) {
  return sakuraPhaseCategory(sakuraPhase(bloomRate, fullRate, fullBloomForecast));
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
      html += `<div style="padding:12px 16px;background:var(--gray-50);font-weight:600;font-size:0.85rem;border-bottom:1px solid var(--gray-200)">${region.nameEn}</div>`;
      for (const city of region.cities) {
        const st = statusText(city.status);
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:city.prefCode,prefName:city.prefName})})">
          <h4>${city.cityName} <span style="font-weight:400;color:var(--gray-400)">${city.prefName}</span></h4>
          <div class="sub">
            <span class="badge ${st.cls}">${st.text}</span>
            &nbsp; Bloom: ${sakuraDateOk(city.bloom.forecast) ? fmtDate(city.bloom.forecast) : '—'}${city.bloom.observation ? ' → '+fmtDate(city.bloom.observation) : ''}
            &nbsp; Full: ${sakuraDateOk(city.fullBloom.forecast) ? fmtDate(city.fullBloom.forecast) : '—'}${city.fullBloom.observation ? ' → '+fmtDate(city.fullBloom.observation) : ''}${avgDiffLabel(city.fullBloom?.forecast, city.fullBloom?.normal)}
          </div>
        </div>`;
      }
    }
    $('sidebar-content').innerHTML = html;
  } else {
    const labelMap = { peak:'🌺 Full Bloom', blooming:'🌸 Blooming', buds:'🌷 Budding', ended:'🍃 Past Peak' };
    const labels = [...bloomFilters].map(f => labelMap[f]).join(' + ');
    const filtered = allSpotsData.spots.filter(s => matchesBloomFilter(bloomCategory(s.bloomRate, s.fullRate, s.fullBloomForecast)));
    const listHtml = filtered.length
      ? filtered.slice(0, 80).map(s => spotCardHtml(s, s.prefecture || '')).join('')
      : '<div class="loading">No spots found for this filter.</div>';
    $('sidebar-content').innerHTML = `<div style="padding:10px 16px;font-size:0.82rem;color:var(--gray-600)">${filtered.length} spots — ${labels}</div>` + listHtml;
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
function bloomBar(bloomRate, fullRate, fullBloomForecast) {
  if (fullRate >= 100 && fullBloomForecast) {
    const days = daysSince(fullBloomForecast);
    if (days > 3) return ''; // past peak — no bar, status line says it all
  }
  if (fullRate > 0) {
    return `<div class="bloom-row"><span class="bloom-label">Flowering</span><div class="bloom-track"><div class="bloom-fill f" style="width:${Math.min(fullRate,100)}%">${fullRate}%</div></div><span style="font-size:0.72rem;color:var(--gray-600);width:80px;text-align:right">${floweringStage(fullRate)}</span></div>`;
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
const FOOTER_NOTES = {
  sakura:  `<b>Live data:</b> <a href="https://n-kishou.com" target="_blank" rel="noopener">Japan Met Corp</a> — bloom % updated daily 9AM JST · weather hourly<br>`,
  koyo:    `<b>Live data:</b> <a href="https://n-kishou.com" target="_blank" rel="noopener">Japan Met Corp</a> — koyo colour % updated daily 9AM JST · weather hourly<br>`,
  fruit:   `<b>Data:</b> Farm listings from Jalan &amp; Navitime — season windows are typical regional averages, confirm with farms before visiting<br>`,
  flowers: `<b>Data:</b> Curated — typical annual bloom dates · actual timing varies by weather, always check official sites<br>`,
  whatson: `<b>Data:</b> Curated seasonal activities — typical dates only · always check official sites before visiting<br>`,
  trip:    `<b>Data:</b> Sakura &amp; koyo from <a href="https://n-kishou.com" target="_blank" rel="noopener">Japan Met Corp</a> · other activities are curated typical dates<br>`,
};

function setMode(m) {
  mode = m;
  ['sakura','koyo','fruit','flowers','whatson','trip'].forEach(k => { const b = $(`btn-${k}`); if (b) b.classList.toggle('active', k === m); });
  if (m !== 'sakura') { const bf = $('bloom-filters'); if (bf) bf.style.display = 'none'; }
  const fn = $('footer-data-note'); if (fn) fn.innerHTML = FOOTER_NOTES[m] || '';
  if (m === 'sakura') loadSakura();
  if (m === 'trip') loadTripPlanner();
  if (m === 'koyo') loadKoyo();
  if (m === 'fruit') loadFruitPicking();
  if (m === 'flowers') loadFlowers();
  if (m === 'whatson') loadWhatsOn();
  pushUrlState({ mode: m });
}

// ── Static config tables ──
// These are the UI-side data tables (colors, months, notes for rendering).
// src/lib/constants.ts has the MCP-server-side versions (no colors, more regional detail).
// Keep months in sync between both files when updating seasons.

const FRUITS = [
  { name:'Strawberry', ja:'いちご', emoji:'🍓', months:[12,1,2,3,4,5], peak:[2,3,4], color:'#ef4444',
    regions:['Tochigi','Nagano','Chiba','Ibaraki','Hokkaido'], note:'Kyushu (Fukuoka) season ends ~April; May is Kanto & northern only' },
  { name:'Melon', ja:'メロン', emoji:'🍈', months:[5,6,7,8], peak:[6,7], color:'#16a34a',
    regions:['Hokkaido (Yubari)','Ibaraki','Kumamoto'], note:'Yubari King is Japan\'s most prized melon' },
  { name:'Cherry', ja:'さくらんぼ', emoji:'🍒', months:[6,7], peak:[6,7], color:'#dc2626',
    regions:['Yamagata','Hokkaido','Nagano','Aomori'], note:'Very short season — book farms early' },
  { name:'Watermelon', ja:'すいか', emoji:'🍉', months:[6,7,8], peak:[7], color:'#16a34a',
    regions:['Kumamoto','Yamagata','Chiba'] },
  { name:'Peach', ja:'もも', emoji:'🍑', months:[7,8,9], peak:[7,8], color:C.budOpen,
    regions:['Yamanashi','Fukushima','Nagano','Okayama'] },
  { name:'Blueberry', ja:'ブルーベリー', emoji:'🫐', months:[7,8,9], peak:[7,8], color:'#6d28d9',
    regions:['Nagano','Chiba','Tokyo (suburbs)','Hokkaido'] },
  { name:'Grape', ja:'ぶどう', emoji:'🍇', months:[8,9,10,11], peak:[9,10], color:'#7c3aed',
    regions:['Yamanashi','Nagano','Yamagata','Okayama'], note:'50+ varieties; shine muscat is very popular' },
  { name:'Pear', ja:'なし', emoji:'🍐', months:[8,9,10], peak:[8,9], color:'#65a30d',
    regions:['Tottori','Chiba','Ibaraki','Nagano'], note:'Japanese pears are round and crisp' },
  { name:'Fig', ja:'いちじく', emoji:'🍈', months:[8,9,10], peak:[9], color:'#a855f7',
    regions:['Aichi','Osaka','Hyogo'] },
  { name:'Apple', ja:'りんご', emoji:'🍎', months:[9,10,11], peak:[10,11], color:'#dc2626',
    regions:['Aomori','Nagano','Iwate','Yamagata'], note:'Aomori produces ~60% of Japan\'s apples' },
  { name:'Persimmon', ja:'柿', emoji:'🟠', months:[10,11,12], peak:[10,11], color:'#ea580c',
    regions:['Nara','Wakayama','Gifu','Fukuoka'] },
  { name:'Kiwi', ja:'キウイ', emoji:'🥝', months:[10,11,12], peak:[11], color:'#65a30d',
    regions:['Ehime','Kanagawa','Fukuoka'] },
  { name:'Chestnut', ja:'栗', emoji:'🌰', months:[9,10,11], peak:[9,10], color:'#92400e',
    regions:['Ibaraki','Kumamoto','Ehime','Aichi'], note:'Japan\'s most prized variety is Tanba (Kyoto/Hyogo)' },
  { name:'Mikan', ja:'みかん', emoji:'🍊', months:[11,12,1], peak:[11,12], color:C.budOpen,
    regions:['Wakayama','Ehime','Shizuoka','Nagasaki'], note:'Japan\'s most popular winter citrus' },
];

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const FLOWER_TYPES = [
  { type: 'plum',      emoji: '🌸', name: 'Plum Blossom', ja: '梅',        color: '#e11d48', sectionBg: '#fff1f2', peakLabel: 'Jan–Mar',
    months: [1,2,3],   peak: [2],
    note: 'Peak: mid-January (Atami) to March. Japan\'s first spring bloom — 4–6 weeks before cherry blossom.' },
  { type: 'nanohana',  emoji: '🌼', name: 'Rapeseed',     ja: '菜の花',    color: '#ca8a04', sectionBg: '#fefce8', peakLabel: 'Feb–Apr',
    months: [2,3,4],   peak: [3],
    note: 'Peak: February–April. Golden rapeseed carpets river banks and hillsides across Japan. Okinawa blooms earliest in January.' },
  { type: 'wisteria',  emoji: '💜', name: 'Wisteria',     ja: '藤',        color: '#7c3aed', sectionBg: '#f5f3ff', peakLabel: 'late Apr–early May',
    months: [4,5],     peak: [4,5],
    note: 'Peak: late April – early May. Famous spots often require timed entry tickets.' },
  { type: 'iris',      emoji: '🌺', name: 'Iris',         ja: '菖蒲',      color: '#4f46e5', sectionBg: '#eef2ff', peakLabel: 'May–Jun',
    months: [5,6],     peak: [6],
    note: 'Peak: June (July in northern Tohoku). Traditional Japanese iris gardens are a quintessential early-summer experience.' },
  { type: 'hydrangea', emoji: '💙', name: 'Hydrangea',    ja: '紫陽花',    color: '#2563eb', sectionBg: '#eff6ff', peakLabel: 'June',
    months: [6,7],     peak: [6],
    note: 'Peak: June. Kamakura is the most famous destination with 10+ spots — visit on weekdays to avoid crowds.' },
  { type: 'lavender',  emoji: '🪻', name: 'Lavender',     ja: 'ラベンダー', color: '#9333ea', sectionBg: '#faf5ff', peakLabel: 'July',
    months: [6,7],     peak: [7],
    note: 'Peak: July in Hokkaido\'s Furano region — the most photogenic lavender fields in Asia. Farm Tomita is the iconic destination.' },
  { type: 'sunflower', emoji: '🌻', name: 'Sunflower',    ja: 'ひまわり',  color: '#f59e0b', sectionBg: '#fffbeb', peakLabel: 'Jul–Aug',
    months: [7,8],     peak: [7,8],
    note: 'Peak: late July–August. Hokkaido\'s Hokuryu village has 2.3 million sunflowers; Yamanashi fields face Mt. Fuji.' },
  { type: 'cosmos',    emoji: '🌷', name: 'Cosmos',       ja: 'コスモス',  color: '#db2777', sectionBg: '#fdf2f8', peakLabel: 'Sep–Oct',
    months: [9,10],    peak: [10],
    note: 'Peak: October. Japan\'s beloved autumn flower — Showa Kinen Park and Hitachi Seaside Park each host 4.5 million plants.' },
];

const FESTIVAL_TYPES = [
  { type: 'fireworks', emoji: '🎆', name: 'Fireworks', color: C.budOpen },
  { type: 'matsuri',   emoji: '🏮', name: 'Festival',  color: '#dc2626' },
  { type: 'winter',    emoji: '❄️', name: 'Winter',    color: '#0ea5e9' },
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
  $('sidebar-header').innerHTML = '<h2>Fruit Picking in Japan</h2><p>Loading...</p>';
  clearMarkers();
  updateLegend('fruit');

  if (!farmDataCache) {
    try { farmDataCache = await api('/api/fruit/farms'); } catch {}
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
      maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const n = cluster.getChildCount();
        const size = Math.min(36 + n * 0.5, 54);
        return L.divIcon({
          html: `<div style="background:${C.green};color:white;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`,
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

      // Icon: show 2 emojis + "+N" badge if more than 2 in-season fruits
      const n = inSeasonFruits.length;
      const emojis = inSeasonFruits.slice(0, 2).map(f => f.emoji).join('');
      const extra = n > 2 ? `<span style="font-size:8px;font-weight:700;color:${C.greenDark};margin-left:1px">+${n-2}</span>` : '';
      const sz = n > 1 ? 32 : 24;
      const fs = n > 1 ? 11 : 13;
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          html: `<div style="background:white;border:2px solid ${C.green};border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;font-size:${fs}px;box-shadow:0 1px 4px rgba(0,0,0,0.2);gap:1px">${emojis}${extra}</div>`,
          className: '', iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
        })
      });

      // Popup: list every farm at this location, separated by a divider
      const popupRows = activeFarms.map((farm, i) => {
        const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
        return `${i > 0 ? `<div style="border-top:1px solid #eee;margin:8px 0"></div>` : ''}
          <b>${esc(farm.name)}</b><br>
          <span style="font-size:11px;color:#666">${esc(farm.address||'')}</span><br>
          <span style="font-size:11px">${(farm.fruits||[]).map(esc).join(' · ')}</span>
          <div style="margin-top:4px">
            <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
            ${farm.url ? ` · <a href="${esc(farm.url)}" target="_blank" style="color:#0369a1;font-size:12px">${esc(srcLabel)} →</a>` : ''}
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
    return `<button onclick="renderFruitMonth(${mn})" style="
      padding:4px 2px; border-radius:6px; border:1px solid ${isActive ? C.green : 'var(--gray-200)'};
      background:${isActive ? C.green : 'white'}; color:${isActive ? 'white' : hasInSeason ? 'var(--gray-800)' : 'var(--gray-400)'};
      font-size:0.72rem; font-weight:${isActive || isToday ? '600' : '400'}; cursor:pointer; text-align:center;
      ${isToday && !isActive ? `border-color:${C.green};color:${C.green};` : ''}
    ">${mo}</button>`;
  }).join('');

  // Update header
  $('sidebar-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
      <h2 style="margin:0">Fruit Picking in Japan</h2>
      <span style="font-size:0.78rem;color:var(--gray-400)">${markersAdded > 0 ? markersAdded+' farms on map · ' : ''}${farms.length || 0} total</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-top:2px">${monthPills}</div>`;

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
    return `<div class="spot-item" onclick="setFruitFilter('${f.name}')" style="cursor:pointer;${isActive ? `background:${C.greenLight};border-left:3px solid ${C.green};padding-left:13px;` : ''}">
      <h4>${f.emoji} ${f.name} <span style="font-weight:400;color:var(--gray-400)">${f.ja}</span>
        ${isPeak ? `<span style="background:${C.greenSoft};color:${C.green};font-size:0.72rem;padding:1px 6px;border-radius:10px;margin-left:4px;font-weight:500">Peak</span>` : ''}
        ${isActive ? `<span style="background:${C.green};color:white;font-size:0.72rem;padding:1px 6px;border-radius:10px;margin-left:4px;font-weight:500">Filtered ✕</span>` : ''}
      </h4>
      <div class="sub">Season: ${season} · Peak: ${peak}</div>
      <div class="sub" style="margin-top:2px">Best regions: ${f.regions.join(', ')}</div>
      ${farmCount ? `<div class="sub" style="margin-top:2px;color:${C.green}">${farmCount} farms in database${isActive ? ` — showing on map` : ' — click to filter'}</div>` : ''}
      ${f.note ? `<div class="sub" style="margin-top:2px;color:var(--gray-400);font-style:italic">${f.note}</div>` : ''}
    </div>`;
  }

  const isCurrentMonth = m === todayM;
  let html = `<div style="margin:10px 16px;padding:10px 12px;background:${C.greenLight};border:1px solid ${C.greenBorder};border-radius:8px;font-size:0.8rem;color:${C.greenDark}">
    🌱 Season windows are typical regional averages — confirm with farms before visiting.
    ${scrapedAt ? `<br>Farm database: <b>${farmDataCache.total} spots</b> cached on ${scrapedAt}` : ''}
  </div>`;

  if (inSeason.length) {
    html += `<div style="padding:10px 16px;background:${C.greenSoft};font-weight:600;font-size:0.85rem;color:${C.greenMid};border-bottom:1px solid ${C.greenBorder}">In Season — ${MO[m-1]}${isCurrentMonth ? ' (now)' : ''}</div>`;
    inSeason.forEach(f => html += fruitCard(f));
  }
  if (comingSoon.length) {
    html += `<div style="padding:10px 16px;background:${C.greenLight};font-weight:600;font-size:0.85rem;color:${C.greenDark};border-bottom:1px solid var(--gray-200)">Coming Up — ${MO[nextM-1]}/${MO[nextM2-1]}</div>`;
    comingSoon.forEach(f => html += fruitCard(f));
  }
  if (other.length) {
    html += `<div style="padding:10px 16px;background:var(--gray-50);font-weight:600;font-size:0.85rem;color:var(--gray-400);border-bottom:1px solid var(--gray-200)">Other Seasons</div>`;
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
  const sign = diff < 0 ? '−' : '+';
  const col = diff < -3 ? C.peak : diff > 3 ? C.green : C.gray;
  return `<span style="font-size:0.7rem;color:${col};margin-left:4px">${sign}${Math.abs(diff)}d vs avg</span>`;
}

// ── SAKURA ──
async function loadSakura() {
  $('sidebar-header').innerHTML = '<h2>Cherry Blossom Forecast</h2><p>48 cities &middot; 1,012 spots &middot; Click a city to see spots</p>';
  $('sidebar-content').innerHTML = '<div class="loading">Loading...</div>';
  updateLegend('sakura');

  // Show bloom filters, reset to 'all'
  bloomFilter = 'all'; bloomFilters.clear();
  const bf = $('bloom-filters');
  if (bf) { bf.style.display = 'flex'; bf.querySelectorAll('.filter-pill').forEach((b,i) => b.classList.toggle('active', i===0)); }

  try {
    if (!sakuraData) sakuraData = await api('/api/sakura/forecast');
    clearMarkers();

    // Load ALL 1,012 spots on map with clustering
    loadAllSpotsOnMap();

    // Render sidebar with regions
    let html = '';
    for (const region of sakuraData.regions) {
      html += `<div style="padding:12px 16px;background:var(--gray-50);font-weight:600;font-size:0.85rem;border-bottom:1px solid var(--gray-200)">${region.nameEn}</div>`;
      for (const city of region.cities) {
        const st = statusText(city.status);
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:city.prefCode,prefName:city.prefName})})">
          <h4>${city.cityName} <span style="font-weight:400;color:var(--gray-400)">${city.prefName}</span></h4>
          <div class="sub">
            <span class="badge ${st.cls}">${st.text}</span>
            &nbsp; Bloom: ${sakuraDateOk(city.bloom.forecast) ? fmtDate(city.bloom.forecast) : '—'}${city.bloom.observation ? ' → '+fmtDate(city.bloom.observation) : ''}
            &nbsp; Full: ${sakuraDateOk(city.fullBloom.forecast) ? fmtDate(city.fullBloom.forecast) : '—'}${city.fullBloom.observation ? ' → '+fmtDate(city.fullBloom.observation) : ''}${avgDiffLabel(city.fullBloom?.forecast, city.fullBloom?.normal)}
          </div>
        </div>`;
      }
    }
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
  }
}

async function loadPrefSpots(prefCode, prefName) {
  pushUrlState({ mode: 'sakura', pref: prefCode });
  $('sidebar-header').innerHTML = `<h2>${prefName} Spots</h2><p>Loading...</p>`;
  $('sidebar-content').innerHTML = '<div class="loading">Loading spots...</div>';
  const bf = $('bloom-filters'); if (bf) bf.style.display = 'none';

  try {
    const data = await api(`/api/sakura/spots?pref=${prefCode}`);
    clearMarkers();

    // Add spots to map
    const bounds = [];
    for (const spot of data.spots) {
      if (!spot.lat || !spot.lon) continue;
      const color = sakuraColor(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
      const radius = sakuraRadius(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
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
    const updated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : 'Unknown';
    $('sidebar-header').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><h2>${prefName}</h2><p>${data.spots.length} spots &middot; Updated: ${updated}</p></div>
        <button onclick="loadSakura()" style="border:1px solid var(--gray-200);background:white;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem">&larr; Back</button>
      </div>`;

    let html = '';
    if (data.jmaStation) {
      const jma = data.jmaStation;
      html += `<div class="spot-item" style="background:var(--pink-light)">
        <h4>JMA Station: ${jma.name}</h4>
        ${bloomBar(jma.bloomRate, jma.fullRate, jma.fullForecast)}
      </div>`;

      // Load weather for this city
      loadWeatherCard(jma.name);
    }
    for (const spot of data.spots) {
      html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToSpot',lat:spot.lat,lon:spot.lon,name:spot.name,bloomRate:spot.bloomRate,fullRate:spot.fullRate,status:spot.status,fullBloomForecast:spot.fullBloomForecast})})">
        <h4>${spot.name} ${spot.nameRomaji ? '<span style="font-weight:400;color:var(--gray-600)">'+spot.nameRomaji+'</span>' : ''}</h4>
        ${bloomBar(spot.bloomRate, spot.fullRate, spot.fullBloomForecast)}
        <div class="sub" style="margin-top:4px">
          ${fmtDates(spot.bloomForecast, spot.bloomRate, spot.fullBloomForecast, spot.fullRate)}
          &nbsp;&middot;&nbsp; <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.bloom}">Google Maps &rarr;</a>
        </div>
      </div>`;
    }
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
  }
}

function flyToSpot(lat, lon, name, bloomRate, fullRate, status, fullBloomForecast) {
  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar').scrollTop = 0;
    mapInstance.invalidateSize();
  }
  mapInstance.flyTo([lat, lon], 14, { duration: 0.8 });
  const hasTimeline = hasSakuraTimelineData(bloomRate, fullRate, null, fullBloomForecast);
  const phase = hasTimeline ? sakuraPhase(bloomRate, fullRate, fullBloomForecast) : null;
  const liveStatus = spotLiveStatus({ bloomRate, fullRate, fullBloomForecast, status });
  const isPostPeak = phase ? isPostPeakSakuraPhase(phase) : false;
  const statusColor = phase ? sakuraPhaseColor(phase) : C.gray;
  const rate = fullRate > 0 ? fullRate : bloomRate;
  const label = fullRate > 0 ? 'Flowering' : 'Growth';
  const grad = fullRate > 0 ? `linear-gradient(90deg,${C.starting},${C.peak})` : `linear-gradient(90deg,${C.bud},${C.budOpen})`;
  const barHtml = !isPostPeak && rate > 0 ? `<div style="margin:8px 0">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:3px"><span>${label}</span><span>${rate}%</span></div>
    <div style="height:14px;background:#f0f0f0;border-radius:7px;overflow:hidden">
      <div style="width:${Math.min(rate,100)}%;height:100%;background:${grad};border-radius:7px"></div>
    </div></div>` : '';
  L.popup().setLatLng([lat, lon])
    .setContent(`<div style="min-width:220px">
      <b>${name}</b>
      ${barHtml}
      <div style="margin:4px 0"><b style="color:${statusColor}">${liveStatus}</b></div>
      <div class="popup-weather" data-lat="${lat}" data-lon="${lon}" style="font-size:11px;color:#555;margin-top:6px;padding-top:6px;border-top:1px solid #eee;min-height:54px">
        <div style="color:#ccc;font-size:11px">Loading weather…</div>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
    </div>`)
    .openOn(mapInstance);
}

// ── KOYO ──
async function loadKoyo() {
  $('sidebar-header').innerHTML = '<h2>Autumn Leaves Forecast</h2><p>687 spots across Japan</p>';
  $('sidebar-content').innerHTML = '<div class="loading">Loading...</div>';
  updateLegend('koyo');
  clearMarkers();

  // Off-season banner (koyo season = roughly Sep–Nov, forecasts released ~Aug)
  const month = new Date().getMonth() + 1; // 1–12
  const isKoyoSeason = KOYO_MONTHS.includes(month);
  const offSeasonBanner = !isKoyoSeason
    ? `<div style="margin:12px 16px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:0.82rem;color:#92400e">
        🍂 <b>Autumn leaves season is Oct–Nov.</b><br>
        JMA releases forecasts in August — dates shown below are from last season and may not reflect 2026 conditions.
        Check back in August for updated forecasts.
      </div>`
    : '';

  try {
    const data = await api('/api/koyo/forecast');
    let html = offSeasonBanner;
    for (const region of data.regions) {
      html += `<div style="padding:12px 16px;background:var(--orange-light);font-weight:600;font-size:0.85rem;border-bottom:1px solid var(--gray-200)">${region.name}</div>`;
      for (const city of region.cities) {
        const mapleDate = city.maple ? fmtDate(city.maple.forecast) : '—';
        const ginkgoDate = city.ginkgo ? fmtDate(city.ginkgo.forecast) : '—';
        const prefCode = city.code.slice(0, 2);
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadKoyoSpots',prefCode:prefCode,name:city.prefName||city.name})})">
          <h4>${city.name} <span style="font-weight:400;color:var(--gray-400)">${city.prefName || ''}</span></h4>
          <div class="sub">Maple: ${mapleDate}${city.maple ? ' · '+city.maple.normalDiffClass : ''} &nbsp; Ginkgo: ${ginkgoDate}</div>
        </div>`;
      }
    }
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
  }
}

async function loadKoyoSpots(prefCode, name) {
  pushUrlState({ mode: 'koyo', pref: prefCode });
  $('sidebar-header').innerHTML = `<h2>${name} Spots</h2><p>Loading...</p>`;
  try {
    const data = await api(`/api/koyo/spots?pref=${prefCode}`);
    clearMarkers();
    const bounds = [];
    for (const spot of data.spots) {
      if (!spot.lat || !spot.lon) continue;
      const color = spot.status.includes('Peak') ? C.koyoPeak : spot.status.includes('Turning') ? C.koyoEarly : C.dormant;
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius: 7, fillColor: color, color: 'white', weight: 1.5, fillOpacity: 0.9,
      }).addTo(mapInstance);
      marker.bindPopup(`<b>${spot.name}</b><br>${spot.status}<br>Peak: ${fmtDate(spot.bestPeak)}<br><a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" style="color:${C.koyoPeak}">Open in Google Maps &rarr;</a>`);
      markers.push(marker);
      bounds.push([spot.lat, spot.lon]);
    }
    if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });

    $('sidebar-header').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><h2>${name}</h2><p>${data.spots.length} spots</p></div>
        <button onclick="loadKoyo()" style="border:1px solid var(--gray-200);background:white;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem">&larr; Back</button>
      </div>`;

    let html = '';
    for (const spot of data.spots) {
      const stars = spot.popularity > 0 ? '★'.repeat(spot.popularity) : '';
      html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToSpot',lat:spot.lat,lon:spot.lon,name:spot.name,bloomRate:0,fullRate:0,status:spot.status})})">
        <h4>${spot.name} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${spot.nameRomaji}</span>` : ''} ${stars ? `<span style="color:${C.koyoPeak}">${stars}</span>` : ''}</h4>
        <div class="sub">${spot.leafType} &middot; Peak: <strong>${fmtDate(spot.bestPeak)}</strong> (${fmtDate(spot.bestStart)} → ${fmtDate(spot.bestEnd)})
          &nbsp;&middot;&nbsp; <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.koyoPeak}">Google Maps &rarr;</a>
        </div>
      </div>`;
    }
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
  }
}

// ── Find Best Dates ──
async function findBestDates() {
  const start = $('date-start')?.value;
  const end = $('date-end')?.value;
  if (!start || !end) { alert('Pick both dates'); return; }

  $('sidebar-header').innerHTML = `<h2>Best for ${start} to ${end}</h2><p>Searching...</p>`;
  $('sidebar-content').innerHTML = '<div class="loading">Finding blooms...</div>';

  try {
    const data = await api(`/api/sakura/best?start=${start}&end=${end}`);
    if (!data.matches?.length) {
      $('sidebar-header').innerHTML = `<h2>No blooms found</h2><p>${start} to ${end}</p>`;
      $('sidebar-content').innerHTML = `<div class="loading">No cities in bloom during these dates.<br><br>Season: Okinawa Jan-Feb, Kyushu/Kansai late Mar, Kanto early Apr, Tohoku mid Apr, Hokkaido late Apr-May.</div>`;
      return;
    }

    $('sidebar-header').innerHTML = `<h2>${data.matches.length} cities in bloom</h2><p>${start} to ${end}</p>`;
    let html = '';
    for (const city of data.matches) {
      const st = statusText(city.status);
      html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:city.prefCode,prefName:city.prefName})})">
        <h4>${city.cityName} <span style="font-weight:400;color:var(--gray-400)">${city.prefName}</span></h4>
        <div class="sub">
          <span class="badge ${st.cls}">${st.text}</span>
          &nbsp; Full bloom: ${sakuraDateOk(city.fullBloom.forecast) ? fmtDate(city.fullBloom.forecast) : '—'}${city.fullBloom.observation ? ' → '+fmtDate(city.fullBloom.observation) : ''}
        </div>
      </div>`;
    }
    $('sidebar-content').innerHTML = html;
  } catch (e) {
    $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
  }
}

// ── Map helpers ──
function clearMarkers() {
  markers.forEach(m => mapInstance.removeLayer(m));
  markers = [];
  if (clusterGroup) { mapInstance.removeLayer(clusterGroup); clusterGroup = null; }
}

function updateLegend(type) {
  const el = $('legend');
  let body = '';
  if (type === 'sakura') {
    body = `
      <div style="font-weight:600;margin-bottom:4px">Bloom Lifecycle</div>
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
      <div class="legend-row"><div style="background:${C.peak};color:white;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:9px">★</div> Kawazu cherry (early)</div>`;
  } else if (type === 'koyo') {
    body = `
      <div style="font-weight:600;margin-bottom:4px">Leaf Status</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.koyoPeak}"></div> Peak colors</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.koyoTurn}"></div> Turning</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.dormant}"></div> Not yet / ended</div>`;
  } else if (type === 'flowers') {
    body = `
      <div style="font-weight:600;margin-bottom:4px">Seasonal Flowers</div>
      <div class="legend-row"><span style="font-size:16px;color:#e11d48">🌸</span> Plum (Jan–Mar)</div>
      <div class="legend-row"><span style="font-size:16px">💜</span> Wisteria (Apr–May)</div>
      <div class="legend-row"><span style="font-size:16px">💙</span> Hydrangea (Jun–Jul)</div>`;
  } else if (type === 'whatson') {
    body = `
      <div style="font-weight:600;margin-bottom:4px">What's On</div>
      <div class="legend-row"><span style="font-size:14px">🎆</span> Fireworks</div>
      <div class="legend-row"><span style="font-size:14px">🏮</span> Matsuri</div>
      <div class="legend-row"><span style="font-size:14px">❄️</span> Winter event</div>
      <div class="legend-row"><span style="font-size:14px;color:#e11d48">🌸</span> Plum (Jan–Mar)</div>
      <div class="legend-row"><span style="font-size:14px">💜</span> Wisteria</div>
      <div class="legend-row"><span style="font-size:14px">💙</span> Hydrangea</div>
      <div class="legend-row"><div class="legend-dot" style="background:${C.green}"></div> Fruit farm</div>`;
  } else {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.className = 'legend';
  el.innerHTML = `<button class="legend-toggle-btn" onclick="this.closest('.legend').classList.toggle('expanded')">Legend ▾</button><div class="legend-body">${body}</div>`;
}

// ── FLOWERS ──
let flowersCache = null;
let flowersTypeFilter = 'all'; // 'all', 'wisteria', or 'hydrangea'

async function loadFlowers() {
  $('sidebar-header').innerHTML = '<h2>Seasonal Flowers</h2><p>Loading...</p>';
  clearMarkers();
  updateLegend('flowers');

  if (!flowersCache) {
    try { flowersCache = await api('/api/flowers'); } catch (e) {
      $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">Could not load flowers data</div>`;
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
        html: `<div style="background:white;border:2.5px solid ${ft.color};border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 4px rgba(0,0,0,0.25);opacity:${opacity}">${ft.emoji}</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      })
    });

    const peakLabel = spot.peakStart && spot.peakEnd
      ? `${spot.peakStart.replace(/^0/, '').replace('-', '/')} – ${spot.peakEnd.replace(/^0/, '').replace('-', '/')}`
      : '';

    marker.bindPopup(`<div style="min-width:220px">
      <b>${spot.name}</b>
      ${spot.nameJa ? `<span style="color:#888;font-size:12px;margin-left:4px">${spot.nameJa}</span>` : ''}
      <div style="margin:6px 0 2px;font-size:12px;color:#555">${ft.emoji} ${ft.name} · ${spot.prefecture}</div>
      ${peakLabel ? `<div style="font-size:12px;color:#555">Peak: <b>${peakLabel}</b></div>` : ''}
      ${spot.note ? `<div style="font-size:11px;color:#777;margin-top:4px">${spot.note}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:8px">
        ${spot.url ? `<a href="${spot.url}" target="_blank" style="color:${ft.color};font-size:12px;font-weight:500">Official site →</a>` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
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
    const typeList = inSeasonTypes.map(ft => `${ft.emoji} <b>${ft.name}</b>`).join(' · ');
    bannerHtml = `<div style="margin:10px 16px;padding:10px 12px;background:${primary.sectionBg};border:1px solid ${primary.color}44;border-radius:8px;font-size:0.82rem;color:${primary.color}">
      <div style="font-weight:600;margin-bottom:4px">${typeList} — in season now</div>
      ${inSeasonTypes.map(ft => `<div style="color:${ft.color};margin-top:2px;font-size:0.79rem">${ft.emoji} ${ft.note}</div>`).join('')}
    </div>`;
  } else {
    const nextFt = FLOWER_TYPES.find(ft => ft.months[0] > currentMonth) || FLOWER_TYPES[0];
    bannerHtml = `<div style="margin:10px 16px;padding:10px 12px;background:#f8fafc;border:1px solid var(--gray-200);border-radius:8px;font-size:0.82rem;color:var(--gray-600)">
      🌷 <b>Off-season.</b> Flower seasons run January–October across 8 types.<br>
      Next up: <b>${nextFt.emoji} ${nextFt.name} (${nextFt.peakLabel})</b><br>
      <span style="color:var(--gray-400);font-size:0.77rem">Dates shown are typical averages — actual bloom shifts with weather each year. Check official sites before visiting.</span>
    </div>`;
  }

  // Type filter tabs — built from FLOWER_TYPES
  const typeTabHtml = `<div style="display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--gray-200);flex-wrap:wrap">
    ${[{type:'all',label:'All',color:'#555'}, ...FLOWER_TYPES.map(ft=>({type:ft.type,label:`${ft.emoji} ${ft.name}`,color:ft.color}))].map(({type,label,color}) => {
      const isActive = flowersTypeFilter === type;
      return `<button onclick="flowersTypeFilter='${type}';renderFlowers()" style="padding:4px 12px;border-radius:20px;border:1px solid ${isActive ? color : 'var(--gray-200)'};background:${isActive ? color : 'white'};color:${isActive ? 'white' : 'var(--gray-600)'};font-size:0.78rem;cursor:pointer;font-weight:${isActive?'600':'400'}">${label}</button>`;
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
      <h4>${ft?.emoji || ''} ${spot.name}
        <span style="font-weight:400;color:var(--gray-400);font-size:0.82rem">${spot.nameJa || ''}</span>
        ${isInSeason ? `<span style="background:${C.greenLight};color:${C.green};font-size:0.7rem;padding:1px 6px;border-radius:10px;margin-left:4px;font-weight:500">In season</span>` : ''}
      </h4>
      <div class="sub">${spot.prefecture} · ${spot.region}</div>
      ${peakLabel ? `<div class="sub">Peak: <b>${peakLabel}</b></div>` : ''}
      ${spot.note ? `<div class="sub" style="margin-top:2px;font-style:italic;color:var(--gray-400)">${spot.note}</div>` : ''}
      <div class="sub" style="margin-top:4px">
        ${spot.url ? `<a href="${spot.url}" target="_blank" onclick="event.stopPropagation()" style="color:#7c3aed;font-size:0.78rem">Official site →</a> &nbsp;` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.bloom};font-size:0.78rem">Google Maps →</a>
      </div>
    </div>`;
  }

  let html = bannerHtml + typeTabHtml;

  for (const ft of FLOWER_TYPES) {
    if (flowersTypeFilter !== 'all' && ft.type !== flowersTypeFilter) continue;
    const typeSpots = spots.filter(s => s.type === ft.type);
    const inSeason = typeSpots.filter(s => ft.months.includes(currentMonth));
    const offSeason = typeSpots.filter(s => !ft.months.includes(currentMonth));

    const sectionBg = ft.sectionBg || '#f8fafc';
    const peakLabel = ft.peakLabel || '';
    html += `<div style="padding:10px 16px;background:${sectionBg};font-weight:600;font-size:0.85rem;color:${ft.color};border-bottom:1px solid var(--gray-200)">
      ${ft.emoji} ${ft.name} (${ft.ja}) — ${typeSpots.length} spots &nbsp;<span style="font-weight:400;font-size:0.78rem;color:#666">Peak: ${peakLabel}</span>
    </div>`;
    html += `<div style="padding:8px 16px 0;font-size:0.79rem;color:var(--gray-600);font-style:italic">${ft.note}</div>`;

    if (inSeason.length) {
      html += `<div style="padding:6px 16px;font-size:0.78rem;font-weight:600;color:${C.green}">In season now (${inSeason.length})</div>`;
      inSeason.forEach(s => html += flowerCard(s));
    }
    if (offSeason.length) {
      const label = ft.months[0] > currentMonth ? 'Coming up' : 'Past season';
      html += `<div style="padding:6px 16px;font-size:0.78rem;font-weight:600;color:var(--gray-400)">${label} (${offSeason.length})</div>`;
      offSeason.forEach(s => html += flowerCard(s));
    }
  }

  $('sidebar-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <h2 style="margin:0">Seasonal Flowers</h2>
      <span style="font-size:0.78rem;color:var(--gray-400)">${spots.length} curated spots</span>
    </div>
    <p style="margin-top:2px">8 types · Jan–Oct · ${spots.length} spots · Official links</p>`;
  $('sidebar-content').innerHTML = html;
}

// ── Major tourist cities for trip planner ──
const TOURIST_CITIES = {
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
};

// City → prefecture code (for koyo lookup in trip planner)
const CITY_PREF = {
  "tokyo":"13","yokohama":"14","kamakura":"14","hakone":"14","kawaguchiko":"19","fuji":"22","izu":"22",
  "osaka":"27","kyoto":"26","nara":"29","kobe":"28","uji":"26",
  "hiroshima":"34","miyajima":"34","okayama":"33","naoshima":"37",
  "sapporo":"01","hakodate":"01","aomori":"02","akita":"05","morioka":"03",
  "sendai":"04","nikko":"09","matsumoto":"20",
  "fukuoka":"40","nagasaki":"42","kumamoto":"43","kagoshima":"46","beppu":"44",
  "nagoya":"23","takayama":"21","shirakawago":"17","kanazawa":"17",
  "takamatsu":"37","matsuyama":"38","matsue":"32","okinawa":"47","naha":"47",
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
    `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ede9fe;border:1px solid #a78bfa;border-radius:12px;font-size:0.78rem;color:#5b21b6">
      ${c.charAt(0).toUpperCase()+c.slice(1)}
      <button onclick="removeFreetextCity('${c}')" style="background:none;border:none;cursor:pointer;color:#7c3aed;font-size:0.85rem;line-height:1;padding:0 1px">×</button>
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
    ? `Not found: ${notFound.join(', ')} — try a nearby city or check spelling`
    : '';
  renderFreetextTags();
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
  $('sidebar-header').innerHTML = '<h2>Plan My Trip</h2><p>What to expect during your travel dates</p>';
  updateLegend('sakura');

  // Default dates: today + 7 days
  const today = new Date();
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  const fmt = d => d.toISOString().slice(0, 10);
  const chips = QUICK_CITIES.map(c =>
    `<button class="city-chip" onclick="toggleCity('${c.toLowerCase()}',this)">${c}</button>`
  ).join('');

  $('sidebar-content').innerHTML = `
    <div style="padding:16px 16px 12px">
      <div style="font-size:0.82rem;color:var(--gray-600);margin-bottom:5px">Travel dates</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <input type="date" id="trip-start" value="${fmt(today)}" style="flex:1;padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:0.85rem">
        <span style="color:var(--gray-400);font-size:0.82rem">to</span>
        <input type="date" id="trip-end" value="${fmt(nextWeek)}" style="flex:1;padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:0.85rem">
      </div>
      <div style="font-size:0.82rem;color:var(--gray-600);margin-bottom:7px">Where are you going? <span style="color:var(--gray-400);font-weight:400">(optional — leave blank for Japan-wide)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">${chips}</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input type="text" id="city-freetext" placeholder="Or type city name(s), comma-separated…" style="flex:1;padding:6px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:0.8rem;color:var(--gray-800)" onkeydown="if(event.key==='Enter')addTypedCities()">
        <button onclick="addTypedCities()" style="padding:6px 10px;background:var(--gray-800);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.8rem;white-space:nowrap">+ Add</button>
      </div>
      <div id="city-freetext-tags" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px"></div>
      <div id="city-freetext-err" style="font-size:0.75rem;color:${C.error};min-height:16px;margin-bottom:4px"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <label style="font-size:0.82rem;color:var(--gray-600);white-space:nowrap">Radius:</label>
        <select id="trip-radius" style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:0.82rem">
          <option value="15">15 km</option>
          <option value="30" selected>30 km</option>
          <option value="50">50 km</option>
          <option value="100">100 km</option>
        </select>
        <button onclick="searchTrip()" style="flex:1;padding:8px;background:var(--pink);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">Find experiences</button>
      </div>
    </div>
    <div id="trip-results"></div>`;
}

async function searchTrip() {
  const startVal = $('trip-start')?.value;
  const endVal = $('trip-end')?.value;
  if (!startVal || !endVal) { alert('Pick travel dates'); return; }
  const startDate = new Date(startVal), endDate = new Date(endVal);
  if (isNaN(startDate) || isNaN(endDate)) { alert('Invalid dates'); return; }

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

  $('trip-results').innerHTML = '<div class="loading">Loading...</div>';

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
        const sakuraCluster = L.markerClusterGroup({ maxClusterRadius: 30, showCoverageOnHover: false,
          iconCreateFunction: cluster => {
            const n = cluster.getChildCount();
            const sz = Math.min(30 + Math.log2(n) * 5, 50);
            return L.divIcon({ html: `<div style="background:${C.bloom};color:white;width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${n}</div>`, className: '', iconSize: [sz, sz] });
          }
        });
        for (const spot of allSpotsData.spots) {
          if (!spot.lat || !spot.lon) continue;
          const col = sakuraColor(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
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
          mk.bindPopup(`<b>${c.cityName}</b><br>${c.prefName}<br><span style="color:${C.peak}">${c.status||''}</span><br>Full bloom: ${sakuraDateOk(c.fullBloom?.forecast) ? fmtDate(c.fullBloom.forecast) : '—'}`);
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
        clusterGroup = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false,
          iconCreateFunction: cluster => {
            const n = cluster.getChildCount();
            const sz = Math.min(32 + n * 0.2, 48);
            return L.divIcon({ html: `<div style="background:${C.green};color:white;width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
          }
        });
        for (const farm of seasonFarms) {
          const emoji = FRUITS.find(f => farm.fruits?.includes(f.name) && f.months.includes(m))?.emoji || '🌿';
          const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
          const mk = L.marker([farm.lat, farm.lon], {
            icon: L.divIcon({ html: `<div style="background:white;border:2px solid ${C.green};border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,0.2)">${emoji}</div>`, className: '', iconSize: [22, 22], iconAnchor: [11, 11] })
          });
          mk.bindPopup(farmPopupHtml(farm, m));
          clusterGroup.addLayer(mk);
        }
        mapInstance.addLayer(clusterGroup);
      }

      // ── Sidebar (no-city) ──
      const seasonItems = [];
      if (isSakuraSeason) seasonItems.push(`🌸 Cherry blossom${m >= 3 && m <= 4 ? ` <b style="color:${C.peak}">(peak season!)</b>` : ''}`);
      if (inSeasonFruits.length) seasonItems.push(`${inSeasonFruits[0].emoji} Fruit picking: ${inSeasonFruits.map(f=>f.name).join(', ')}`);
      if (isKoyoSeason) seasonItems.push(`🍂 Autumn leaves${m >= 10 && m <= 11 ? ` <b style="color:${C.koyoPeak}">(peak season!)</b>` : ''}`);
      if (!seasonItems.length) seasonItems.push('🌿 Off-peak season — great for fruit picking');

      const spotCount = allSpotsData?.spots?.length || 0;
      let html = `<div style="margin:10px 16px;padding:10px 12px;background:#f8fafc;border:1px solid var(--gray-200);border-radius:8px;font-size:0.82rem">
        <b>Japan-wide in ${MO[m-1]}:</b>${seasonItems.map(s=>`<div style="margin-top:4px">${s}</div>`).join('')}
        ${isSakuraSeason && spotCount ? `<div style="margin-top:6px;color:var(--gray-400);font-size:0.78rem">${spotCount.toLocaleString()} spots on map — pick a city above to filter nearby</div>` : `<div style="margin-top:6px;color:var(--gray-400);font-size:0.78rem">Pick cities above to zoom in</div>`}
      </div>`;

      if (isSakuraSeason && bestCities.length) {
        html += `<div style="padding:10px 16px;background:var(--pink-light);font-weight:600;font-size:0.85rem;color:var(--pink-dark);border-bottom:1px solid var(--gray-200)">🌸 Best cities to visit ${startVal} – ${endVal}</div>`;
        bestCities.slice(0, 12).forEach(c => {
          const st = statusText(c.status);
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'loadPrefSpots',prefCode:c.prefCode,prefName:c.prefName})})">
            <h4>${c.cityName} <span style="font-weight:400;color:var(--gray-400)">${c.prefName}</span></h4>
            <div class="sub"><span class="badge ${st.cls}">${st.text}</span> &nbsp; Full bloom: ${sakuraDateOk(c.fullBloom?.forecast) ? fmtDate(c.fullBloom.forecast) : '—'}</div>
          </div>`;
        });
      }
      if (inSeasonFruits.length) {
        html += `<div style="padding:10px 16px;background:${C.greenLight};font-weight:600;font-size:0.85rem;color:${C.greenMid};border-top:1px solid var(--gray-200);border-bottom:1px solid ${C.greenBorder}">🍎 Fruit Picking — ${seasonFarms.length} farms across Japan</div>`;
        html += `<div style="padding:8px 16px;font-size:0.82rem;color:var(--gray-600)">Pick cities above to see nearby farms, or explore the map.</div>`;
      }
      if (isKoyoSeason) {
        html += `<div style="margin:10px 16px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:0.82rem;color:#92400e">🍂 Select cities to see autumn leaves spots, or switch to the <b>Autumn Leaves</b> tab for a full forecast map.</div>`;
      }
      $('trip-results').innerHTML = html;
      return;
    }

    // ── City-based mode ──

    // City pin markers
    for (const city of resolved) {
      const pin = L.marker([city.lat, city.lon], {
        icon: L.divIcon({
          html: `<div style="background:#3b82f6;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">📍</div>`,
          className: '', iconSize: [28, 28], iconAnchor: [14, 14],
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
      clusterGroup = L.markerClusterGroup({ maxClusterRadius: 35, showCoverageOnHover: false,
        iconCreateFunction: cluster => {
          const n = cluster.getChildCount();
          const sz = Math.min(34 + n * 0.3, 52);
          return L.divIcon({ html: `<div style="background:${clusterColor};color:white;width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
        }
      });
      for (const spot of nearbySakura) {
        const mk = L.circleMarker([spot.lat, spot.lon], {
          radius: 7,
          fillColor: spot._tripColor,
          color: 'white', weight: 1.5, fillOpacity: 0.9,
        });
        mk.bindPopup(spotPopupHtml(spot));
        clusterGroup.addLayer(mk);
        bounds.push([spot.lat, spot.lon]);
      }
      mapInstance.addLayer(clusterGroup);
    }

    // Fruit markers
    for (const farm of nearbyFarms) {
      const emoji = FRUITS.find(f => farm.fruits?.includes(f.name) && f.months.includes(m))?.emoji || '🌿';
      const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
      const mk = L.marker([farm.lat, farm.lon], {
        icon: L.divIcon({ html: `<div style="background:white;border:2px solid ${C.green};border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,0.2)">${emoji}</div>`, className: '', iconSize: [24, 24], iconAnchor: [12, 12] })
      });
      mk.bindPopup(farmPopupHtml(farm, m));
      mk.addTo(mapInstance);
      markers.push(mk);
      bounds.push([farm.lat, farm.lon]);
    }

    // Koyo markers (orange dots)
    for (const spot of nearbyKoyo) {
      const col = spot.status?.includes('Peak') ? C.koyoPeak : spot.status?.includes('Turning') ? C.koyoTurn : C.koyoEarly;
      const mk = L.circleMarker([spot.lat, spot.lon], { radius: 7, fillColor: col, color: 'white', weight: 1.5, fillOpacity: 0.9 });
      mk.bindPopup(`<b>${spot.name}</b><br>${spot.status}<br>Peak: ${fmtDate(spot.bestPeak)}<br><a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" style="color:${C.koyoPeak};font-size:12px">Google Maps →</a>`);
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
        seasonItems.push(`🌸 Cherry blossom: ${nearbySakura.length} spots match your dates${sakuraParts.length ? ` (${sakuraParts.join(', ')})` : ''}`);
      } else {
        seasonItems.push('🌿 Cherry blossom: mostly past peak for these cities and dates');
      }
    }
    if (inSeasonFruits.length) seasonItems.push(`${inSeasonFruits[0].emoji} Fruit picking: ${inSeasonFruits.map(f=>f.name).join(', ')}`);
    if (isKoyoSeason) seasonItems.push(`🍂 Autumn leaves${m >= 10 && m <= 11 ? ` <b style="color:${C.koyoPeak}">(peak season!)</b>` : ''}`);
    if (!seasonItems.length) seasonItems.push('🌿 Off-peak season — great for fruit picking farms');

    let html = `<div style="margin:10px 16px;padding:10px 12px;background:#f8fafc;border:1px solid var(--gray-200);border-radius:8px;font-size:0.82rem">
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
        html += `<div style="padding:10px 16px;background:var(--pink-light);font-weight:600;font-size:0.85rem;color:var(--pink-dark);border-bottom:1px solid var(--gray-200)">🌸 Cherry Blossom — ${nearbySakura.length} spots that match your dates (${stateNote})</div>`;
        nearbySakura.slice(0, 20).forEach(spot => {
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToSpot',lat:spot.lat,lon:spot.lon,name:spot.name,bloomRate:spot.bloomRate,fullRate:spot.fullRate,status:spot.status,fullBloomForecast:spot.fullBloomForecast})})">
            <h4>${spot.name} ${spot.nameRomaji ? '<span style="font-weight:400;color:var(--gray-600)">'+spot.nameRomaji+'</span>' : ''}</h4>
            <div class="sub" style="margin-top:4px">${spot.dist}km from ${spot.city.charAt(0).toUpperCase()+spot.city.slice(1)} &middot; ${fmtDates(spot.bloomForecast,spot.bloomRate,spot.fullBloomForecast,spot.fullRate)}</div>
          </div>`;
        });
        if (nearbySakura.length > 20) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-400)">+ ${nearbySakura.length - 20} more spots on map</div>`;
      } else {
        html += `<div style="padding:10px 16px;background:#f8fafc;font-weight:600;font-size:0.85rem;color:var(--gray-500);border-bottom:1px solid var(--gray-200)">🌿 Cherry Blossom — ended for ${cityLabel} in ${MO[m-1]}</div>`;
        html += `<div style="padding:12px 16px;font-size:0.82rem;color:var(--gray-400)">Cherry blossoms have finished by ${MO[m-1]} in this area — trees are green. Try Hokkaido for late-season bloom (peak early May).</div>`;
      }
    }

    // Fruit section
    if (inSeasonFruits.length) {
      html += `<div style="padding:10px 16px;background:${C.greenLight};font-weight:600;font-size:0.85rem;color:${C.greenMid};border-bottom:1px solid ${C.greenBorder};border-top:1px solid var(--gray-200)">🍎 Fruit Picking — ${nearbyFarms.length} farms within ${radiusKm}km</div>`;
      if (nearbyFarms.length) {
        nearbyFarms.slice(0, 15).forEach(farm => {
          const srcLabel = farm.source === 'jalan' ? 'Jalan' : 'Navitime';
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToFarm',lat:farm.lat,lon:farm.lon})})">
            <h4>${farm.name}</h4>
            <div class="sub">${farm.dist}km · ${(farm.fruits||[]).join(', ')}</div>
            <div class="sub">${farm.address||''}${farm.url ? ` &middot; <a href="${farm.url}" target="_blank" onclick="event.stopPropagation()" style="color:#0369a1">${srcLabel} →</a>` : ''}</div>
          </div>`;
        });
        if (nearbyFarms.length > 15) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-400)">+ ${nearbyFarms.length - 15} more farms on map</div>`;
      } else {
        html += `<div style="padding:12px 16px;font-size:0.82rem;color:var(--gray-400)">No fruit farms within ${radiusKm}km for ${MO[m-1]}. Try a larger radius.</div>`;
      }
    }

    // Koyo section
    if (isKoyoSeason) {
      html += `<div style="padding:10px 16px;background:#fff7ed;font-weight:600;font-size:0.85rem;color:#92400e;border-top:1px solid var(--gray-200);border-bottom:1px solid #fed7aa">🍂 Autumn Leaves — ${nearbyKoyo.length} spots within ${radiusKm}km</div>`;
      if (nearbyKoyo.length) {
        nearbyKoyo.slice(0, 12).forEach(spot => {
          const stars = spot.popularity > 0 ? '★'.repeat(spot.popularity) : '';
          html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:spot.lat,lon:spot.lon})})">
            <h4>${spot.name} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${spot.nameRomaji}</span>` : ''} ${stars ? `<span style="color:${C.koyoPeak};font-size:11px">${stars}</span>` : ''}</h4>
            <div class="sub">${spot.dist}km · Peak: <strong>${fmtDate(spot.bestPeak)}</strong> &middot; ${spot.status}</div>
          </div>`;
        });
        if (nearbyKoyo.length > 12) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-400)">+ ${nearbyKoyo.length - 12} more on map</div>`;
      } else {
        html += `<div style="padding:12px 16px;font-size:0.82rem;color:var(--gray-400)">No koyo spots in database for this area. Try the Autumn Leaves tab for a full Japan map.</div>`;
      }
    }

    $('trip-results').innerHTML = html;
  } catch (e) {
    $('trip-results').innerHTML = `<div style="padding:16px;color:${C.error}">${e.message}</div>`;
  }
}

// ── Find Near Me (geolocation) ──
async function findNearMe() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser');
    return;
  }

  $('btn-nearme').textContent = 'Locating...';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    $('btn-nearme').textContent = 'Near Me';

    $('sidebar-header').innerHTML = `<h2>Spots Near You</h2><p>Within 30km of your location</p>`;
    $('sidebar-content').innerHTML = '<div class="loading">Loading nearby spots...</div>';
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
        const color = sakuraColor(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
        const marker = L.circleMarker([spot.lat, spot.lon], {
          radius: sakuraRadius(spot.bloomRate, spot.fullRate, spot.fullBloomForecast),
          fillColor: color, color: 'white', weight: 1.5, fillOpacity: 0.9,
        }).addTo(mapInstance);
        marker.bindPopup(spotPopupHtml(spot));
        markers.push(marker);
      }

      mapInstance.setView([lat, lon], 12);

      // Sidebar
      $('sidebar-header').innerHTML = `<h2>Spots Near You</h2><p>${nearby.length} spots within 30km</p>`;
      let html = '';
      for (const spot of nearby) {
        html += spotCardHtml(spot, `${spot.distance}km away`);
      }
      if (nearby.length === 0) {
        html = '<div style="padding:20px;text-align:center;color:var(--gray-400)">No sakura spots within 30km. Are you in Japan?</div>';
      }
      $('sidebar-content').innerHTML = html;
    } catch (e) {
      $('sidebar-content').innerHTML = `<div class="loading" style="color:${C.error}">${e.message}</div>`;
    }
  }, (err) => {
    $('btn-nearme').textContent = 'Near Me';
    alert('Could not get your location. Make sure location access is enabled.');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// ── Shared spot popup/card HTML builders ──

function spotPopupHtml(spot) {
  const displayName = spot.nameRomaji ? `${esc(spot.name)} <span style="color:#888">${esc(spot.nameRomaji)}</span>` : esc(spot.name);
  const hasTimeline = hasSakuraTimelineData(spot.bloomRate, spot.fullRate, spot.bloomForecast, spot.fullBloomForecast);
  const phase = hasTimeline ? sakuraPhase(spot.bloomRate, spot.fullRate, spot.fullBloomForecast) : null;
  const liveStatus = spotLiveStatus(spot);
  const isPostPeak = phase ? isPostPeakSakuraPhase(phase) : false;

  // Full-width bar for popup (not the sidebar CSS class which is too narrow)
  let barsHtml = '';
  if (!isPostPeak) {
    const rate = spot.fullRate > 0 ? spot.fullRate : spot.bloomRate;
    const label = spot.fullRate > 0 ? 'Flowering' : 'Growth';
    const grad = spot.fullRate > 0 ? `linear-gradient(90deg,${C.starting},${C.peak})` : `linear-gradient(90deg,${C.bud},${C.budOpen})`;
    barsHtml = `<div style="margin:8px 0">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:3px"><span>${label}</span><span>${rate}%</span></div>
      <div style="height:16px;background:#f0f0f0;border-radius:8px;overflow:hidden">
        <div style="width:${Math.min(rate,100)}%;height:100%;background:${grad};border-radius:8px"></div>
      </div>
    </div>`;
  }

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
    <div style="margin:4px 0"><b style="color:${statusColor}">${liveStatus}</b></div>
    <span style="font-size:11px;color:#888">${fmtDates(spot.bloomForecast, spot.bloomRate, spot.fullBloomForecast, spot.fullRate)}</span>
    <div class="popup-weather" data-lat="${spot.lat}" data-lon="${spot.lon}" style="font-size:11px;color:#555;margin-top:6px;padding-top:6px;border-top:1px solid #eee;min-height:60px">
      <div style="color:#ccc;font-size:11px">Loading weather…</div>
    </div>
    <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
      <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
      <a href="${jmaUrl}" target="_blank" class="jma-city-link" data-lat="${spot.lat}" data-lon="${spot.lon}" style="font-size:10px;color:#94a3b8">JMA forecast →</a>
    </div>
  </div>`;
}

function spotCardHtml(spot, extra) {
  return `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToSpot',lat:spot.lat,lon:spot.lon,name:spot.name,bloomRate:spot.bloomRate,fullRate:spot.fullRate,status:spot.status,fullBloomForecast:spot.fullBloomForecast})})">
    <h4>${esc(spot.name)} ${spot.nameRomaji ? `<span style="font-weight:400;color:var(--gray-600)">${esc(spot.nameRomaji)}</span>` : ''}</h4>
    ${bloomBar(spot.bloomRate, spot.fullRate, spot.fullBloomForecast)}
    <div class="sub" style="margin-top:4px">
      ${extra ? extra + ' &middot; ' : ''}${fmtDates(spot.bloomForecast, spot.bloomRate, spot.fullBloomForecast, spot.fullRate)}
      &middot; <a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.bloom}">Maps</a>
    </div>
  </div>`;
}

// ── Weather card ──
async function loadWeatherCard(cityName) {
  try {
    const data = await api(`/api/weather?city=${encodeURIComponent(cityName)}`);
    const weatherDiv = document.createElement('div');
    weatherDiv.className = 'spot-item';
    weatherDiv.style.background = '#f0f9ff';
    let whtml = '<h4 style="color:#0369a1">Weather Forecast</h4>';
    for (const day of data.forecasts) {
      const temp = day.temperature;
      const maxC = temp?.max?.celsius;
      const rain = day.chanceOfRain;
      const rainHigh = Math.max(
        parseInt(rain?.T06_12) || 0,
        parseInt(rain?.T12_18) || 0,
        parseInt(rain?.T18_24) || 0
      );
      const rainIcon = rainHigh >= 50 ? '🌧' : rainHigh >= 20 ? '🌦' : '☀️';
      whtml += `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.82rem">
        <span>${rainIcon} ${day.dateLabel} ${day.date?.slice(5)}</span>
        <span>${day.telop} ${maxC ? maxC+'°C' : ''} ${rainHigh > 0 ? '<span style="color:#0369a1">'+rainHigh+'%</span>' : ''}</span>
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
  } catch {} // Weather is optional — don't break the page
}

// ── Load all 1,012 spots on map ──
async function loadAllSpotsOnMap() {
  try {
    if (!allSpotsData) {
      allSpotsData = sessionGet('allSpots');
      if (!allSpotsData) {
        allSpotsData = await api('/api/sakura/all-spots');
        sessionSet('allSpots', allSpotsData);
      }
    }

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const childMarkers = cluster.getAllChildMarkers();
        // Count spots by shared phase so cluster colors match dots and labels.
        let ended = 0, falling = 0, pastPeak = 0, peak = 0, blooming = 0, buds = 0, dormant = 0;
        childMarkers.forEach(m => {
          const phase = sakuraPhase(m.options.bloomRate, m.options.fullRate, m.options.fullBloomForecast);
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
        if (ended > n * 0.5) { color = C.ended; textColor = C.greenDark; }      // green — mostly ended
        else if (peak > n * 0.3) { color = C.peak; textColor = 'white'; }       // deep pink — peak
        else if (falling + pastPeak > n * 0.3) {
          color = falling >= pastPeak ? C.falling : sakuraPhaseColor('past_peak');
          textColor = C.peak;
        }
        else if (blooming > n * 0.3) { color = C.bloom; textColor = 'white'; }   // pink — blooming
        else if (buds > n * 0.3) { color = C.budOpen; textColor = 'white'; }       // orange — buds
        else if (ended > 0 && (peak > 0 || pastPeak > 0 || blooming > 0)) { color = C.falling; textColor = C.peak; } // mixed late-season
        else { color = C.dormant; textColor = '#333'; }                             // dormant

        const size = Math.min(38 + n * 0.4, 58);
        return L.divIcon({
          html: `<div style="background:${color};color:${textColor};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${n}</div>`,
          className: '',
          iconSize: [size, size],
        });
      }
    });

    for (const spot of allSpotsData.spots) {
      if (!spot.lat || !spot.lon) continue;
      if (!matchesBloomFilter(bloomCategory(spot.bloomRate, spot.fullRate, spot.fullBloomForecast))) continue;
      const color = sakuraColor(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
      const radius = sakuraRadius(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius, fillColor: color, color: 'white', weight: 1.5, fillOpacity: 0.9,
        bloomRate: spot.bloomRate, fullRate: spot.fullRate, fullBloomForecast: spot.fullBloomForecast,
      });
      marker.bindPopup(spotPopupHtml(spot));
      clusterGroup.addLayer(marker);
    }
    mapInstance.addLayer(clusterGroup);

    // Also load Kawazu cherry spots with distinct markers (★ star, magenta)
    try {
      const kawazu = await api('/api/kawazu');
      for (const spot of kawazu.spots || []) {
        if (!spot.lat || !spot.lon) continue;
        if (!matchesBloomFilter(bloomCategory(spot.bloomRate, spot.fullRate, spot.fullBloomForecast))) continue;
        const kPhase = sakuraPhase(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
        const kawazuColor = kPhase === 'ended' ? C.ended : C.kawazu;
        const m = L.marker([spot.lat, spot.lon], {
          icon: L.divIcon({
            html: `<div style="background:${kawazuColor};color:white;width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)" title="Kawazu Cherry">★</div>`,
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
          })
        }).addTo(mapInstance);
        const kStatus = spotStatusWithDate(spot.bloomRate, spot.fullRate, spot.fullBloomForecast) || 'Kawazu Cherry';
        m.bindPopup(
          `<div style="min-width:200px"><b>${spot.name}</b> ${spot.nameRomaji || ''}<br>` +
          `<em style="color:${C.kawazu}">Kawazu Cherry (河津桜)</em><br>` +
          `<b>${kStatus}</b><br>` +
          `<span style="font-size:11px;color:#888">${fmtDates(spot.bloomForecast, spot.bloomRate, spot.fullBloomForecast, spot.fullRate)}</span><br>` +
          `<a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a></div>`
        );
        markers.push(m);
      }
    } catch {} // Kawazu is bonus — don't break main view

  } catch (e) {
    // Fallback to city markers if all-spots fails
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
        marker.bindPopup(`<div style="min-width:180px"><b>${city.cityName}</b> (${city.prefName})<br><b>${city.status}</b><br><span style="font-size:11px;color:#888">Bloom: ${fmtDate(city.bloom?.forecast)} · Full: ${fmtDate(city.fullBloom?.forecast)}</span></div>`);
        marker.on('click', () => loadPrefSpots(city.prefCode, city.prefName));
        markers.push(marker);
      }
    }
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
    document.querySelectorAll('.spot-item').forEach(el => el.style.display = '');
    return;
  }

  // If we have all spots loaded and query is 3+ chars, do a global search
  if (allSpotsData && q.length >= 3) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => globalSpotSearch(q), 300);
    return;
  }

  // Otherwise filter what's visible in sidebar
  document.querySelectorAll('.spot-item').forEach(el => {
    const text = el.textContent.toLowerCase().replace(/[\s\-]/g, '');
    el.style.display = fuzzyMatch(text, q) ? '' : 'none';
  });
}

function globalSpotSearch(q) {
  const matches = allSpotsData.spots.filter(spot => {
    const text = `${spot.name} ${spot.nameRomaji || ''} ${spot.nameReading || ''} ${spot.prefecture || ''}`.toLowerCase().replace(/[\s\-]/g, '');
    return fuzzyMatch(text, q);
  }).slice(0, 50); // limit to 50 results

  if (matches.length === 0) {
    // Fall back to sidebar filter
    document.querySelectorAll('.spot-item').forEach(el => {
      const text = el.textContent.toLowerCase().replace(/[\s\-]/g, '');
      el.style.display = fuzzyMatch(text, q) ? '' : 'none';
    });
    return;
  }

  // Show results in sidebar
  $('sidebar-header').innerHTML = `<h2>Search: "${q}"</h2><p>${matches.length} spots found${matches.length>=50?' (showing first 50)':''}</p>`;
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
    const color = sakuraColor(spot.bloomRate, spot.fullRate, spot.fullBloomForecast);
    const marker = L.circleMarker([spot.lat, spot.lon], {
      radius: 8, fillColor: color, color: 'white', weight: 2, fillOpacity: 0.9,
    }).addTo(mapInstance);
    marker.bindPopup(spotPopupHtml(spot));
    markers.push(marker);
    bounds.push([spot.lat, spot.lon]);
  }
  if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });
}

// ── WHAT'S ON ──
let festivalsCache = null;
let whatsOnMonth = new Date().getMonth() + 1;

async function loadWhatsOn() {
  $('sidebar-header').innerHTML = '<h2>What\'s On in Japan</h2><p>Loading...</p>';
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
    const ft = FESTIVAL_TYPES.find(t => t.type === f.type) || { emoji: '📅', color: '#64748b' };
    const marker = L.marker([f.lat, f.lon], {
      icon: L.divIcon({
        html: `<div style="background:${ft.color};color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${ft.emoji}</div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
    });
    marker.bindPopup(`<div style="min-width:210px">
      <b>${f.name}</b>
      ${f.nameJa ? `<span style="color:#888;font-size:12px;margin-left:4px">${f.nameJa}</span>` : ''}
      <div style="margin:5px 0 2px;font-size:12px;color:#555">${ft.emoji} ${f.prefecture} · ${f.typicalDate}</div>
      ${f.attendance ? `<div style="font-size:11px;color:#777">Attendance: ~${f.attendance.toLocaleString()}</div>` : ''}
      ${f.note ? `<div style="font-size:11px;color:#777;margin-top:4px">${f.note}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:8px">
        ${f.url ? `<a href="${f.url}" target="_blank" style="color:${ft.color};font-size:12px;font-weight:500">Official site →</a>` : ''}
        <a href="https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}" target="_blank" style="color:${C.bloom};font-size:12px">Google Maps</a>
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
        html: `<div style="background:white;border:2px solid ${ft.color};border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,0.2)">${ft.emoji}</div>`,
        className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      })
    });
    marker.bindPopup(`<div style="min-width:180px"><b>${s.name}</b><br><div style="font-size:12px;color:#555;margin-top:4px">${ft.emoji} ${ft.name} · ${s.prefecture}</div>${s.peakStart ? `<div style="font-size:12px">Peak: <b>${s.peakStart.slice(0,5).replace('-','/')}–${s.peakEnd.slice(0,5).replace('-','/')}</b></div>` : ''}${s.url ? `<a href="${s.url}" target="_blank" style="color:${ft.color};font-size:12px;font-weight:500">Official site →</a>` : ''}</div>`);
    marker.addTo(mapInstance);
    markers.push(marker);
  }

  // Fruit farm cluster
  if (farms.length) {
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40, showCoverageOnHover: false,
      iconCreateFunction: cluster => {
        const n = cluster.getChildCount();
        const sz = Math.min(30 + n * 0.3, 46);
        return L.divIcon({ html: `<div style="background:${C.green};color:white;width:${sz}px;height:${sz}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)">${n}</div>`, className: '', iconSize: [sz, sz] });
      }
    });
    for (const farm of farms) {
      const emoji = FRUITS.find(f => farm.fruits?.includes(f.name) && f.months.includes(m))?.emoji || '🌿';
      const mk = L.marker([farm.lat, farm.lon], {
        icon: L.divIcon({ html: `<div style="background:white;border:2px solid ${C.green};border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.15)">${emoji}</div>`, className: '', iconSize: [20, 20], iconAnchor: [10, 10] })
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
    return `<button onclick="renderWhatsOn(${mn})" style="
      padding:4px 2px; border-radius:6px; border:1px solid ${isActive ? '#0ea5e9' : 'var(--gray-200)'};
      background:${isActive ? '#0ea5e9' : 'white'}; color:${isActive ? 'white' : hasAnything ? 'var(--gray-800)' : 'var(--gray-400)'};
      font-size:0.72rem; font-weight:${isActive || isToday ? '600' : '400'}; cursor:pointer; text-align:center;
      ${isToday && !isActive ? 'border-color:#0ea5e9;color:#0ea5e9;' : ''}
    ">${mo}</button>`;
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
  if (isPlum) seasonCues.push('🌸 Plum blossom' + (m === 2 ? ' — peak!' : ''));
  if (isSakuraSeason) seasonCues.push('🌸 Cherry blossom' + (m === 4 ? ' — peak nationwide!' : ''));
  if (isWisteria) seasonCues.push('💜 Wisteria');
  if (isHydrangea) seasonCues.push('💙 Hydrangea');
  if (isFireworksSeason) seasonCues.push('🎆 Fireworks season');
  if (isKoyoSeason) seasonCues.push('🍂 Autumn leaves');
  if (isWinterEvent) seasonCues.push('❄️ Winter festivals');
  if (inSeasonFruits.length) seasonCues.push(`${inSeasonFruits[0].emoji} Fruit picking: ${inSeasonFruits.slice(0,3).map(f=>f.name).join(', ')}${inSeasonFruits.length > 3 ? '...' : ''}`);

  const bannerColor = isFireworksSeason ? '#fff7ed' : isWinterEvent ? '#eff6ff' : isSakuraSeason ? '#fdf2f8' : isKoyoSeason ? '#fff7ed' : '#f8fafc';
  const bannerBorder = isFireworksSeason ? '#fed7aa' : isWinterEvent ? '#bfdbfe' : isSakuraSeason ? '#fbcfe8' : isKoyoSeason ? '#fed7aa' : 'var(--gray-200)';
  const bannerText = isFireworksSeason ? '#92400e' : isWinterEvent ? '#1e3a8a' : isSakuraSeason ? C.peak : isKoyoSeason ? '#92400e' : 'var(--gray-600)';

  const bannerHtml = seasonCues.length
    ? `<div style="margin:10px 16px;padding:10px 12px;background:${bannerColor};border:1px solid ${bannerBorder};border-radius:8px;font-size:0.82rem;color:${bannerText}">
        <b>${MO[m-1]}${m === todayM ? ' (now)' : ''}:</b> ${seasonCues.join(' &nbsp;·&nbsp; ')}
       </div>`
    : '';

  // ── Sidebar sections ──
  let html = bannerHtml;

  // Festivals section
  if (festivals.length) {
    html += `<div style="padding:10px 16px;font-weight:600;font-size:0.85rem;background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca">📅 Festivals & Events — ${festivals.length} this month</div>`;
    const byType = {};
    for (const f of festivals) {
      if (!byType[f.type]) byType[f.type] = [];
      byType[f.type].push(f);
    }
    for (const ft of FESTIVAL_TYPES) {
      const group = byType[ft.type];
      if (!group) continue;
      html += `<div style="padding:6px 16px;font-size:0.78rem;font-weight:600;color:${ft.color};background:white;border-bottom:1px solid var(--gray-100)">${ft.emoji} ${ft.name} (${group.length})</div>`;
      for (const f of group) {
        const bigEvent = f.attendance >= 500000;
        const biennialBadge = f.years ? `<span style="background:#fefce8;color:#854d0e;font-size:0.68rem;padding:1px 5px;border-radius:8px;margin-left:4px;font-weight:500">${f.years === 'odd' ? 'Odd years' : 'Even years'}</span>` : '';
        html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToFarm',lat:f.lat,lon:f.lon,zoom:12})})" style="cursor:pointer">
          <h4>${f.name}
            ${bigEvent ? '<span style="background:#fef2f2;color:#991b1b;font-size:0.68rem;padding:1px 5px;border-radius:8px;margin-left:4px;font-weight:500">Major</span>' : ''}
            ${biennialBadge}
          </h4>
          <div class="sub">${f.prefecture} · ${f.typicalDate}</div>
          ${f.attendance ? `<div class="sub">Attendance: ~${f.attendance.toLocaleString()}</div>` : ''}
          ${f.note ? `<div class="sub" style="font-style:italic;color:var(--gray-400);margin-top:2px">${f.note}</div>` : ''}
          <div class="sub" style="margin-top:3px">
            ${f.url ? `<a href="${f.url}" target="_blank" onclick="event.stopPropagation()" style="color:${ft.color};font-size:0.78rem">Official site →</a> &nbsp;` : ''}
            <a href="https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.bloom};font-size:0.78rem">Google Maps</a>
          </div>
        </div>`;
      }
    }
  } else {
    html += `<div style="padding:12px 16px;font-size:0.82rem;color:var(--gray-400)">No major festivals in ${MO[m-1]}. Big seasons: Jul-Aug (fireworks), Oct-Nov (autumn matsuri), Jan-Feb (winter).</div>`;
  }

  // Flowers section
  if (flowers.length) {
    const inSeasonFtypes = FLOWER_TYPES.filter(ft => ft.months.includes(m));
    const primary = inSeasonFtypes[0] || { sectionBg: '#f5f3ff', color: '#7c3aed', emoji: '🌸', name: 'Flowers' };
    const flowerLabel = inSeasonFtypes.map(ft => `${ft.emoji} ${ft.name}`).join(' · ');
    html += `<div style="padding:10px 16px;font-weight:600;font-size:0.85rem;background:${primary.sectionBg};color:${primary.color};border-top:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200)">
      ${flowerLabel} — ${flowers.length} spots in season</div>`;
    flowers.slice(0, 6).forEach(s => {
      const ft = FLOWER_TYPES.find(f => f.type === s.type);
      html += `<div class="spot-item" onclick="handleSpotClick(${reg({action:'flyToKoyo',lat:s.lat,lon:s.lon})})" style="cursor:pointer">
        <h4>${ft?.emoji || ''} ${s.name} <span style="font-weight:400;color:var(--gray-400);font-size:0.82rem">${s.nameJa||''}</span></h4>
        <div class="sub">${s.prefecture} · ${s.region}</div>
        ${s.peakStart ? `<div class="sub">Peak: <b>${s.peakStart.slice(0,5).replace('-','/')}–${s.peakEnd.slice(0,5).replace('-','/')}</b></div>` : ''}
        <div class="sub" style="margin-top:3px">
          ${s.url ? `<a href="${s.url}" target="_blank" onclick="event.stopPropagation()" style="color:${ft?.color};font-size:0.78rem">Official site →</a> &nbsp;` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" onclick="event.stopPropagation()" style="color:${C.bloom};font-size:0.78rem">Google Maps</a>
        </div>
      </div>`;
    });
    if (flowers.length > 6) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-400)">+ ${flowers.length - 6} more — <button onclick="setMode('flowers')" style="background:none;border:none;color:#7c3aed;cursor:pointer;font-size:0.78rem;padding:0">See all in Flowers tab</button></div>`;
  }

  // Fruit section
  if (inSeasonFruits.length) {
    html += `<div style="padding:10px 16px;font-weight:600;font-size:0.85rem;background:${C.greenLight};color:${C.greenMid};border-top:1px solid var(--gray-200);border-bottom:1px solid ${C.greenBorder}">
      🍎 Fruit Picking — ${farms.length} farms on map</div>`;
    inSeasonFruits.slice(0, 5).forEach(f => {
      const isPeak = f.peak.includes(m);
      html += `<div class="spot-item" onclick="setMode('fruit');" style="cursor:pointer">
        <h4>${f.emoji} ${f.name} <span style="font-weight:400;color:var(--gray-400)">${f.ja}</span>
          ${isPeak ? `<span style="background:${C.greenSoft};color:${C.green};font-size:0.7rem;padding:1px 5px;border-radius:8px;margin-left:4px">Peak</span>` : ''}
        </h4>
        <div class="sub">Best regions: ${f.regions.slice(0,3).join(', ')}</div>
        <div class="sub" style="margin-top:1px;color:${C.green};font-size:0.77rem">Click to explore ${farms.filter(fm => fm.fruits?.includes(f.name)).length} farms →</div>
      </div>`;
    });
    if (inSeasonFruits.length > 5) html += `<div class="sub" style="padding:8px 16px;color:var(--gray-400)">+ ${inSeasonFruits.length - 5} more fruits — <button onclick="setMode('fruit')" style="background:none;border:none;color:${C.green};cursor:pointer;font-size:0.78rem;padding:0">See all in Fruit tab</button></div>`;
  }

  // Sakura/koyo cross-links
  if (isSakuraSeason) {
    html += `<div style="margin:10px 16px;padding:10px 12px;background:var(--pink-light);border:1px solid #fbcfe8;border-radius:8px;font-size:0.82rem;color:#9d174d">
      🌸 Cherry blossom season! Switch to the <b>Cherry Blossom</b> tab for live bloom data across 1,012 spots.
    </div>`;
  }
  if (isKoyoSeason) {
    html += `<div style="margin:10px 16px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:0.82rem;color:#92400e">
      🍂 Autumn leaves season! Switch to the <b>Autumn Leaves</b> tab for forecasts and 687 viewing spots.
    </div>`;
  }

  $('sidebar-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
      <h2 style="margin:0">What's On in Japan</h2>
      <span style="font-size:0.78rem;color:var(--gray-400)">${MO[m-1]}${m === todayM ? ' — now' : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-top:2px">${monthPills}</div>`;
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
  if (m === 8 || m === 9) return 'fruit';   // Aug–Sep
  return 'whatson'; // Jan (winter festivals, plum blossom)
}

// ── Init ──
// Read URL state on load
(function() {
  const p = new URLSearchParams(location.search);
  const m = p.get('mode');
  if (m && ['sakura','koyo','fruit','flowers','whatson','trip'].includes(m)) {
    initMap(); setMode(m);
    const pref = p.get('pref');
    if (pref && m === 'sakura') loadPrefSpots(pref, pref);
    if (pref && m === 'koyo') loadKoyoSpots(pref, pref);
    return;
  }
  initMap(); setMode(detectSeasonMode());
})();
