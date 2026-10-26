// Picking-season model shared by the MCP tools and the /fruit pages (bundled by esbuild).
// No Node APIs here. Dates use a non-leap reference year: day 1 is Jan 1, day 365 is Dec 31.
//
// Where a farm's season comes from, best first:
//   farm:    the farm's own Jalan listing gives dates for that fruit
//   region:  estimated from the listings of other farms with that fruit in the same region
//   typical: the national guide in constants.ts (approximate)

import { FRUITS } from "./constants.js";

export type MonthDay = [number, number];
export type DayRange = [MonthDay, MonthDay];
export type SeasonSource = "farm" | "region" | "typical";

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = MONTH_DAYS.reduce<number[]>((acc, _d, i) => (acc.push(i ? acc[i - 1] + MONTH_DAYS[i - 1] : 1), acc), []);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function dayOfYear([month, day]: MonthDay): number {
  const m = Math.min(12, Math.max(1, month));
  return MONTH_START[m - 1] + Math.min(MONTH_DAYS[m - 1], Math.max(1, day)) - 1;
}

export function monthOfDay(day: number): number {
  let m = 12;
  while (m > 1 && MONTH_START[m - 1] > day) m--;
  return m;
}

// Feb 29 counts as Feb 28.
export function isoToDayOfYear(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  return dayOfYear([Number(m[2]), Number(m[3])]);
}

export function rangeCovers([from, to]: DayRange, day: number): boolean {
  const a = dayOfYear(from);
  const b = dayOfYear(to);
  return a <= b ? day >= a && day <= b : day >= a || day <= b;
}

export function daysInMonthCovered(range: DayRange, month: number): number {
  let n = 0;
  for (let d = MONTH_START[month - 1]; d < MONTH_START[month - 1] + MONTH_DAYS[month - 1]; d++) if (rangeCovers(range, d)) n++;
  return n;
}

// [12, 1, 2] becomes one range from Dec 1 to Feb 28.
export function monthsToRanges(months: number[]): DayRange[] {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (!set.size) return [];
  if (set.size === 12) return [[[1, 1], [12, 31]]];
  const out: DayRange[] = [];
  // Start each run at a month whose previous month is not in the set, so runs wrap the new year.
  for (let m = 1; m <= 12; m++) {
    const prev = m === 1 ? 12 : m - 1;
    if (!set.has(m) || set.has(prev)) continue;
    let end = m;
    while (set.has(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
    out.push([[m, 1], [end, MONTH_DAYS[end - 1]]]);
  }
  return out;
}

// Calendar days of a trip as days of the year, capped so a long range stays cheap.
export function tripDays(startIso: string, endIso: string, cap = 400): number[] {
  const s = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [];
  const out = new Set<number>();
  for (let t = s, i = 0; t <= e && i < cap; t += 86_400_000, i++) {
    out.add(isoToDayOfYear(new Date(t).toISOString())!);
    if (out.size === 365) break;
  }
  return [...out];
}

export function rangesOverlapDays(ranges: DayRange[], days: number[]): boolean {
  return ranges.some((r) => days.some((d) => rangeCovers(r, d)));
}

const THIRD = (day: number) => (day <= 10 ? "early" : day <= 20 ? "mid" : "late");

function edgeLabel([month, day]: MonthDay, isEnd: boolean): string {
  const name = MONTH_NAMES[month - 1];
  if (!isEnd && day === 1) return name;
  if (isEnd && day >= MONTH_DAYS[month - 1]) return name;
  return `${THIRD(day)} ${name}`;
}

// "mid December to mid May", "July to November", "all year".
export function rangeLabel([from, to]: DayRange): string {
  const a = dayOfYear(from);
  const b = dayOfYear(to);
  if ((b + 1) % 365 === a % 365 || (a === 1 && b === 365)) return "all year";
  const left = edgeLabel(from, false);
  const right = edgeLabel(to, true);
  return left === right ? left : `${left} to ${right}`;
}

// ─── Fruit catalogue ─────────────────────────────────────────────────────────

export interface FruitInfo {
  name: string;          // name used in the farm listings, e.g. "Mandarin Orange"
  slug: string;
  label: string;         // plural for headings, e.g. "Mikan"
  ja: string;
  months: number[];
  peak: number[];
  regions: string[];
  note?: string;
}

const LABELS: Record<string, [string, string]> = {
  Strawberry: ["strawberry", "Strawberries"],
  Cherry: ["cherry", "Cherries"],
  Peach: ["peach", "Peaches"],
  Blueberry: ["blueberry", "Blueberries"],
  Grape: ["grape", "Grapes"],
  "Japanese Pear": ["pear", "Japanese pears"],
  Apple: ["apple", "Apples"],
  Chestnut: ["chestnut", "Chestnuts"],
  Persimmon: ["persimmon", "Persimmons"],
  "Mandarin Orange": ["mikan", "Mikan"],
  Melon: ["melon", "Melons"],
  Loquat: ["loquat", "Loquats"],
};

// Only fruits that the farm listings carry, in calendar order of their typical start.
export const PICKING_FRUITS: FruitInfo[] = FRUITS
  .filter((f) => LABELS[f.name])
  .map((f) => ({ name: f.name, slug: LABELS[f.name][0], label: LABELS[f.name][1], ja: f.ja, months: f.months, peak: f.peak, regions: f.regions, note: f.note }));

export const fruitBySlug = (slug: string) => PICKING_FRUITS.find((f) => f.slug === slug) ?? null;
export const fruitByName = (name: string) => PICKING_FRUITS.find((f) => f.name.toLowerCase() === name.toLowerCase() || f.slug === name.toLowerCase() || f.label.toLowerCase() === name.toLowerCase()) ?? null;

// ─── Prefectures and regions ─────────────────────────────────────────────────

export const REGIONS = [
  { id: "hokkaido", name: "Hokkaido", prefs: ["北海道"] },
  { id: "tohoku", name: "Tohoku", prefs: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { id: "kanto", name: "Kanto", prefs: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"] },
  { id: "chubu", name: "Chubu", prefs: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"] },
  { id: "kansai", name: "Kansai", prefs: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { id: "chugoku", name: "Chugoku", prefs: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"] },
  { id: "shikoku", name: "Shikoku", prefs: ["徳島県", "香川県", "愛媛県", "高知県"] },
  { id: "kyushu", name: "Kyushu and Okinawa", prefs: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
] as const;
export type RegionId = (typeof REGIONS)[number]["id"];

const PREF_EN: Record<string, string> = {
  北海道: "Hokkaido", 青森県: "Aomori", 岩手県: "Iwate", 宮城県: "Miyagi", 秋田県: "Akita", 山形県: "Yamagata", 福島県: "Fukushima",
  茨城県: "Ibaraki", 栃木県: "Tochigi", 群馬県: "Gunma", 埼玉県: "Saitama", 千葉県: "Chiba", 東京都: "Tokyo", 神奈川県: "Kanagawa",
  新潟県: "Niigata", 富山県: "Toyama", 石川県: "Ishikawa", 福井県: "Fukui", 山梨県: "Yamanashi", 長野県: "Nagano", 岐阜県: "Gifu",
  静岡県: "Shizuoka", 愛知県: "Aichi", 三重県: "Mie", 滋賀県: "Shiga", 京都府: "Kyoto", 大阪府: "Osaka", 兵庫県: "Hyogo",
  奈良県: "Nara", 和歌山県: "Wakayama", 鳥取県: "Tottori", 島根県: "Shimane", 岡山県: "Okayama", 広島県: "Hiroshima",
  山口県: "Yamaguchi", 徳島県: "Tokushima", 香川県: "Kagawa", 愛媛県: "Ehime", 高知県: "Kochi", 福岡県: "Fukuoka", 佐賀県: "Saga",
  長崎県: "Nagasaki", 熊本県: "Kumamoto", 大分県: "Oita", 宮崎県: "Miyazaki", 鹿児島県: "Kagoshima", 沖縄県: "Okinawa",
};

export function prefectureOf(address: string): { ja: string; en: string; region: RegionId } | null {
  const ja = Object.keys(PREF_EN).find((p) => address.startsWith(p));
  if (!ja) return null;
  const region = REGIONS.find((r) => (r.prefs as readonly string[]).includes(ja))!.id;
  return { ja, en: PREF_EN[ja], region };
}

// ─── Farm seasons ────────────────────────────────────────────────────────────

export interface RawFarm { id: string; name: string; address: string; fruits?: string[]; url: string; lat?: number; lon?: number }
export interface RawWindow { fruit: string | null; from: MonthDay; to: MonthDay }
export interface RawFarmSeason { period?: string; windows?: RawWindow[] }

export interface FarmFruitSeason { fruit: string; ranges: DayRange[]; source: SeasonSource; basis?: number }
export interface Farm {
  id: string; name: string; address: string; url: string; lat: number; lon: number;
  pref: string; region: RegionId; seasons: FarmFruitSeason[]; period?: string;
}

// A region needs this many farms listing their own dates for a fruit before we estimate from them.
export const REGION_MIN_LISTINGS = 5;
// A month counts as in season for a region when this share of its listed farms is open 10+ days of it.
const REGION_SHARE = 0.4;

function assign(fruits: string[], windows: RawWindow[]) {
  const byFruit: Record<string, DayRange[]> = {};
  const farmOpen: DayRange[] = [];
  const tagged = new Set(windows.map((w) => w.fruit).filter(Boolean));
  for (const w of windows) {
    // An untagged window on a one-fruit farm is that fruit's, unless the listing also names the fruit's own dates.
    const fruit = w.fruit && fruits.includes(w.fruit) ? w.fruit : (!w.fruit && fruits.length === 1 && !tagged.has(fruits[0]) ? fruits[0] : null);
    if (fruit) (byFruit[fruit] ||= []).push([w.from, w.to]);
    else if (!w.fruit) farmOpen.push([w.from, w.to]);
  }
  return { byFruit, farmOpen };
}

export interface RegionFruitStat { listings: number; monthShare: number[]; months: number[] }

export function buildFarms(raw: RawFarm[], seasons: Record<string, RawFarmSeason> = {}) {
  const prepared = raw
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && f.fruits?.length)
    .map((f) => {
      const pref = prefectureOf(f.address);
      const fruits = (f.fruits ?? []).filter((n) => LABELS[n]);
      const s = seasons[f.id];
      return { f, pref, fruits, s, ...assign(fruits, s?.windows ?? []) };
    })
    .filter((p) => p.pref && p.fruits.length);

  // Regional estimate per fruit, from farms that list their own dates.
  const stats: Record<string, Record<string, RegionFruitStat>> = {};
  for (const fruit of PICKING_FRUITS) {
    stats[fruit.name] = {};
    for (const region of REGIONS) {
      const listed = prepared.filter((p) => p.pref!.region === region.id && p.byFruit[fruit.name]);
      const monthShare = Array.from({ length: 12 }, (_v, i) => {
        if (!listed.length) return 0;
        const open = listed.filter((p) => p.byFruit[fruit.name].some((r) => daysInMonthCovered(r, i + 1) >= 10)).length;
        return open / listed.length;
      });
      const months = listed.length >= REGION_MIN_LISTINGS ? monthShare.flatMap((v, i) => (v >= REGION_SHARE ? [i + 1] : [])) : [];
      stats[fruit.name][region.id] = { listings: listed.length, monthShare, months };
    }
  }

  const farms: Farm[] = prepared.map(({ f, pref, fruits, s, byFruit, farmOpen }) => ({
    id: f.id, name: f.name, address: f.address, url: f.url, lat: f.lat!, lon: f.lon!,
    pref: pref!.en, region: pref!.region,
    period: s?.windows?.length ? s.period : undefined,
    seasons: fruits.map((fruit): FarmFruitSeason => {
      if (byFruit[fruit]) return { fruit, ranges: byFruit[fruit], source: "farm" };
      const stat = stats[fruit][pref!.region];
      const info = PICKING_FRUITS.find((x) => x.name === fruit)!;
      const regional = stat.months.length ? monthsToRanges(stat.months) : null;
      let ranges = regional ?? monthsToRanges(info.months);
      // A mixed farm's own opening dates trim the estimate.
      if (farmOpen.length) ranges = intersect(ranges, farmOpen);
      return regional ? { fruit, ranges, source: "region", basis: stat.listings } : { fruit, ranges, source: "typical" };
    }).filter((x) => x.ranges.length),
  }));

  return { farms, stats };
}

// Day-level intersection, rebuilt into ranges.
function intersect(a: DayRange[], b: DayRange[]): DayRange[] {
  const days: boolean[] = [];
  for (let d = 1; d <= 365; d++) days[d] = a.some((r) => rangeCovers(r, d)) && b.some((r) => rangeCovers(r, d));
  return daysToRanges(days);
}

function dayToMonthDay(day: number): MonthDay {
  const m = monthOfDay(day);
  return [m, day - MONTH_START[m - 1] + 1];
}

export function daysToRanges(days: boolean[]): DayRange[] {
  const out: DayRange[] = [];
  if (days.slice(1, 366).every(Boolean)) return [[[1, 1], [12, 31]]];
  for (let d = 1; d <= 365; d++) {
    const prev = d === 1 ? 365 : d - 1;
    if (!days[d] || days[prev]) continue;
    let end = d;
    while (days[end === 365 ? 1 : end + 1]) end = end === 365 ? 1 : end + 1;
    out.push([dayToMonthDay(d), dayToMonthDay(end)]);
  }
  return out;
}

export function farmOpenOn(farm: Farm, fruit: string, days: number[]): FarmFruitSeason | null {
  const s = farm.seasons.find((x) => x.fruit === fruit);
  return s && rangesOverlapDays(s.ranges, days) ? s : null;
}

export function sourceLabel(s: FarmFruitSeason, regionName?: string): string {
  if (s.source === "farm") return "from the farm's listing";
  if (s.source === "region") return `estimated from ${s.basis} farm listings${regionName ? ` in ${regionName}` : ""}`;
  return "typical season, approximate";
}
