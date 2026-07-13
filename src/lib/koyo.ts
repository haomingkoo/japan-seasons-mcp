import { cache, TTL } from "./cache.js";
import { logger } from "./logger.js";
import { safeFetch } from "./fetch.js";
import { romanizeName } from "./romaji.js";
import { tokyoDatumToWGS84 } from "./areas.js";
import { daysFromTodayJst, formatMonthDayJst } from "./dates.js";
import { PREF_NAMES_EN, PREF_CODE_TO_NAME_EN } from "./sakura-forecast.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KoyoForecastResult {
  source: string;
  lastUpdated: string;
  mapleForecastMapUrl: string;
  mapleForecastMapUrlEn: string;
  ginkgoForecastMapUrl: string;
  ginkgoForecastMapUrlEn: string;
  forecastComment: string;
  updateSchedule: string[];
  regions: KoyoRegion[];
}

export interface KoyoRegion {
  code: string;
  name: string;
  cities: KoyoCity[];
}

export interface KoyoCity {
  code: string;
  name: string;
  nameEn: string;
  prefName: string;
  prefNameEn: string;
  maple: {
    forecast: string | null;      // ISO date
    normalDiffClass: string;      // e.g. "平年より遅い" (later than normal)
    normalDiffDays: number;
    species: string;              // e.g. "やまもみじ" (yama-momiji)
  } | null;
  ginkgo: {
    forecast: string | null;
    normalDiffClass: string;
    normalDiffDays: number;
  } | null;
}

export interface KoyoSpot {
  code: string;
  name: string;
  nameReading: string;
  nameRomaji: string;
  lat: number;
  lon: number;
  leafType: string;              // "1" = maple, etc.
  popularity: number;            // access_star rating
  bestStart: string | null;      // ISO date — start of viewing window
  bestPeak: string | null;       // ISO date — peak color
  bestEnd: string | null;        // ISO date — end of viewing window
  status: string;
}

export interface KoyoSpotResult {
  source: string;
  prefecture: string;
  spots: KoyoSpot[];
}

// ─── Prefecture mapping: imported from sakura-forecast.ts (single source of truth) ───


const REGION_EN: Record<string, string> = {
  "北海道地方": "Hokkaido", "東北地方": "Tohoku",
  "関東・甲信地方": "Kanto/Koshin", "東海地方": "Tokai",
  "北陸地方": "Hokuriku", "近畿地方": "Kinki",
  "中国地方": "Chugoku", "四国地方": "Shikoku",
  "九州地方": "Kyushu",
};

const CITY_EN: Record<string, string> = {
  "札幌":"Sapporo","旭川":"Asahikawa","帯広":"Obihiro","釧路":"Kushiro",
  "室蘭":"Muroran","函館":"Hakodate","仙台":"Sendai","青森":"Aomori",
  "盛岡":"Morioka","秋田":"Akita","山形":"Yamagata","福島":"Fukushima",
  "東京":"Tokyo","水戸":"Mito","宇都宮":"Utsunomiya","前橋":"Maebashi",
  "熊谷":"Kumagaya","銚子":"Choshi","横浜":"Yokohama","甲府":"Kofu",
  "長野":"Nagano","名古屋":"Nagoya","岐阜":"Gifu","静岡":"Shizuoka",
  "津":"Tsu","新潟":"Niigata","富山":"Toyama","金沢":"Kanazawa",
  "福井":"Fukui","大阪":"Osaka","彦根":"Hikone","京都":"Kyoto",
  "神戸":"Kobe","奈良":"Nara","和歌山":"Wakayama","鳥取":"Tottori",
  "松江":"Matsue","岡山":"Okayama","広島":"Hiroshima","下関":"Shimonoseki",
  "徳島":"Tokushima","高松":"Takamatsu","松山":"Matsuyama","高知":"Kochi",
  "福岡":"Fukuoka","佐賀":"Saga","長崎":"Nagasaki","熊本":"Kumamoto",
  "大分":"Oita","宮崎":"Miyazaki","鹿児島":"Kagoshima",
};


const NORMAL_DIFF_EN: Record<string, string> = {
  "平年並": "Normal",
  "平年より早い": "Earlier than normal",
  "平年よりかなり早い": "Much earlier than normal",
  "平年より遅い": "Later than normal",
  "平年よりかなり遅い": "Much later than normal",
};

// ─── n-kishou Koyo APIs ──────────────────────────────────────────────────────

const KOYO_TOP_INFO = "https://tennavi-data-prod.n-kishou.co.jp/koyo/top_info.json";
const KOYO_UPDATE_INFO = "https://tennavi-data-prod.n-kishou.co.jp/koyo/update_info.json";
const KOYO_FORECAST_LIST = "https://tennavi-data-prod.n-kishou.co.jp/koyo/koyo_jma_forecast_list.json";
const KOYO_SPOTS_API = "https://other-api-prod.n-kishou.co.jp/list-jr-points";

export async function getKoyoForecast(): Promise<KoyoForecastResult> {
  const cacheKey = "koyo-forecast";
  return cache.getOrFetch(cacheKey, TTL.FORECAST, async () => {
    logger.info("Fetching koyo forecast from n-kishou");

    const [topRes, updateRes, listRes] = await Promise.all([
      safeFetch(KOYO_TOP_INFO),
      safeFetch(KOYO_UPDATE_INFO),
      safeFetch(KOYO_FORECAST_LIST),
    ]);

    if (!topRes.ok) throw new Error(`Koyo top info error: ${topRes.status}`);
    if (!updateRes.ok) throw new Error(`Koyo update info error: ${updateRes.status}`);
    if (!listRes.ok) throw new Error(`Koyo forecast list error: ${listRes.status}`);

    const top = (await topRes.json())?.result_list;
    const updates = (await updateRes.json())?.result_list?.data;
    const list = (await listRes.json())?.result_list;

    // Fetch forecast comment
    let forecastComment = "";
    if (top?.comment) {
      try {
        const commentRes = await safeFetch(top.comment);
        if (commentRes.ok) {
          const raw = await commentRes.text();
          forecastComment = raw.replace(/\[橙→\]/g, "").replace(/\[←\]/g, "").replace(/\[.*?→\]/g, "").trim();
        }
      } catch {
        logger.warn("Failed to fetch koyo comment text");
      }
    }

    // Parse per-city forecast list
    const regions: KoyoRegion[] = (list?.region ?? []).map((r: any) => ({
      code: r.code ?? "",
      name: REGION_EN[r.name] ?? r.name ?? "",
      cities: (r.list ?? []).map((c: any) => ({
        code: c.code ?? "",
        name: c.name ?? "",
        nameEn: CITY_EN[c.name] ?? c.name ?? "",
        prefName: c.pref_name ?? "",
        prefNameEn: PREF_NAMES_EN[c.pref_name] ?? c.pref_name ?? "",
        maple: c.kaede_forecast_datetime ? {
          forecast: c.kaede_forecast_datetime,
          normalDiffClass: NORMAL_DIFF_EN[c.kaede_normal_diff_class] ?? c.kaede_normal_diff_class ?? "",
          normalDiffDays: c.kaede_normal_diff_days ?? 0,
          species: c.kaede_species ?? "",
        } : null,
        ginkgo: c.ichou_forecast_datetime ? {
          forecast: c.ichou_forecast_datetime,
          normalDiffClass: NORMAL_DIFF_EN[c.ichou_normal_diff_class] ?? c.ichou_normal_diff_class ?? "",
          normalDiffDays: c.ichou_normal_diff_days ?? 0,
        } : null,
      })),
    }));

    return {
      source: "Japan Meteorological Corporation (n-kishou.co.jp)",
      lastUpdated: top?.update_datetime ?? "",
      mapleForecastMapUrl: top?.kaede_countour_map ?? "",
      mapleForecastMapUrlEn: top?.kaede_countour_map_english ?? "",
      ginkgoForecastMapUrl: top?.ichou_countour_map ?? "",
      ginkgoForecastMapUrlEn: top?.ichou_countour_map_english ?? "",
      forecastComment,
      updateSchedule: Array.isArray(updates) ? updates.map((u: any) => u.day_str ?? "") : [],
      regions,
    };
  });
}

// ─── Koyo spots (687 spots across Japan) ─────────────────────────────────────

export async function getKoyoSpots(prefCode: string): Promise<KoyoSpotResult> {
  const cacheKey = `koyo-spots:${prefCode}`;
  return cache.getOrFetch(cacheKey, TTL.SPOTS, async () => {
    logger.info(`Fetching koyo spots for prefecture ${prefCode}`);
    const url = `${KOYO_SPOTS_API}?type=koyo&filter_mode=forecast&area_mode=pref&area_code=${prefCode}&sort_code=0`;
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`Koyo spots API error: ${res.status}`);
    const data = await res.json();

    const result = data?.result_list;
    if (result?.error) {
      throw new Error(`Koyo spots API returned error: ${result.message}`);
    }

    const spots: KoyoSpot[] = (result?.jr_data ?? []).map((s: any) => ({
      code: s.code ?? "",
      name: s.name ?? "",
      nameReading: s.kana ?? "",
      nameRomaji: romanizeName(s.name ?? "", s.kana ?? ""),
      ...tokyoDatumToWGS84(s.lat ?? 0, s.lon ?? 0),
      leafType: s.leaf_type === "1" ? "Maple (momiji)" : s.leaf_type === "2" ? "Ginkgo (ichou)" : "Mixed",
      popularity: parseInt(s.access_star ?? "0"),
      bestStart: s.best_start_datetime ?? null,
      bestPeak: s.best_peak_datetime ?? null,
      bestEnd: s.best_end_datetime ?? null,
      status: computeKoyoStatus(s.best_start_datetime, s.best_peak_datetime, s.best_end_datetime),
    }));

    return {
      source: "Japan Meteorological Corporation (n-kishou.co.jp)",
      prefecture: PREF_CODE_TO_NAME_EN[prefCode] ?? result?.area ?? "",
      spots,
    };
  });
}

function computeKoyoStatus(start: string | null, peak: string | null, end: string | null): string {
  if (!start || !peak || !end) return "No forecast available";
  const daysToStart = daysFromTodayJst(start);
  const daysToPeak = daysFromTodayJst(peak);
  const daysToEnd = daysFromTodayJst(end);
  if (daysToStart === null || daysToPeak === null || daysToEnd === null) return "No forecast available";

  if (daysToEnd < -7) return "Ended — leaves have fallen";
  if (daysToEnd < 0) return "Final days — leaves falling";
  if (daysToPeak <= 0 && daysToEnd >= 0) return "Peak colors — best viewing!";
  if (daysToStart <= 0 && daysToPeak > 0) return "Turning — colors developing";
  if (daysToStart > 0 && daysToStart <= 7) return `Starting soon — ${daysToStart} day(s) away`;
  if (daysToStart > 7 && daysToStart <= 30) return "Coming — leaves still green";
  return "Not yet — more than a month away";
}

export function formatDate(iso: string | null): string {
  return formatMonthDayJst(iso);
}
