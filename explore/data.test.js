import { describe, expect, it } from 'vitest';
import {
  buildKoyoSeason, buildSakuraSeason, calibrateLapse, cityHistory, defaultDay, fmtDay, fmtDiff, fmtDoy, frontAt, isoToDay, linearTrend, phaseLabel, phaseValue,
} from './data.js';
import { buildField, sampleField } from './field.js';

const iso = (d) => `${d}T00:00:00+09:00`;

const sakuraForecast = {
  regions: [
    {
      nameEn: 'Kyushu',
      cities: [{ cityName: 'Kagoshima', region: 'Kyushu', bloom: { normal: '3/26', forecast: iso('2026-03-25'), observation: iso('2026-03-27') }, fullBloom: { normal: '4/5', forecast: iso('2026-04-05') } }],
    },
    {
      nameEn: 'Kanto/Koshin',
      cities: [{ cityName: 'Tokyo', region: 'Kanto/Koshin', bloom: { normal: '3/24', forecast: iso('2026-03-19') }, fullBloom: { normal: '3/31', forecast: iso('2026-03-28'), observation: iso('2026-03-27') } }],
    },
    {
      nameEn: 'Hokkaido',
      cities: [{ cityName: 'Sapporo', region: 'Hokkaido', bloom: { normal: '5/1', forecast: iso('2026-04-18') }, fullBloom: { normal: '5/6', forecast: iso('2026-04-23') } }],
    },
  ],
};
const sakuraSpots = { spots: [{ lat: 35.7, lon: 139.7, name: '上野恩賜公園', nameRomaji: 'Ueno Park', bloomForecast: iso('2026-03-20'), fullBloomForecast: iso('2026-03-27') }] };

describe('bloom front data mapping', () => {
  const season = buildSakuraSeason(sakuraForecast, sakuraSpots);
  const day = (s) => isoToDay(iso(s));

  it('prefers the JMA observation over the forecast', () => {
    const kagoshima = season.cities.find((c) => c.name === 'Kagoshima');
    expect(fmtDay(kagoshima.front)).toBe('Mar 27');
    expect(kagoshima.observed).toBe(true);
    const tokyo = season.cities.find((c) => c.name === 'Tokyo');
    expect(fmtDay(tokyo.front)).toBe('Mar 19');
    expect(fmtDay(tokyo.peak)).toBe('Mar 27');
  });

  it('measures days against the JMA normal, negative meaning earlier', () => {
    const tokyo = season.cities.find((c) => c.name === 'Tokyo');
    expect(tokyo.diff).toBe(-5);
    expect(fmtDiff(tokyo.diff)).toBe('5 days earlier than average');
    expect(fmtDiff(1)).toBe('1 day later than average');
    expect(fmtDiff(0)).toBe('Same as average');
  });

  it('orders cities south to north and puts the season around the city dates', () => {
    expect(season.cities.map((c) => c.name)).toEqual(['Kagoshima', 'Tokyo', 'Sapporo']);
    expect(season.start).toBeLessThan(day('2026-03-19'));
    expect(season.end).toBeGreaterThanOrEqual(day('2026-04-30'));
    expect(season.spots).toHaveLength(1);
  });

  it('maps a date to a phase for one location', () => {
    const tokyo = season.cities.find((c) => c.name === 'Tokyo');
    expect(phaseValue(tokyo.dates, day('2026-03-01'))).toBe(0);
    expect(phaseValue(tokyo.dates, day('2026-03-19'))).toBe(1);
    expect(phaseValue(tokyo.dates, day('2026-03-27'))).toBe(2);
    expect(phaseValue(tokyo.dates, day('2026-06-01'))).toBe(4);
    expect(phaseLabel('sakura', tokyo.dates, day('2026-03-22'))).toBe('Opening');
    expect(phaseLabel('sakura', tokyo.dates, day('2026-03-29'))).toBe('Full bloom');
  });

  it('maps a date to the front across cities', () => {
    const early = frontAt(season, day('2026-03-10'));
    expect(early.reached).toBe(0);
    expect(early.lat).toBeNull();

    const mid = frontAt(season, day('2026-03-28'));
    expect(mid.reached).toBe(2);
    expect(mid.opening).toBe(1); // Kagoshima opened Mar 27
    expect(mid.peak).toBe(1); // Tokyo reached full bloom Mar 27
    expect(mid.nearest.name).toBe('Kagoshima');
    expect(mid.meanDiff).toBeCloseTo((1 + -5) / 2);

    const late = frontAt(season, day('2026-04-20'));
    expect(late.reached).toBe(3);
    expect(late.nearest.name).toBe('Sapporo');
  });

  it('starts on today in season, otherwise mid-season', () => {
    expect(defaultDay(season, day('2026-04-01'))).toBe(day('2026-04-01'));
    expect(fmtDay(defaultDay(season, day('2026-10-26')))).toBe('Mar 27');
  });
});

describe('autumn leaves mapping', () => {
  const season = buildKoyoSeason(
    { regions: [{ name: 'Kinki', cities: [{ nameEn: 'Kyoto', prefNameEn: 'Kyoto', maple: { forecast: iso('2026-12-11'), normalDiffDays: 6 } }] }] },
    { spots: [{ lat: 35.0, lon: 135.7, nameRomaji: 'Arashiyama', name: '嵐山', bestStart: iso('2026-11-20'), bestPeak: iso('2026-11-27'), bestEnd: iso('2026-12-05') }] },
  );

  it('builds the viewing window from the JMC colouring date', () => {
    const kyoto = season.cities[0];
    expect(fmtDay(kyoto.front)).toBe('Dec 8');
    expect(fmtDay(kyoto.dates[3])).toBe('Dec 21');
    expect(kyoto.diff).toBe(6);
    expect(fmtDiff(kyoto.diff)).toBe('6 days later than average');
    expect(season.spots[0].dates.map((d) => fmtDay(d))).toEqual(['Nov 10', 'Nov 20', 'Nov 27', 'Dec 5']);
    expect(season.events.map((e) => e.label)).toEqual(['First colour: Kyoto', 'Colour reaches Kyoto', 'Peak in Kyoto', 'Last peak: Kyoto']);
    expect(season.events.some((e) => e.label === 'Peak in Kyoto')).toBe(true);
  });

  it('builds a separate ginkgo front, estimating ginkgo at maple spots from the city gap', () => {
    const forecast = { regions: [{ name: 'Kinki', cities: [
      { nameEn: 'Kyoto', prefNameEn: 'Kyoto', maple: { forecast: iso('2026-12-11'), normalDiffDays: 6 }, ginkgo: { forecast: iso('2026-12-01'), normalDiffDays: 2 } },
      { nameEn: 'Nara', prefNameEn: 'Nara', maple: { forecast: iso('2026-11-25'), normalDiffDays: 4 } },
    ] }] };
    const spots = { spots: [
      { lat: 35.0, lon: 135.7, nameRomaji: 'Arashiyama', name: '嵐山', leafType: 'Maple (momiji)', bestStart: iso('2026-11-20'), bestPeak: iso('2026-11-27'), bestEnd: iso('2026-12-05') },
      { lat: 35.01, lon: 135.76, nameRomaji: 'Big ginkgo', name: '大銀杏', leafType: 'Ginkgo (ichou)', bestStart: iso('2026-11-25'), bestPeak: iso('2026-11-28'), bestEnd: iso('2026-12-04') },
    ] };
    const g = buildKoyoSeason(forecast, spots, 'ginkgo');
    expect(g.species).toBe('ginkgo');
    expect(g.cities.map((c) => c.name)).toEqual(['Kyoto']); // Nara has no ginkgo forecast
    expect(fmtDay(g.cities[0].peak)).toBe('Dec 1');
    expect(g.cities[0].diff).toBe(2);
    const arash = g.spots.find((s) => s.name === 'Arashiyama');
    expect(arash.estimated).toBe(true);
    expect(fmtDay(arash.peak)).toBe('Nov 17'); // maple Nov 27 shifted by Kyoto's -10 day gap
    expect(arash.trees).toBe(false);
    const big = g.spots.find((s) => s.name === 'Big ginkgo');
    expect(big.estimated).toBe(false);
    expect(fmtDay(big.peak)).toBe('Nov 28');
    expect(g.events[0].label).toBe('First ginkgo yellow: Kyoto');
    const m = buildKoyoSeason(forecast, spots, 'maple');
    expect(m.cities).toHaveLength(2);
    expect(m.spots.find((s) => s.name === 'Big ginkgo').trees).toBe(false);
  });
});

describe('JMA history and stations the forecast leaves out', () => {
  // 2026: Naha Jan 18 (day 18), full Feb 3 (day 34); normal Jan 16. Tokyo has 74 years.
  const vals = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const history = {
    currentYear: 2026,
    firstYear: 1953,
    stations: { Naha: [26.2, 127.7], Tokyo: [35.69, 139.75] },
    sakuraBloom: {
      Naha: { values: [...vals(73, () => null), 18], substitute: [2026], normal: 16, species: 'Taiwan cherry (hikanzakura)' },
      Tokyo: { values: vals(74, (i) => 95 - Math.round(i * 0.2)), substitute: [], normal: 83 },
    },
    sakuraFull: { Naha: { values: [...vals(73, () => null), 34], substitute: [], normal: 30 } },
  };
  const season = buildSakuraSeason(sakuraForecast, sakuraSpots, history);

  it('adds Okinawa from this season\'s JMA observation, so the front starts in the south', () => {
    const naha = season.cities.find((c) => c.name === 'Naha');
    expect(fmtDay(naha.front)).toBe('Jan 18');
    expect(fmtDay(naha.peak)).toBe('Feb 3');
    expect(naha.diff).toBe(2);
    expect(naha.jmaOnly).toBe(true);
    expect(season.cities[0].name).toBe('Naha');
    expect(season.events[0].label).toBe('First bloom: Naha, Taiwan cherry');
    expect(season.start).toBeLessThan(isoToDay(iso('2026-01-18')));
  });

  it('skips stations when the history covers another year', () => {
    const other = buildSakuraSeason(sakuraForecast, sakuraSpots, { ...history, currentYear: 2025 });
    expect(other.cities.some((c) => c.name === 'Naha')).toBe(false);
  });

  it('reads a city history with a trend in days per decade', () => {
    const h = cityHistory(history.sakuraBloom, 'Tokyo', 1953);
    expect(h.points).toHaveLength(74);
    expect(h.points[0]).toEqual({ year: 1953, doy: 95, substitute: false });
    expect(h.trend.perDecade).toBeCloseTo(-2, 1);
    expect(h.running[0].year).toBe(1957);
    expect(cityHistory(history.sakuraBloom, 'Naha', 1953)).toBeNull();
    expect(fmtDoy(83)).toBe('Mar 24');
  });

  it('fits a straight line exactly', () => {
    const t = linearTrend([{ year: 2000, doy: 90 }, { year: 2010, doy: 85 }, { year: 2020, doy: 80 }]);
    expect(t.perDecade).toBeCloseTo(-5);
  });
});

describe('autumn elevation lapse', () => {
  it('fits days per metre from mountain spots against nearby cities, within 1 to 4 days per 100 m', () => {
    const cities = [{ name: 'A', lat: 36.0, lon: 138.0, front: 100 }, { name: 'B', lat: 36.2, lon: 137.8, front: 100 }];
    // Height grows east; colour comes 3 days earlier per 100 m above the cities.
    const elevOf = (lon) => Math.max(0, (lon - 138.0) * 4000);
    const spots = [];
    for (let i = 0; i < 40; i++) {
      const lon = 138.05 + i * 0.01;
      const e = elevOf(lon);
      spots.push({ lat: 36.1, lon, front: 100 - 0.03 * e + (i % 3) * 0.2 });
    }
    const fit = calibrateLapse(spots, cities, elevOf);
    expect(fit.fitted).toBe(true);
    expect(fit.k).toBeCloseTo(-0.03, 2);
    expect(calibrateLapse(spots.slice(0, 5), cities, elevOf)).toEqual({ k: -0.025, n: expect.any(Number), fitted: false });
  });

  it('puts colour earlier on high ground in the field', () => {
    const dem = { sample: (lon) => (lon > 138 ? 2000 : 0) };
    const pts = [{ lat: 36, lon: 137.95, elev: 0, dates: [90, 100, 105, 115] }, { lat: 36, lon: 138.05, elev: 0, dates: [90, 100, 105, 115] }];
    const flat = buildField(pts, 680);
    const hilly = buildField(pts, 680, { dem, k: -0.025 });
    const lo = sampleField(hilly, 137.95, 36);
    const hi = sampleField(hilly, 138.05, 36);
    expect(lo[1]).toBeCloseTo(100, 0);
    expect(hi[1]).toBeCloseTo(50, 0); // 2,000 m at 2.5 days per 100 m
    expect(sampleField(flat, 138.05, 36)[1]).toBeCloseTo(100, 0);
  });
});
