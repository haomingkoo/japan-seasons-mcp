// Pure trip model for /plan: which seasonal front applies to a trip and what it does each day.
// Seasons come from buildSakuraSeason / buildKoyoSeason in explore/data.js (days since 1970).
import { isoToDay, phaseValue } from '../explore/data.js';

export const MAX_TRIP_DAYS = 31;

export function tripDayList(startIso, endIso) {
  const a = isoToDay(startIso);
  const b = isoToDay(endIso);
  if (a == null || b == null || b < a) return [];
  const out = [];
  for (let d = a; d <= b && out.length < MAX_TRIP_DAYS; d++) out.push(d);
  return out;
}

// Phase buckets from phaseValue: 0 before, 1 starting, 2 opening/colouring, 3 peak, 4 falling, 5 over.
export function phaseBucket(dates, day) {
  const v = phaseValue(dates, day);
  if (v === 0) return 0;
  if (v < 1) return 1;
  if (v < 2) return 2;
  if (v < 3) return 3;
  if (v < 4) return 4;
  return 5;
}

// The front that applies to the trip: one whose season window overlaps it in the forecast year.
// Otherwise, a front whose usual months match but whose forecast for that year is not out yet.
export function frontForTrip(seasons, days) {
  if (!days.length) return { kind: null, status: 'none' };
  const first = days[0];
  const last = days[days.length - 1];
  for (const s of seasons) {
    if (s && s.start != null && first <= s.end && last >= s.start) return { kind: s.kind, season: s, status: 'forecast' };
  }
  // Same calendar window in a later year: the forecast is last season's.
  for (const s of seasons) {
    if (!s || s.start == null) continue;
    for (const shift of [365, 730]) {
      if (first <= s.end + shift && last >= s.start + shift) return { kind: s.kind, season: s, status: 'not-yet', shift };
    }
  }
  return { kind: null, status: 'none' };
}

// Per trip day, how many of the given cities are in each phase bucket.
export function phaseCounts(cities, days, shift = 0) {
  return days.map((day) => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const c of cities) counts[phaseBucket(c.dates, day - shift)]++;
    return counts;
  });
}

// Cities whose peak falls inside the trip, earliest first.
export function peaksDuring(cities, days, shift = 0) {
  if (!days.length) return [];
  const a = days[0] - shift;
  const b = days[days.length - 1] - shift;
  return cities.filter((c) => c.peak >= a && c.peak <= b).sort((x, y) => x.peak - y.peak);
}
