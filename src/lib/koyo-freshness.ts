// Koyo forecast freshness, shared by the server and the /plan page. No Node APIs.

const DAY_MS = 86_400_000;

// ─── Forecast freshness ─────────────────────────────────────────────────────
// JMC issues the koyo forecast in rounds (early Sep, early Oct, early Nov), not daily.
// update_info lists the rounds as "9月2日(水)" or "11月上旬(予定)".

const MONTH_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const PART_EN: Record<string, [string, number, number]> = { 上旬: ["early", 1, 10], 中旬: ["mid", 11, 20], 下旬: ["late", 21, 31] };
const OVERDUE_GRACE_DAYS = 3;

export function parseJmcScheduleEntry(entry: string, year: number): { label: string; earliest: Date; latest: Date } | null {
  const m = /^(\d{1,2})月(?:(\d{1,2})日|(上旬|中旬|下旬))/.exec(entry.trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const planned = entry.includes("予定");
  if (m[2]) {
    const day = Number(m[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return { label: `${MONTH_EN[month - 1].slice(0, 3)} ${day}${planned ? " (planned)" : ""}`, earliest: date, latest: date };
  }
  const [word, firstDay, lastDay] = PART_EN[m[3]];
  const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    label: `${word} ${MONTH_EN[month - 1]}${planned ? " (planned)" : ""}`,
    earliest: new Date(Date.UTC(year, month - 1, firstDay)),
    latest: new Date(Date.UTC(year, month - 1, Math.min(lastDay, monthEnd))),
  };
}

export function koyoForecastFreshness(
  lastUpdated: string,
  schedule: string[],
  now = new Date(),
): { issued: string | null; nextUpdate: string | null; overdue: boolean } {
  const issued = lastUpdated ? lastUpdated.slice(0, 10) : null;
  if (!issued) return { issued: null, nextUpdate: null, overdue: false };
  const year = Number(issued.slice(0, 4));
  const issuedDay = Date.UTC(year, Number(issued.slice(5, 7)) - 1, Number(issued.slice(8, 10)));
  const next = schedule
    .map((entry) => parseJmcScheduleEntry(entry, year))
    .find((entry) => entry && entry.earliest.getTime() > issuedDay);
  if (!next) return { issued, nextUpdate: null, overdue: false };
  const overdue = now.getTime() > next.latest.getTime() + (OVERDUE_GRACE_DAYS + 1) * DAY_MS - 9 * 3_600_000;
  return { issued, nextUpdate: next.label, overdue };
}

export function koyoFreshnessLine(forecast: { lastUpdated: string; updateSchedule: string[] }, now = new Date()): string {
  const f = koyoForecastFreshness(forecast.lastUpdated, forecast.updateSchedule, now);
  if (!f.issued) return "Forecast issue date unknown.";
  let line = `Forecast issued ${f.issued}. JMC publishes the koyo forecast in rounds, not daily.`;
  if (f.nextUpdate) line += ` Next JMC round: ${f.nextUpdate}.`;
  if (f.overdue) line += " That round is overdue, so this forecast may be out of date.";
  return line;
}

