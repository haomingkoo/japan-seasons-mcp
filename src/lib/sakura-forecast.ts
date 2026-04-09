import * as cheerio from "cheerio";
import { cache, TTL } from "./cache.js";
import { logger } from "./logger.js";
import { safeFetch } from "./fetch.js";
import { romanizeName } from "./romaji.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SakuraCity {
  prefCode: string;
  prefName: string;
  stationCode: string;
  cityName: string;
  region: string;
  bloom: {
    normal: string | null;       // historical average, e.g. "3/24"
    forecast: string | null;     // ISO date, e.g. "2026-03-19T00:00:00+09:00"
    observation: string | null;  // ISO date if already bloomed
  };
  fullBloom: {
    normal: string | null;
    forecast: string | null;
    observation: string | null;
  };
  status: string;  // computed bloom status
}

export interface SakuraForecastResult {
  source: string;
  regions: SakuraRegion[];
  totalCities: number;
}

export interface SakuraRegion {
  code: string;
  name: string;
  nameEn: string;
  comment: string[];
  cities: SakuraCity[];
}

// Spot-level data (1000+ individual cherry blossom viewing spots)
export interface SakuraSpot {
  code: string;           // spot code e.g. "13370031"
  name: string;           // Japanese name e.g. "靖国神社"
  nameReading: string;    // kana reading e.g. "やすくにじんじゃ"
  nameRomaji: string;     // romanized e.g. "Yasukuni Jinja"
  lat: number;
  lon: number;
  prefecture: string;     // prefecture name
  bloomForecast: string | null;   // ISO date
  fullBloomForecast: string | null;
  bloomRate: number;      // 0-100+ (% progress toward blooming)
  fullRate: number;       // 0-100+ (% progress toward full bloom)
  status: string;         // computed from rates
}

export interface SakuraSpotResult {
  source: string;
  prefecture: string;
  lastUpdated: string;
  jmaStation: {
    name: string;
    bloomRate: number;
    fullRate: number;
    bloomForecast: string | null;
    fullForecast: string | null;
    bloomObservation: string | null;
    fullObservation: string | null;
    bloomNormal: string | null;
    fullNormal: string | null;
  } | null;
  spots: SakuraSpot[];
}

// ─── Region name mapping ─────────────────────────────────────────────────────

const REGION_NAMES_EN: Record<string, string> = {
  "北海道地方": "Hokkaido",
  "東北地方": "Tohoku",
  "関東・甲信地方": "Kanto/Koshin",
  "東海地方": "Tokai",
  "北陸地方": "Hokuriku",
  "近畿地方": "Kinki",
  "中国地方": "Chugoku",
  "四国地方": "Shikoku",
  "九州地方": "Kyushu",
};

// Japanese city name → English
const CITY_NAMES_EN: Record<string, string> = {
  "稚内": "Wakkanai", "旭川": "Asahikawa", "網走": "Abashiri",
  "釧路": "Kushiro", "帯広": "Obihiro", "札幌": "Sapporo",
  "室蘭": "Muroran", "函館": "Hakodate",
  "青森": "Aomori", "盛岡": "Morioka", "仙台": "Sendai",
  "秋田": "Akita", "山形": "Yamagata", "福島": "Fukushima",
  "水戸": "Mito", "宇都宮": "Utsunomiya", "前橋": "Maebashi",
  "熊谷": "Kumagaya", "銚子": "Choshi", "東京": "Tokyo",
  "横浜": "Yokohama", "甲府": "Kofu", "長野": "Nagano",
  "名古屋": "Nagoya", "岐阜": "Gifu", "静岡": "Shizuoka", "津": "Tsu",
  "新潟": "Niigata", "富山": "Toyama", "金沢": "Kanazawa", "福井": "Fukui",
  "大阪": "Osaka", "彦根": "Hikone", "京都": "Kyoto",
  "神戸": "Kobe", "奈良": "Nara", "和歌山": "Wakayama",
  "広島": "Hiroshima", "鳥取": "Tottori", "松江": "Matsue",
  "岡山": "Okayama", "下関": "Shimonoseki",
  "徳島": "Tokushima", "高松": "Takamatsu", "松山": "Matsuyama", "高知": "Kochi",
  "福岡": "Fukuoka", "佐賀": "Saga", "長崎": "Nagasaki",
  "熊本": "Kumamoto", "大分": "Oita", "宮崎": "Miyazaki", "鹿児島": "Kagoshima",
  "那覇": "Naha", "名瀬": "Naze",
};

const PREF_NAMES_EN: Record<string, string> = {
  "北海道": "Hokkaido", "青森県": "Aomori", "岩手県": "Iwate",
  "宮城県": "Miyagi", "秋田県": "Akita", "山形県": "Yamagata",
  "福島県": "Fukushima", "茨城県": "Ibaraki", "栃木県": "Tochigi",
  "群馬県": "Gunma", "埼玉県": "Saitama", "千葉県": "Chiba",
  "東京都": "Tokyo", "神奈川県": "Kanagawa", "山梨県": "Yamanashi",
  "長野県": "Nagano", "新潟県": "Niigata", "富山県": "Toyama",
  "石川県": "Ishikawa", "福井県": "Fukui", "岐阜県": "Gifu",
  "静岡県": "Shizuoka", "愛知県": "Aichi", "三重県": "Mie",
  "滋賀県": "Shiga", "京都府": "Kyoto", "大阪府": "Osaka",
  "兵庫県": "Hyogo", "奈良県": "Nara", "和歌山県": "Wakayama",
  "鳥取県": "Tottori", "島根県": "Shimane", "岡山県": "Okayama",
  "広島県": "Hiroshima", "山口県": "Yamaguchi",
  "徳島県": "Tokushima", "香川県": "Kagawa", "愛媛県": "Ehime", "高知県": "Kochi",
  "福岡県": "Fukuoka", "佐賀県": "Saga", "長崎県": "Nagasaki",
  "熊本県": "Kumamoto", "大分県": "Oita", "宮崎県": "Miyazaki",
  "鹿児島県": "Kagoshima", "沖縄県": "Okinawa",
};

// ─── Prefecture codes for spot-level API ─────────────────────────────────────

const PREF_CODES: Record<string, string> = {
  "hokkaido": "01", "aomori": "02", "iwate": "03", "miyagi": "04",
  "akita": "05", "yamagata": "06", "fukushima": "07", "ibaraki": "08",
  "tochigi": "09", "gunma": "10", "saitama": "11", "chiba": "12",
  "tokyo": "13", "kanagawa": "14", "niigata": "15", "toyama": "16",
  "ishikawa": "17", "fukui": "18", "yamanashi": "19", "nagano": "20",
  "gifu": "21", "shizuoka": "22", "aichi": "23", "mie": "24",
  "shiga": "25", "kyoto": "26", "osaka": "27", "hyogo": "28",
  "nara": "29", "wakayama": "30", "tottori": "31", "shimane": "32",
  "okayama": "33", "hiroshima": "34", "yamaguchi": "35", "tokushima": "36",
  "kagawa": "37", "ehime": "38", "kochi": "39", "fukuoka": "40",
  "saga": "41", "nagasaki": "42", "kumamoto": "43", "oita": "44",
  "miyazaki": "45", "kagoshima": "46", "okinawa": "47",
};

const PREF_CODE_TO_NAME_EN: Record<string, string> = Object.fromEntries(
  Object.entries(PREF_CODES).map(([name, code]) => [code, name.charAt(0).toUpperCase() + name.slice(1)])
);

// ─── n-kishou API ────────────────────────────────────────────────────────────

const NKISHOU_SAKURA_API = "https://other-api-prod.n-kishou.co.jp/get-sakura-hw";
const NKISHOU_SPOTS_API = "https://other-api-prod.n-kishou.co.jp/list-jr-points";

export async function getSakuraForecast(): Promise<SakuraForecastResult> {
  const cacheKey = "sakura-forecast:nkishou";
  return cache.getOrFetch(cacheKey, TTL.FORECAST, async () => {
    logger.info("Fetching sakura forecast from n-kishou API");
    const res = await safeFetch(NKISHOU_SAKURA_API);
    const data = await res.json();
    return parseNkishouResponse(data);
  });
}

function parseNkishouResponse(data: any): SakuraForecastResult {
  const rawRegions = data?.result_list?.region;
  if (!Array.isArray(rawRegions)) {
    throw new Error("Unexpected n-kishou API response structure");
  }

  const regions: SakuraRegion[] = rawRegions.map((r: any) => {
    const cities: SakuraCity[] = (r.sample ?? []).map((s: any) => {
      const city: SakuraCity = {
        prefCode: s.pref ?? "",
        prefName: PREF_NAMES_EN[s.pref_name] ?? s.pref_name ?? "",
        stationCode: s.code ?? "",
        cityName: CITY_NAMES_EN[s.name] ?? s.name ?? "",
        region: REGION_NAMES_EN[r.name] ?? r.name ?? "",
        bloom: {
          normal: s.bloom?.normal ?? null,
          forecast: s.bloom?.forecast ?? null,
          observation: s.bloom?.observation ?? null,
        },
        fullBloom: {
          normal: s.full?.normal ?? null,
          forecast: s.full?.forecast ?? null,
          observation: s.full?.observation ?? null,
        },
        status: "",
      };
      city.status = computeBloomStatus(city);
      return city;
    });

    return {
      code: r.code ?? "",
      name: r.name ?? "",
      nameEn: REGION_NAMES_EN[r.name] ?? r.name ?? "",
      comment: Array.isArray(r.comment) ? r.comment : [],
      cities,
    };
  });

  const totalCities = regions.reduce((sum, r) => sum + r.cities.length, 0);
  return { source: "Japan Meteorological Corporation (n-kishou.co.jp)", regions, totalCities };
}

// ─── Spot-level API (1000+ spots per prefecture) ────────────────────────────

export function findPrefCode(query: string): string | null {
  const q = query.toLowerCase().replace(/[\s-]/g, "");
  // Direct code match
  if (/^\d{2}$/.test(q) && parseInt(q) >= 1 && parseInt(q) <= 47) {
    return q.padStart(2, "0");
  }
  // Name match
  for (const [name, code] of Object.entries(PREF_CODES)) {
    if (name.includes(q) || q.includes(name)) return code;
  }
  // Also check Japanese prefecture names
  for (const [ja, en] of Object.entries(PREF_NAMES_EN)) {
    if (en.toLowerCase().includes(q) || q.includes(en.toLowerCase())) {
      return PREF_CODES[en.toLowerCase()] ?? null;
    }
  }
  return null;
}

export async function getSakuraSpots(prefCode: string): Promise<SakuraSpotResult> {
  const cacheKey = `sakura-spots:${prefCode}`;
  return cache.getOrFetch(cacheKey, TTL.SPOTS, async () => {
    logger.info(`Fetching sakura spots for prefecture ${prefCode}`);
    const url = `${NKISHOU_SPOTS_API}?type=sakura&filter_mode=forecast&area_mode=pref&area_code=${prefCode}&sort_code=0`;
    const res = await safeFetch(url);
    const data = await res.json();
    return parseSpotsResponse(data, prefCode);
  });
}

function parseSpotsResponse(data: any, prefCode: string): SakuraSpotResult {
  const result = data?.result_list;
  if (result?.error) {
    throw new Error(`Spots API returned error: ${result.message}`);
  }

  // Parse JMA station data
  let jmaStation = null;
  const jmaData = result?.jma_data;
  if (Array.isArray(jmaData) && jmaData.length > 0) {
    const s = jmaData[0];
    jmaStation = {
      name: CITY_NAMES_EN[s.name] ?? s.name ?? "",
      bloomRate: s.bloom_rate ?? 0,
      fullRate: s.full_rate ?? 0,
      bloomForecast: s.bloom_forecast_datetime ?? null,
      fullForecast: s.full_forecast_datetime ?? null,
      bloomObservation: s.bloom_observation_datetime ?? null,
      fullObservation: s.full_observation_datetime ?? null,
      bloomNormal: s.bloom_normal_day_str ?? null,
      fullNormal: s.full_normal_day_str ?? null,
    };
  }

  // Parse individual spots
  const spots: SakuraSpot[] = (result?.jr_data ?? []).map((s: any) => {
    const bloomRate = s.bloom_rate ?? 0;
    const fullRate = s.full_rate ?? 0;
    return {
      code: s.code ?? "",
      name: s.name ?? "",
      nameReading: s.kana ?? "",
      nameRomaji: romanizeName(s.name ?? "", s.kana ?? ""),
      lat: s.lat ?? 0,
      lon: s.lon ?? 0,
      prefecture: PREF_CODE_TO_NAME_EN[prefCode] ?? result?.area ?? "",
      bloomForecast: s.bloom_forecast_datetime ?? null,
      fullBloomForecast: s.full_forecast_datetime ?? null,
      bloomRate,
      fullRate,
      status: computeSpotStatus(bloomRate, fullRate),
    };
  });

  return {
    source: "Japan Meteorological Corporation (n-kishou.co.jp)",
    prefecture: PREF_CODE_TO_NAME_EN[prefCode] ?? result?.area ?? "",
    lastUpdated: result?.update_datetime ?? "",
    jmaStation,
    spots,
  };
}

// Official n-kishou bloom scale (from their documentation):
//
// BLOOM RATE (生長率) — progress from bud to first bloom:
//   0-59%   花芽〜つぼみ         Bud stage
//   60-84%  つぼみが膨らみ始める  Buds swelling
//   85-99%  つぼみが開き始める    Buds starting to open
//   100%    開花                  First bloom!
//
// FULL BLOOM RATE (満開率) — progress from first bloom to full bloom:
//   0-19%   開花                  Just bloomed (1-2 branches)
//   20-39%  三分咲き              30% bloom (sanbu-zaki)
//   40-69%  五分咲き              50% bloom (gobu-zaki)
//   70-89%  七分咲き              70% bloom (nanabu-zaki)
//   90-100% 満開                  Full bloom (mankai)!

function computeSpotStatus(bloomRate: number, fullRate: number): string {
  if (fullRate >= 100) return "Full bloom — best viewing!";
  if (fullRate >= 90) return "Nearly full bloom";
  if (fullRate >= 70) return "70% bloom";
  if (fullRate >= 40) return "50% bloom";
  if (fullRate >= 20) return "30% bloom";
  if (fullRate > 0) return "Just started blooming";

  if (bloomRate >= 100) return "Blooming — petals opening!";
  if (bloomRate >= 85) return "Buds opening";
  if (bloomRate >= 60) return "Buds swelling";
  if (bloomRate > 0) return "Bud stage";
  return "Dormant";
}

export function getAvailablePrefectures(): string[] {
  return Object.entries(PREF_CODES).map(
    ([name, code]) => `${code}: ${name.charAt(0).toUpperCase() + name.slice(1)}`
  );
}

// ─── Bloom status computation ────────────────────────────────────────────────

function computeBloomStatus(city: SakuraCity): string {
  const now = new Date();

  // If we have actual observation data, use it
  if (city.fullBloom.observation) {
    const fullDate = new Date(city.fullBloom.observation);
    const daysSinceFull = Math.floor((now.getTime() - fullDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceFull > 10) return "Ended — petals have fallen";
    if (daysSinceFull > 5) return "Falling — petals scattering";
    if (daysSinceFull >= 0) return "Full bloom — best viewing!";
  }

  if (city.bloom.observation && !city.fullBloom.observation) {
    const bloomDate = new Date(city.bloom.observation);
    const daysSinceBloom = Math.floor((now.getTime() - bloomDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceBloom > 10) return "Likely past full bloom";
    if (daysSinceBloom > 5) return "Approaching full bloom";
    if (daysSinceBloom >= 0) return "Blooming";
  }

  // Use forecast data
  const forecastDate = city.bloom.forecast ? new Date(city.bloom.forecast) : null;
  if (forecastDate) {
    const daysUntilBloom = Math.floor((forecastDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilBloom > 14) return "Not yet — more than 2 weeks away";
    if (daysUntilBloom > 7) return "Coming soon — 1-2 weeks away";
    if (daysUntilBloom > 0) return `Coming soon — about ${daysUntilBloom} day(s)`;
    return "Should be blooming (no observation yet)";
  }

  return "No forecast available";
}

// ─── Weathermap.jp scraper (secondary source) ────────────────────────────────

export interface WeathermapEntry {
  city: string;
  region: string;
  firstBloomDate: string | null;
  fullBloomDate: string | null;
}

export async function getSakuraForecastWeathermap(): Promise<WeathermapEntry[]> {
  const cacheKey = "sakura-forecast:weathermap";
  return cache.getOrFetch(cacheKey, TTL.FORECAST, async () => {
    logger.info("Fetching sakura forecast from weathermap.jp");
    const res = await safeFetch("https://sakura.weathermap.jp/en.php");
    const html = await res.text();
    return parseWeathermapHtml(html);
  });
}

function parseWeathermapHtml(html: string): WeathermapEntry[] {
  const $ = cheerio.load(html);
  const entries: WeathermapEntry[] = [];
  let currentRegion = "";

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td, th");
    const firstCell = $(cells[0]).text().trim();

    if (cells.length <= 2 && isRegionHeader(firstCell)) {
      currentRegion = firstCell;
      return;
    }

    if (cells.length >= 3) {
      const city = $(cells[0]).text().trim();
      const first = $(cells[1]).text().trim();
      const full = $(cells[2]).text().trim();

      if (city && /\d{1,2}\/\d{1,2}/.test(first)) {
        entries.push({
          city,
          region: currentRegion,
          firstBloomDate: normalizeDate(first),
          fullBloomDate: normalizeDate(full),
        });
      }
    }
  });

  return entries;
}

function isRegionHeader(text: string): boolean {
  const regions = [
    "hokkaido", "tohoku", "kanto", "koshin", "tokai", "hokuriku",
    "kinki", "chugoku", "shikoku", "kyushu", "okinawa", "amami",
  ];
  return regions.some((r) => text.toLowerCase().includes(r));
}

function normalizeDate(text: string): string | null {
  if (!text || text === "---" || text === "-") return null;
  const match = text.match(/(\d{1,2})\/(\d{1,2})/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export function formatDate(iso: string | null): string {
  if (!iso) return "N/A";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

export function findCities(forecast: SakuraForecastResult, query: string): SakuraCity[] {
  const q = query.toLowerCase();
  const results: SakuraCity[] = [];
  for (const region of forecast.regions) {
    for (const city of region.cities) {
      if (
        city.cityName.toLowerCase().includes(q) ||
        city.prefName.toLowerCase().includes(q) ||
        city.region.toLowerCase().includes(q)
      ) {
        results.push(city);
      }
    }
  }
  return results;
}

export function findBestRegions(
  forecast: SakuraForecastResult,
  startDate: Date,
  endDate: Date
): SakuraCity[] {
  const results: SakuraCity[] = [];
  for (const region of forecast.regions) {
    for (const city of region.cities) {
      const fullBloomDate = city.fullBloom.observation
        ? new Date(city.fullBloom.observation)
        : city.fullBloom.forecast
          ? new Date(city.fullBloom.forecast)
          : null;

      if (!fullBloomDate) continue;

      // Best viewing: 2 days before full bloom to 5 days after
      const windowStart = new Date(fullBloomDate);
      windowStart.setDate(windowStart.getDate() - 2);
      const windowEnd = new Date(fullBloomDate);
      windowEnd.setDate(windowEnd.getDate() + 5);

      if (startDate <= windowEnd && endDate >= windowStart) {
        results.push(city);
      }
    }
  }
  return results;
}

// ─── Kawazu cherry blossom data ──────────────────────────────────────────────

export interface KawazuSpot {
  code: string;
  name: string;
  nameRomaji: string;
  lat: number;
  lon: number;
  bloomForecast: string | null;
  fullBloomForecast: string | null;
  bloomRate: number;
  fullRate: number;
  status: string;
}

export interface KawazuResult {
  source: string;
  lastUpdated: string;
  forecastMapUrl: string;
  forecastMapUrlEn: string;
  forecastComment: string;
  spots: KawazuSpot[];
}

const KAWAZU_INFO_URL = "https://tennavi-data-prod.n-kishou.co.jp/sakura/kawazu_info.json";
const KAWAZU_LIST_URL = "https://tennavi-data-prod.n-kishou.co.jp/sakura/sakura_forecast_kawazu_list.json";

export async function getKawazuForecast(): Promise<KawazuResult> {
  const cacheKey = "kawazu-forecast";
  return cache.getOrFetch(cacheKey, TTL.FORECAST, async () => {
    logger.info("Fetching Kawazu cherry blossom data");

    const [infoRes, listRes] = await Promise.all([
      safeFetch(KAWAZU_INFO_URL),
      safeFetch(KAWAZU_LIST_URL),
    ]);

    // safeFetch already throws on non-OK responses

    const info = (await infoRes.json())?.result_list;
    const list = await listRes.json();

    // Fetch the forecast comment
    let forecastComment = "";
    if (info?.comment) {
      try {
        const commentRes = await safeFetch(info.comment);
        if (commentRes.ok) {
          forecastComment = await commentRes.text();
        }
      } catch {
        logger.warn("Failed to fetch Kawazu comment");
      }
    }

    const spots: KawazuSpot[] = (Array.isArray(list) ? list : []).map((s: any) => {
      const bloomRate = s.bloom_rate ?? 0;
      const fullRate = s.full_rate ?? 0;
      return {
        code: s.code ?? "",
        name: s.name ?? "",
        nameRomaji: romanizeName(s.name ?? "", s.kana ?? ""),
        lat: s.lat ?? 0,
        lon: s.lon ?? 0,
        bloomForecast: s.bloom_forecast_datetime ?? null,
        fullBloomForecast: s.full_forecast_datetime ?? null,
        bloomRate,
        fullRate,
        status: computeSpotStatus(bloomRate, fullRate),
      };
    });

    return {
      source: "Japan Meteorological Corporation (n-kishou.co.jp)",
      lastUpdated: info?.update_datetime ?? "",
      forecastMapUrl: info?.countour_map ?? "",
      forecastMapUrlEn: info?.countour_map_english ?? "",
      forecastComment,
      spots,
    };
  });
}
