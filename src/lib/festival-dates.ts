// Festival dates for a given year from the structured `when` field in public/festivals.json.
// Shared by the MCP tools and the /festivals and /plan pages. No Node APIs.
//
//   fixed:            same calendar dates every year ("August 2–7")
//   weekday:          nth weekday of a month, n = -1 for the last ("Last Saturday of July")
//   nearest-weekend:  the Saturday–Sunday nearest a date
//   approx:           only a rough window is known ("Mid-August"); check this year's date
//   season:           runs every day or night through a period
//   several:          several dates in these months; check the schedule

export type FestivalWhen =
  | { type: "fixed" | "approx" | "season"; start: string; end: string }
  | { type: "weekday"; month: number; weekday: number; n: number; days?: number }
  | { type: "nearest-weekend"; date: string; days?: number }
  | { type: "several"; months: number[] };

export interface FestivalLike { when?: FestivalWhen; years?: "odd" | "even"; typicalDate?: string }

export type Precision = "exact" | "rule" | "approx" | "season" | "several";
export interface Occurrence { start: string; end: string; precision: Precision; year: number }

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth"];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const md = (y: number, mmdd: string) => utc(y, Number(mmdd.slice(0, 2)), Number(mmdd.slice(3, 5)));

export function heldInYear(f: FestivalLike, year: number): boolean {
  if (f.years === "odd") return year % 2 === 1;
  if (f.years === "even") return year % 2 === 0;
  return true;
}

export function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = utc(year, month, 1);
    const offset = (weekday - new Date(first).getUTCDay() + 7) % 7;
    return first + (offset + (n - 1) * 7) * DAY;
  }
  const last = utc(year, month + 1, 0);
  const back = (new Date(last).getUTCDay() - weekday + 7) % 7;
  return last - (back - (n + 1) * 7) * DAY;
}

// The occurrence that starts in `year`, or null when the festival skips that year.
export function occurrence(f: FestivalLike, year: number): Occurrence | null {
  const w = f.when;
  if (!w || !heldInYear(f, year)) return null;
  switch (w.type) {
    case "fixed":
    case "approx":
    case "season": {
      const s = md(year, w.start);
      let e = md(year, w.end);
      if (e < s) e = md(year + 1, w.end);
      return { start: iso(s), end: iso(e), precision: w.type === "fixed" ? "exact" : w.type, year };
    }
    case "weekday": {
      const s = nthWeekday(year, w.month, w.weekday, w.n);
      return { start: iso(s), end: iso(s + ((w.days ?? 1) - 1) * DAY), precision: "rule", year };
    }
    case "nearest-weekend": {
      const target = md(year, w.date);
      // Saturday whose weekend midpoint is closest to the date.
      const dow = new Date(target).getUTCDay();
      const back = (dow - 6 + 7) % 7;
      const prevSat = target - back * DAY;
      const s = target - (prevSat + DAY / 2) <= prevSat + 7 * DAY + DAY / 2 - target ? prevSat : prevSat + 7 * DAY;
      return { start: iso(s), end: iso(s + ((w.days ?? 2) - 1) * DAY), precision: "rule", year };
    }
    case "several": {
      const months = [...w.months].sort((a, b) => a - b);
      return { start: iso(utc(year, months[0], 1)), end: iso(utc(year, months[months.length - 1] + 1, 0)), precision: "several", year };
    }
  }
}

// Calendar days (ISO) the festival may be on in an occurrence. "several" only covers its months.
export function occurrenceCovers(f: FestivalLike, occ: Occurrence, isoDay: string): boolean {
  if (isoDay < occ.start || isoDay > occ.end) return false;
  if (f.when?.type === "several") return f.when.months.includes(Number(isoDay.slice(5, 7)));
  return true;
}

// Occurrences that touch a trip (inclusive ISO dates), including ones that started the year before.
export function occurrencesInRange(f: FestivalLike, startIso: string, endIso: string): Occurrence[] {
  const out: Occurrence[] = [];
  const y0 = Number(startIso.slice(0, 4)) - 1;
  const y1 = Number(endIso.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const occ = occurrence(f, y);
    if (!occ || occ.end < startIso || occ.start > endIso) continue;
    if (f.when?.type === "several") {
      let hit = false;
      for (let t = Date.parse(`${startIso}T00:00:00Z`); t <= Date.parse(`${endIso}T00:00:00Z`) && !hit; t += DAY) hit = occurrenceCovers(f, occ, iso(t));
      if (!hit) continue;
    }
    out.push(occ);
  }
  return out;
}

// The next year (from `fromYear`) the festival is held, for biennial events.
export function nextHeldYear(f: FestivalLike, fromYear: number): number {
  let y = fromYear;
  while (!heldInYear(f, y) && y < fromYear + 2) y++;
  return y;
}

export function fmtIso(isoDay: string, withYear = false): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

function span(occ: Occurrence, withYear: boolean): string {
  if (occ.start === occ.end) return fmtIso(occ.start, withYear);
  const sameMonth = occ.start.slice(0, 7) === occ.end.slice(0, 7);
  if (sameMonth) return `${fmtIso(occ.start)} to ${Number(occ.end.slice(8, 10))}${withYear ? `, ${occ.end.slice(0, 4)}` : ""}`;
  return `${fmtIso(occ.start)} to ${fmtIso(occ.end, withYear)}`;
}

const third = (d: number) => (d <= 10 ? "early" : d <= 20 ? "mid" : "late");

// "mid August", "early to mid February", "late March to early April".
export function roughWindow(startMmdd: string, endMmdd: string): string {
  const [m1, d1] = startMmdd.split("-").map(Number);
  const [m2, d2] = endMmdd.split("-").map(Number);
  const a = third(d1);
  const b = third(d2);
  if (m1 === m2) return a === b ? `${a} ${MONTHS[m1 - 1]}` : `${a} to ${b} ${MONTHS[m1 - 1]}`;
  return `${a} ${MONTHS[m1 - 1]} to ${b} ${MONTHS[m2 - 1]}`;
}

// One plain line saying when, and how sure the date is.
export function whenLine(f: FestivalLike, year: number): { date: string; note: string } {
  const occ = occurrence(f, year);
  if (!occ) {
    const next = nextHeldYear(f, year);
    const nextOcc = occurrence(f, next);
    const when = nextOcc ? (nextOcc.precision === "approx" ? `, usually ${roughWindow(nextOcc.start.slice(5), nextOcc.end.slice(5))}` : `, probably ${span(nextOcc, false)}`) : "";
    return { date: `Not held in ${year}`, note: `Held in ${f.years}-numbered years. Next in ${next}${when}.` };
  }
  const w = f.when!;
  switch (occ.precision) {
    case "exact":
      return { date: span(occ, true), note: "Same dates every year." };
    case "rule": {
      const rule = w.type === "weekday"
        ? `${w.n === -1 ? "Last" : ORDINAL[w.n][0].toUpperCase() + ORDINAL[w.n].slice(1)} ${w.days === 2 ? "weekend" : "Saturday"} of ${MONTHS[w.month - 1]}`
        : `Weekend nearest ${fmtIso(`2000-${(w as { date: string }).date}`)}`;
      return { date: span(occ, true), note: `${rule}, so probably these dates. Check the official site to confirm.` };
    }
    case "approx":
      return { date: `Usually ${roughWindow(occ.start.slice(5), occ.end.slice(5))}`, note: `Exact dates change each year. Check ${year}'s dates on the official site.` };
    case "season":
      return { date: span(occ, true), note: "Runs through this whole period. Times can change, so check the official site." };
    case "several":
      return { date: `Several dates in ${(w as { months: number[] }).months.map((m) => MONTHS[m - 1].slice(0, 3)).join(", ")}`, note: "Check the official schedule for this year's dates." };
  }
}
