import { describe, expect, it } from 'vitest';
import { isoToDay } from '../explore/data.js';
import { frontForTrip, peaksDuring, phaseBucket, phaseCounts, tripDayList, MAX_TRIP_DAYS } from './plan-model.js';

const d = isoToDay;
const city = (name, front, peak) => ({ name, front: d(front), peak: d(peak), dates: [d(front) - 10, d(front), d(peak), d(peak) + 10] });
const koyo = { kind: 'koyo', start: d('2026-09-20'), end: d('2026-12-20'), cities: [city('Kyoto', '2026-11-20', '2026-11-28'), city('Sapporo', '2026-10-25', '2026-11-04')] };
const sakura = { kind: 'sakura', start: d('2026-01-20'), end: d('2026-05-20'), cities: [] };

describe('plan model', () => {
  it('lists trip days and caps long trips', () => {
    expect(tripDayList('2026-11-20', '2026-11-22')).toEqual([d('2026-11-20'), d('2026-11-21'), d('2026-11-22')]);
    expect(tripDayList('2026-11-22', '2026-11-20')).toEqual([]);
    expect(tripDayList('2026-01-01', '2026-12-31')).toHaveLength(MAX_TRIP_DAYS);
  });

  it('picks the front whose forecast covers the trip', () => {
    expect(frontForTrip([sakura, koyo], tripDayList('2026-11-20', '2026-11-25'))).toMatchObject({ kind: 'koyo', status: 'forecast' });
    expect(frontForTrip([sakura, koyo], tripDayList('2026-07-01', '2026-07-05'))).toEqual({ kind: null, status: 'none' });
  });

  it('says when a trip falls in next year\'s season, before its forecast exists', () => {
    expect(frontForTrip([sakura, koyo], tripDayList('2027-04-01', '2027-04-05'))).toMatchObject({ kind: 'sakura', status: 'not-yet', shift: 365 });
  });

  it('counts cities by phase each day and finds peaks inside the trip', () => {
    const days = tripDayList('2026-11-26', '2026-11-29');
    const counts = phaseCounts(koyo.cities, days);
    expect(counts[0][2]).toBe(1); // Kyoto colouring on Nov 26
    expect(counts[2][3]).toBe(1); // Kyoto at peak on Nov 28
    expect(phaseBucket(koyo.cities[1].dates, d('2026-12-30'))).toBe(5);
    expect(peaksDuring(koyo.cities, days).map((c) => c.name)).toEqual(['Kyoto']);
  });
});
