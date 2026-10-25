import { describe, expect, it } from 'vitest';
import {
  buildKoyoSeason, buildSakuraSeason, defaultDay, fmtDay, fmtDiff, frontAt, isoToDay, phaseLabel, phaseValue,
} from './data.js';

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
  });
});
