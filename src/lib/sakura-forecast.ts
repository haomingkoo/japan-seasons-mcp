import { cache, TTL } from "./cache.js";
import { logger } from "./logger.js";
import { safeFetch } from "./fetch.js";
import { romanizeName } from "./romaji.js";
import { tokyoDatumToWGS84 } from "./areas.js";
import { DAY_MS, daysFromTodayJst, formatMonthDayJst, parseDateInputJst } from "./dates.js";

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
  bloomRate: number;      // 0-100 (% progress toward first bloom)
  fullRate: number;       // 0-100 (% progress from first bloom to full bloom)
  status: string;         // human-readable model status (from jr_data)
  // Spot-level observation from JMC's current-status layer
  observationState: number | null;   // 0=pre-bloom,1=first bloom,2=30%,3=70%,4=full bloom,5=petals falling,6=hazakura
  observationStatus: string | null;  // human-readable label for observation state
  observationUpdated: string | null; // ISO date when observation was recorded
  observationFresh: boolean;         // true when observationUpdated is recent enough to trust as primary
  displayStatus: string;             // final user-facing status after freshness-aware source selection
  statusSource: "observation" | "estimate";
  statusUpdated: string | null;
  phase: "dormant" | "buds" | "bud_swell" | "bud_open" | "starting" | "blooming" | "peak" | "past_peak" | "falling" | "ended";
}

export interface SakuraSpotResult {
  source: string;
  prefecture: string;
  lastUpdated: string;
  observationUpdated: string | null;
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

interface SakuraRateStage {
  min: number;
  max: number;
  summary: string;
  status: string;
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

// ─── Spot observation layer ───────────────────────────────────────────────────
// JMC publishes a separate current-status layer for many spots.
// It can be newer than jr_data, but it may be missing or stale for some spots.
// We prefer it only when its timestamp is recent enough; jr_data remains the
// durable fallback.

export const SAKURA_SPOT_OBSERVATION_FRESH_HOURS = 48;

export const OBS_STATE_LABELS: Record<number, string> = {
  0: "Pre-bloom (buds visible)",
  1: "First bloom (a few flowers open)",
  2: "30% bloom (sanbu-zaki)",
  3: "70% bloom (nanabu-zaki)",
  4: "Full bloom (mankai)",
  5: "Petals starting to fall",
  6: "Leafy (hazakura)",
};

const OBS_STATE_PHASES: Record<number, SakuraSpot["phase"]> = {
  0: "buds",
  1: "starting",
  2: "blooming",
  3: "blooming",
  4: "peak",
  5: "falling",
  6: "ended",
};

function parseValidDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursSince(iso: string | null | undefined): number | null {
  const date = parseValidDate(iso);
  if (!date) return null;
  return (Date.now() - date.getTime()) / 3_600_000;
}

function daysSince(iso: string | null | undefined): number | null {
  const delta = daysFromTodayJst(iso);
  return delta === null ? null : -delta;
}

function isFreshObservation(iso: string | null | undefined): boolean {
  const ageHours = hoursSince(iso);
  if (ageHours === null) return false;
  return ageHours <= SAKURA_SPOT_OBSERVATION_FRESH_HOURS;
}

function computeEstimatedSpotPhase(
  bloomRate: number,
  fullRate: number,
  fullBloomForecast: string | null,
): SakuraSpot["phase"] {
  if (fullRate >= 100) {
    const days = daysSince(fullBloomForecast);
    if (days !== null) {
      if (days > 10) return "ended";
      if (days > 6) return "falling";
      if (days > 3) return "past_peak";
    }
    return "peak";
  }
  if (fullRate >= 90) return "peak";
  if (fullRate >= 20) return fullRate >= 70 ? "blooming" : "starting";
  if (fullRate > 0) return "starting";
  if (bloomRate >= 100) return "starting";
  if (bloomRate >= 85) return "bud_open";
  if (bloomRate >= 60) return "bud_swell";
  if (bloomRate > 0) return "buds";
  return "buds";
}

function computeEstimatedDisplayStatus(
  bloomRate: number,
  fullRate: number,
  fullBloomForecast: string | null,
): string {
  const phase = computeEstimatedSpotPhase(bloomRate, fullRate, fullBloomForecast);
  if (phase === "past_peak") return "Past peak — still some petals (estimated)";
  if (phase === "falling") return "Petals likely falling (estimated)";
  if (phase === "ended") return "Likely hazakura / green leaves (estimated)";
  return computeSpotStatus(bloomRate, fullRate);
}

function latestObservationTimestamp(observations: Map<string, { state: number; updated: string }>): string | null {
  let latest: string | null = null;
  for (const entry of observations.values()) {
    if (!entry.updated) continue;
    if (!latest || entry.updated > latest) latest = entry.updated;
  }
  return latest;
}

// Observation filter_codes 0-6 correspond to the state values returned:
//   0=pre-bloom, 1=first bloom, 2=30%, 3=70%, 4=full bloom,
//   5=petals falling, 6=hazakura (green leaves).
// Past-season prefectures (e.g. Tokyo by mid-April) return 400 for all codes —
// those failures are silently swallowed below and we fall back to jr_data.
async function fetchPrefObservations(prefCode: string): Promise<Map<string, { state: number; updated: string }>> {
  const map = new Map<string, { state: number; updated: string }>();
  try {
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4, 5, 6].map(async (fc) => {
        const url = `${NKISHOU_SPOTS_API}?type=sakura&filter_mode=observation&filter_code=${fc}&area_mode=pref&area_code=${prefCode}`;
        const res = await safeFetch(url);
        const data = await res.json();
        const rl = data?.result_list;
        const updated: string = rl?.update_datetime ?? "";
        for (const spot of rl?.data ?? []) {
          if (spot.code) {
            map.set(String(spot.code), { state: parseInt(String(spot.state), 10), updated });
          }
        }
      })
    );
    // Log any failures silently (observation fetch is best-effort)
    for (const r of results) {
      if (r.status === "rejected") {
        logger.info(`Spot observation fetch failed (non-critical): ${r.reason}`);
      }
    }
  } catch {
    // Observation layer is enhancement-only; forecast data is always the base
  }
  return map;
}

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

export async function getSakuraSpots(prefCode: string, options: { includeObservations?: boolean } = {}): Promise<SakuraSpotResult> {
  const includeObservations = options.includeObservations !== false;
  const cacheKey = `sakura-spots:${prefCode}:${includeObservations ? "observed" : "forecast"}`;
  return cache.getOrFetch(cacheKey, TTL.SPOTS, async () => {
    logger.info(`Fetching sakura spots for prefecture ${prefCode}`);
    const url = `${NKISHOU_SPOTS_API}?type=sakura&filter_mode=forecast&area_mode=pref&area_code=${prefCode}&sort_code=0`;
    // Prefecture detail pages include spot observations. The national all-spots
    // overview skips them so startup does not fan out to hundreds of optional
    // observation requests before the map can populate.
    const [res, observations] = includeObservations
      ? await Promise.all([safeFetch(url), fetchPrefObservations(prefCode)])
      : [await safeFetch(url), new Map()];
    const data = await res.json();
    return parseSpotsResponse(data, prefCode, observations);
  });
}

function parseSpotsResponse(data: any, prefCode: string, observations: Map<string, { state: number; updated: string }> = new Map()): SakuraSpotResult {
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

  // Parse individual spots, merging observation layer when available
  const spots: SakuraSpot[] = (result?.jr_data ?? []).map((s: any) => {
    const bloomRate = s.bloom_rate ?? 0;
    const fullRate = s.full_rate ?? 0;
    const code = String(s.code ?? "");
    const obs = observations.get(code) ?? null;
    const observationUpdated = obs ? obs.updated : null;
    const observationFresh = isFreshObservation(observationUpdated);
    const estimatedPhase = computeEstimatedSpotPhase(bloomRate, fullRate, s.full_forecast_datetime ?? null);
    const observationPhase = obs ? (OBS_STATE_PHASES[obs.state] ?? null) : null;
    const displayStatus = observationFresh && obs
      ? (OBS_STATE_LABELS[obs.state] ?? "Current bloom status")
      : computeEstimatedDisplayStatus(bloomRate, fullRate, s.full_forecast_datetime ?? null);
    const statusSource: SakuraSpot["statusSource"] = observationFresh && obs ? "observation" : "estimate";
    return {
      code,
      name: s.name ?? "",
      nameReading: s.kana ?? "",
      nameRomaji: romanizeName(s.name ?? "", s.kana ?? ""),
      ...tokyoDatumToWGS84(s.lat ?? 0, s.lon ?? 0),
      prefecture: PREF_CODE_TO_NAME_EN[prefCode] ?? result?.area ?? "",
      bloomForecast: s.bloom_forecast_datetime ?? null,
      fullBloomForecast: s.full_forecast_datetime ?? null,
      bloomRate,
      fullRate,
      status: computeSpotStatus(bloomRate, fullRate),
      observationState: obs ? obs.state : null,
      observationStatus: obs ? (OBS_STATE_LABELS[obs.state] ?? null) : null,
      observationUpdated,
      observationFresh,
      displayStatus,
      statusSource,
      statusUpdated: statusSource === "observation" ? observationUpdated : (result?.update_datetime ?? null),
      phase: statusSource === "observation" && observationPhase ? observationPhase : estimatedPhase,
    };
  });

  return {
    source: "Japan Meteorological Corporation (n-kishou.co.jp)",
    prefecture: PREF_CODE_TO_NAME_EN[prefCode] ?? result?.area ?? "",
    lastUpdated: result?.update_datetime ?? "",
    observationUpdated: latestObservationTimestamp(observations),
    jmaStation,
    spots,
  };
}

// Official JMC sakura spot scale. Keep thresholds here so status text and
// prompt copy stay aligned with one source of truth.
const SAKURA_BLOOM_RATE_STAGES: readonly SakuraRateStage[] = [
  { min: 0, max: 59, summary: "bud", status: "Bud stage (estimated)" },
  { min: 60, max: 84, summary: "swelling", status: "Buds swelling (estimated)" },
  { min: 85, max: 99, summary: "opening", status: "Buds opening (estimated)" },
  { min: 100, max: 100, summary: "first bloom", status: "First flowers open (estimated)" },
];

const SAKURA_FULL_BLOOM_RATE_STAGES: readonly SakuraRateStage[] = [
  { min: 0, max: 19, summary: "just opened", status: "Just started blooming (estimated)" },
  { min: 20, max: 39, summary: "30% bloom", status: "Some blossoms open (estimated 30% bloom)" },
  { min: 40, max: 69, summary: "50% bloom", status: "Blooming now (estimated 50% bloom)" },
  { min: 70, max: 89, summary: "70% bloom", status: "Good viewing now (estimated 70% bloom)" },
  { min: 90, max: 100, summary: "full bloom (mankai)", status: "Best viewing now (estimated full bloom)" },
];

function formatRateRange({ min, max }: SakuraRateStage): string {
  return min === max ? `${min}%` : `${min}-${max}%`;
}

function formatScaleLine(label: string, stages: readonly SakuraRateStage[]): string {
  return `${label}: ${stages.map((stage) => `${formatRateRange(stage)} ${stage.summary}`).join(" -> ")}`;
}

function getStageStatus(rate: number, stages: readonly SakuraRateStage[]): string {
  for (let i = stages.length - 1; i >= 0; i--) {
    const stage = stages[i];
    if (rate >= stage.min && rate <= stage.max) return stage.status;
  }
  return stages[0]?.status ?? "Status unavailable";
}

export const SAKURA_FULL_BLOOM_MANKAI_MIN = SAKURA_FULL_BLOOM_RATE_STAGES[SAKURA_FULL_BLOOM_RATE_STAGES.length - 1]?.min ?? 90;
export const SAKURA_BLOOM_RATE_SCALE_LINE = formatScaleLine("Bloom rate", SAKURA_BLOOM_RATE_STAGES);
export const SAKURA_FULL_BLOOM_RATE_SCALE_LINE = formatScaleLine("Full-bloom rate", SAKURA_FULL_BLOOM_RATE_STAGES);
export const SAKURA_SPOT_MODEL_NOTE =
  `Spot status uses fresh JMC spot observations first when updated within the last ${SAKURA_SPOT_OBSERVATION_FRESH_HOURS} hours. If a spot observation is missing or stale, we show the JMC bloom-meter estimate and keep the last observed status visible as context when available. The prefecture JMA reference tree is context only.`;

function computeSpotStatus(bloomRate: number, fullRate: number): string {
  if (fullRate > 0) return getStageStatus(fullRate, SAKURA_FULL_BLOOM_RATE_STAGES);
  return getStageStatus(bloomRate, SAKURA_BLOOM_RATE_STAGES);
}

export function getAvailablePrefectures(): string[] {
  return Object.entries(PREF_CODES).map(
    ([name, code]) => `${code}: ${name.charAt(0).toUpperCase() + name.slice(1)}`
  );
}

// ─── Bloom status computation ────────────────────────────────────────────────

function computeBloomStatus(city: SakuraCity): string {
  // If we have actual observation data, use it
  if (city.fullBloom.observation) {
    const fullDelta = daysFromTodayJst(city.fullBloom.observation);
    if (fullDelta !== null && fullDelta < -10) return "Ended — petals have fallen";
    if (fullDelta !== null && fullDelta < -5) return "Falling — petals scattering";
    if (fullDelta !== null && fullDelta <= 0) return "Full bloom — best viewing!";
  }

  if (city.bloom.observation && !city.fullBloom.observation) {
    const bloomDelta = daysFromTodayJst(city.bloom.observation);
    if (bloomDelta !== null && bloomDelta < -10) return "Likely past full bloom";
    if (bloomDelta !== null && bloomDelta < -5) return "Approaching full bloom";
    if (bloomDelta !== null && bloomDelta <= 0) return "Blooming";
  }

  // Use forecast data
  const daysUntilBloom = daysFromTodayJst(city.bloom.forecast);
  if (daysUntilBloom !== null) {
    if (daysUntilBloom > 14) return "Not yet — more than 2 weeks away";
    if (daysUntilBloom > 7) return "Coming soon — 1-2 weeks away";
    if (daysUntilBloom > 0) return `Coming soon — about ${daysUntilBloom} day(s)`;
    return "Should be blooming (no observation yet)";
  }

  return "No forecast available";
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export function formatDate(iso: string | null): string {
  return formatMonthDayJst(iso);
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
        ? parseDateInputJst(city.fullBloom.observation)
        : city.fullBloom.forecast
          ? parseDateInputJst(city.fullBloom.forecast)
          : null;

      if (!fullBloomDate) continue;

      // Best viewing: 2 days before full bloom to 5 days after
      const windowStart = new Date(fullBloomDate.getTime() - 2 * DAY_MS);
      const windowEnd = new Date(fullBloomDate.getTime() + 5 * DAY_MS);

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
        ...tokyoDatumToWGS84(s.lat ?? 0, s.lon ?? 0),
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
