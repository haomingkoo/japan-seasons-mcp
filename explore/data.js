// Pure season model for the /explore bloom front. No DOM, so Vitest can cover it.

const DAY_MS = 86400000;
// Mirrors SITE_CONFIG.koyo in src/lib/site-config.ts.
export const KOYO_BEFORE_PEAK = 3;
export const KOYO_AFTER_PEAK = 10;
// Full bloom lasts about a week before petals fall.
export const FULL_BLOOM_DAYS = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Days since 1970-01-01 for the calendar date in an ISO string, ignoring its time and offset.
export function isoToDay(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
}

// "3/24" in the given year.
export function monthDayToDay(md, year) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(md || '');
  if (!m) return null;
  return Date.UTC(year, +m[1] - 1, +m[2]) / DAY_MS;
}

export function dayToDate(day) {
  return new Date(Math.floor(day) * DAY_MS);
}

export function fmtDay(day, withYear = false) {
  if (day == null || !Number.isFinite(day)) return 'No date';
  const d = dayToDate(day);
  const s = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return withYear ? `${s}, ${d.getUTCFullYear()}` : s;
}

export function fmtDiff(days, early = 'earlier', late = 'later') {
  if (days == null || !Number.isFinite(days)) return 'No average to compare';
  const n = Math.round(days);
  if (n === 0) return 'Same as average';
  return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? early : late} than average`;
}

// Approximate JMA city coordinates, matching CITY_COORDS in public/app.js.
export const CITY_COORDS = {
  Kushiro: [42.985, 144.381], Obihiro: [42.92, 143.197], Sapporo: [43.062, 141.354], Asahikawa: [43.771, 142.365],
  Wakkanai: [45.415, 141.673], Abashiri: [44.02, 144.273], Muroran: [42.315, 140.974], Hakodate: [41.769, 140.729],
  Aomori: [40.822, 140.747], Akita: [39.72, 140.103], Morioka: [39.702, 141.154], Sendai: [38.268, 140.872],
  Yamagata: [38.24, 140.364], Fukushima: [37.75, 140.468], Niigata: [37.902, 139.023], Toyama: [36.695, 137.211],
  Kanazawa: [36.561, 136.656], Fukui: [36.065, 136.222], Nagano: [36.651, 138.181], Utsunomiya: [36.555, 139.883],
  Maebashi: [36.391, 139.061], Mito: [36.366, 140.471], Kumagaya: [36.147, 139.389], Choshi: [35.735, 140.827],
  Tokyo: [35.69, 139.692], Yokohama: [35.444, 139.638], Kofu: [35.664, 138.568], Shizuoka: [34.976, 138.383],
  Nagoya: [35.181, 136.906], Gifu: [35.423, 136.761], Tsu: [34.718, 136.505], Hikone: [35.276, 136.259],
  Kyoto: [35.012, 135.768], Osaka: [34.694, 135.502], Kobe: [34.69, 135.196], Nara: [34.685, 135.805],
  Wakayama: [34.226, 135.168], Tottori: [35.501, 134.235], Matsue: [35.468, 133.049], Okayama: [34.662, 133.935],
  Hiroshima: [34.385, 132.455], Shimonoseki: [33.958, 130.941], Tokushima: [34.066, 134.559], Takamatsu: [34.34, 134.043],
  Matsuyama: [33.839, 132.765], Kochi: [33.559, 133.531], Fukuoka: [33.59, 130.401], Saga: [33.249, 130.299],
  Nagasaki: [32.75, 129.877], Kumamoto: [32.803, 130.708], Oita: [33.238, 131.613], Miyazaki: [31.911, 131.424],
  Kagoshima: [31.56, 130.558], Naha: [26.212, 127.681],
};

// Every location carries the same four dates, so both seasons share one renderer:
//   d0 phase starts building, d1 front arrives, d2 peak starts, d3 peak ends.
// Sakura: bloom-10, bloom, full bloom, full bloom + 7.
// Koyo:   start-10, start, peak, end.
function sakuraDates(bloom, full) {
  return [bloom - 10, bloom, full, full + FULL_BLOOM_DAYS];
}

// Region names for JMA stations the forecast leaves out.
const JMA_EXTRA_REGION = {
  Naha: 'Okinawa', Ishigaki: 'Okinawa', Miyakojima: 'Okinawa', Minamidaito: 'Okinawa', Naze: 'Amami',
  Wakkanai: 'Hokkaido', Asahikawa: 'Hokkaido', Abashiri: 'Hokkaido', Obihiro: 'Hokkaido', Kushiro: 'Hokkaido',
};

// Day number (days since 1970) for a day-of-year in a given year.
export function doyToDay(year, doy) {
  return Date.UTC(year, 0, 1) / DAY_MS + doy - 1;
}

export function historyValue(table, name, year, firstYear) {
  const v = table?.[name]?.values?.[year - firstYear];
  return Number.isFinite(v) ? v : null;
}

export function buildSakuraSeason(forecast, spotsPayload, history = null) {
  const cities = [];
  for (const region of forecast?.regions ?? []) {
    for (const c of region.cities ?? []) {
      const coords = CITY_COORDS[c.cityName];
      const bloomObs = isoToDay(c.bloom?.observation);
      const fullObs = isoToDay(c.fullBloom?.observation);
      const bloom = bloomObs ?? isoToDay(c.bloom?.forecast);
      let full = fullObs ?? isoToDay(c.fullBloom?.forecast);
      if (bloom == null || !coords) continue;
      if (full == null || full < bloom) full = bloom + 5;
      const year = dayToDate(bloom).getUTCFullYear();
      const normal = monthDayToDay(c.bloom?.normal, year);
      const normalFull = monthDayToDay(c.fullBloom?.normal, year);
      cities.push({
        name: c.cityName,
        region: c.region || region.nameEn,
        lat: coords[0], lon: coords[1],
        front: bloom, peak: full,
        dates: sakuraDates(bloom, full),
        normal, normalPeak: normalFull,
        diff: normal == null ? null : bloom - normal,
        observed: bloomObs != null,
        peakObserved: fullObs != null,
      });
    }
  }
  // Cities the forecast leaves out (Okinawa, Amami, eastern and northern Hokkaido) come from
  // this season's JMA observations, when the history file covers the same year.
  const year = cities.length ? dayToDate(cities[0].front).getUTCFullYear() : null;
  if (history && year === history.currentYear) {
    const have = new Set(cities.map((c) => c.name));
    for (const [name, region] of Object.entries(JMA_EXTRA_REGION)) {
      if (have.has(name)) continue;
      const b = historyValue(history.sakuraBloom, name, year, history.firstYear);
      const f = historyValue(history.sakuraFull, name, year, history.firstYear);
      const coords = history.stations?.[name];
      if (b == null || !coords) continue;
      const bloom = doyToDay(year, b);
      const full = f != null && f >= b ? doyToDay(year, f) : bloom + 5;
      const n = history.sakuraBloom[name].normal;
      const normal = n != null ? doyToDay(year, n) : null;
      cities.push({
        name, region, lat: coords[0], lon: coords[1],
        front: bloom, peak: full, dates: sakuraDates(bloom, full),
        normal, normalPeak: null,
        diff: normal == null ? null : bloom - normal,
        observed: true, peakObserved: f != null,
        jmaOnly: true, species: history.sakuraBloom[name].species || null,
      });
    }
  }
  const spots = [];
  for (const s of spotsPayload?.spots ?? []) {
    const bloom = isoToDay(s.bloomForecast);
    let full = isoToDay(s.fullBloomForecast);
    if (bloom == null || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (full == null || full < bloom) full = bloom + 5;
    spots.push({
      name: s.nameRomaji || s.name, nameJa: s.name, pref: s.prefecture,
      lat: s.lat, lon: s.lon, front: bloom, peak: full, dates: sakuraDates(bloom, full),
    });
  }
  return finishSeason('sakura', cities, spots);
}

export function buildKoyoSeason(forecast, spotsPayload) {
  const cities = [];
  for (const region of forecast?.regions ?? []) {
    for (const c of region.cities ?? []) {
      const coords = CITY_COORDS[c.nameEn];
      const peak = isoToDay(c.maple?.forecast) ?? isoToDay(c.ginkgo?.forecast);
      if (peak == null || !coords) continue;
      const diffDays = c.maple?.forecast ? c.maple.normalDiffDays : c.ginkgo?.normalDiffDays;
      const diff = Number.isFinite(diffDays) ? diffDays : null;
      const start = peak - KOYO_BEFORE_PEAK;
      cities.push({
        name: c.nameEn,
        region: c.prefNameEn || region.name,
        lat: coords[0], lon: coords[1],
        front: start, peak,
        dates: [start - 10, start, peak, peak + KOYO_AFTER_PEAK],
        normal: diff == null ? null : peak - diff,
        diff,
        observed: false,
        peakObserved: false,
      });
    }
  }
  const spots = [];
  for (const s of spotsPayload?.spots ?? []) {
    const start = isoToDay(s.bestStart);
    const peak = isoToDay(s.bestPeak) ?? start;
    const end = isoToDay(s.bestEnd) ?? (peak != null ? peak + KOYO_AFTER_PEAK : null);
    if (start == null || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    spots.push({
      name: s.nameRomaji || s.name, nameJa: s.name, pref: null,
      lat: s.lat, lon: s.lon, front: start, peak, dates: [start - 10, start, peak, Math.max(end, peak + 1)],
    });
  }
  return finishSeason('koyo', cities, spots);
}

function finishSeason(kind, cities, spots) {
  cities.sort((a, b) => a.lat - b.lat);
  const all = cities.concat(spots);
  if (!all.length) return { kind, cities, spots, start: null, end: null, year: null, events: [] };
  const firsts = all.map((p) => p.dates[1]);
  const lasts = all.map((p) => p.dates[3]);
  const start = Math.min(...cities.map((c) => c.dates[1]), percentile(firsts, 0.02)) - 12;
  const end = Math.max(...cities.map((c) => c.dates[3]), percentile(lasts, 0.98)) + 6;
  const year = dayToDate(percentile(firsts, 0.5)).getUTCFullYear();
  const season = { kind, cities, spots, start: Math.floor(start), end: Math.ceil(end), year };
  season.events = seasonEvents(season);
  return season;
}

function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
}

// 0 before d0, rising to 1 at d1, 2 at d2, 3 at d3, then 4 once the phase has faded.
// Fractional values let colours blend smoothly between phases.
export function phaseValue(dates, day) {
  const [d0, d1, d2, d3] = dates;
  if (day < d0) return 0;
  if (day < d1) return (day - d0) / Math.max(1, d1 - d0);
  if (day < d2) return 1 + (day - d1) / Math.max(1, d2 - d1);
  if (day < d3) return 2 + (day - d2) / Math.max(1, d3 - d2);
  const tail = 10;
  return Math.min(4, 3 + (day - d3) / tail);
}

const PHASE_WORDS = {
  sakura: ['Buds still closed', 'Buds swelling', 'Opening', 'Full bloom', 'Petals falling', 'In leaf'],
  koyo: ['Still green', 'Starting to turn', 'Colouring', 'Peak colour', 'Leaves falling', 'Bare'],
};

export function phaseLabel(kind, dates, day) {
  const words = PHASE_WORDS[kind];
  const v = phaseValue(dates, day);
  if (v === 0) return words[0];
  if (v < 1) return words[1];
  if (v < 2) return words[2];
  if (v < 3) return words[3];
  if (v < 4) return words[4];
  return words[5];
}

// Snapshot of the front on one day, from city records only.
export function frontAt(season, day) {
  const cities = season.cities;
  const reached = cities.filter((c) => c.front <= day);
  const opening = cities.filter((c) => c.front <= day && day < c.peak).length;
  const peak = cities.filter((c) => c.peak <= day && day < c.dates[3]).length;
  const diffs = reached.map((c) => c.diff).filter(Number.isFinite);
  const meanDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  // Leading edge: the cities the front reached most recently, within the last 4 days.
  const recent = reached.filter((c) => day - c.front <= 4);
  const edge = recent.length ? recent : reached.slice().sort((a, b) => b.front - a.front).slice(0, 1);
  let lat = null;
  let nearest = null;
  if (edge.length) {
    lat = edge.reduce((a, c) => a + c.lat, 0) / edge.length;
    nearest = edge.slice().sort((a, b) => Math.abs(a.lat - lat) - Math.abs(b.lat - lat))[0];
  }
  return { reached: reached.length, total: cities.length, opening, peak, meanDiff, lat, nearest };
}

// Daily series for the charts.
export function seasonSeries(season) {
  const out = [];
  for (let d = season.start; d <= season.end; d++) {
    const f = frontAt(season, d);
    out.push({ day: d, opening: f.opening, peak: f.peak, reached: f.reached, lat: f.lat });
  }
  return out;
}

function cityByName(season, name) {
  return season.cities.find((c) => c.name === name);
}

export function seasonEvents(season) {
  const { cities, kind } = season;
  if (!cities.length) return [];
  const events = [];
  const byFront = cities.slice().sort((a, b) => a.front - b.front);
  if (kind === 'sakura') {
    const first = byFront[0];
    events.push({ day: first.front, label: `First bloom: ${first.name}${first.species && !first.species.startsWith('Yoshino') ? `, ${first.species.split(' (')[0]}` : ''}` });
    const yoshino = byFront.find((c) => !c.species || c.species.startsWith('Yoshino'));
    if (yoshino && yoshino !== first) events.push({ day: yoshino.front, label: `First Yoshino cherry: ${yoshino.name}` });
    const tokyo = cityByName(season, 'Tokyo');
    if (tokyo) {
      events.push({ day: tokyo.front, label: 'Tokyo first bloom' });
      events.push({ day: tokyo.peak, label: 'Tokyo full bloom' });
    }
    const kyoto = cityByName(season, 'Kyoto');
    if (kyoto) events.push({ day: kyoto.peak, label: 'Kyoto full bloom' });
    const hokkaido = byFront.find((c) => c.region === 'Hokkaido');
    if (hokkaido) events.push({ day: hokkaido.front, label: `Front reaches Hokkaido (${hokkaido.name})` });
    const last = cities.slice().sort((a, b) => b.peak - a.peak)[0];
    events.push({ day: last.peak, label: `Last full bloom: ${last.name}` });
  } else {
    const first = byFront[0];
    events.push({ day: first.front, label: `First colour: ${first.name}` });
    const kyoto = cityByName(season, 'Kyoto');
    const tokyo = cityByName(season, 'Tokyo');
    if (tokyo) events.push({ day: tokyo.peak, label: 'Tokyo peak colour' });
    if (kyoto) events.push({ day: kyoto.peak, label: 'Kyoto peak colour' });
    const south = cities.filter((c) => c.lat < 34).sort((a, b) => a.front - b.front)[0];
    if (south) events.push({ day: south.front, label: `Colour reaches Kyushu (${south.name})` });
    const last = cities.slice().sort((a, b) => b.peak - a.peak)[0];
    events.push({ day: last.peak, label: `Last peak: ${last.name}` });
  }
  return events.sort((a, b) => a.day - b.day);
}

// Start on today when it falls in the season, otherwise on the busiest day for city fronts.
export function defaultDay(season, today) {
  if (season.start == null) return today;
  if (today >= season.start && today <= season.end) return today;
  const fronts = season.cities.map((c) => c.front).sort((a, b) => a - b);
  return fronts[Math.floor(fronts.length / 2)] ?? season.start;
}

export function todayDay(now = new Date()) {
  // JST calendar day, matching how the API publishes dates.
  return Math.floor((now.getTime() + 9 * 3600000) / DAY_MS);
}

// Year-by-year dates for one city, with a least-squares trend and a 10-year running mean.
// Values are days of the year (Jan 1 = 1). Returns null when there are too few years.
export function cityHistory(table, name, firstYear) {
  const row = table?.[name];
  if (!row) return null;
  const points = [];
  row.values.forEach((v, i) => { if (Number.isFinite(v)) points.push({ year: firstYear + i, doy: v, substitute: row.substitute.includes(firstYear + i) }); });
  if (points.length < 10) return null;
  return { points, trend: linearTrend(points), running: runningMean(points, 10), normal: row.normal, species: row.species || null };
}

export function linearTrend(points) {
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.year, 0) / n;
  const my = points.reduce((a, p) => a + p.doy, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) { sxy += (p.year - mx) * (p.doy - my); sxx += (p.year - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, perDecade: slope * 10, from: points[0].year, to: points[n - 1].year };
}

// Mean of the years in the trailing window, only where at least half the window has data.
export function runningMean(points, window) {
  const out = [];
  for (const p of points) {
    const inWin = points.filter((q) => q.year > p.year - window && q.year <= p.year);
    if (inWin.length >= window / 2) out.push({ year: p.year, doy: inWin.reduce((a, q) => a + q.doy, 0) / inWin.length });
  }
  return out;
}

export function fmtDoy(doy) {
  return fmtDay(doyToDay(2021, doy));
}
