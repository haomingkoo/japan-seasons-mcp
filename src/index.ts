#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "http";
import { gzipSync } from "zlib";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";
import { VERSION as SERVER_VERSION } from "./lib/version.js";
import { getApiCacheStatus, handleApiRequest, warmSpotsCache } from "./api.js";
import { onDailyFlush } from "./lib/cache.js";
import {
  getSakuraForecast,
  getSakuraSpots,
  getKawazuForecast,
  findCities,
  findBestRegions,
  findPrefCode,
  getAvailablePrefectures,
  formatDate,
  SAKURA_BLOOM_RATE_SCALE_LINE,
  SAKURA_FULL_BLOOM_RATE_SCALE_LINE,
  SAKURA_FULL_BLOOM_MANKAI_MIN,
  SAKURA_SPOT_MODEL_NOTE,
  type SakuraCity,
  type SakuraSpot,
} from "./lib/sakura-forecast.js";
import { getKoyoForecast, getKoyoSpots, formatDate as formatKoyoDate } from "./lib/koyo.js";
import { getWeatherForecast } from "./lib/weather.js";
import { WEATHER_CITY_IDS } from "./lib/areas.js";
import { FLOWER_SEASON_MONTHS, FLOWER_META, FESTIVAL_TYPE_META, MO, FRUITS } from "./lib/constants.js";
import {
  MCP_ENDPOINT,
  SAKURA_FORECAST_API_URL,
  SAKURA_FORECAST_TEXT_URL,
  SITE_CONFIG,
  SITE_PUBLIC_CONFIG,
  SITE_URL,
} from "./lib/site-config.js";
import {
  DATE_RANGE_INPUT_HINT,
  DAY_MS,
  currentJstMonth,
  currentJstYear,
  daysFromTodayJst,
  formatIsoDateJst,
  isoYearInJst,
  monthFromDateInputJst,
  parseDateInputJst,
  parseDateRangeInputJst,
  todayJstIsoDate,
} from "./lib/dates.js";

// ─── Shared types ────────────────────────────────────────────────────────────
type AnySpot = Record<string, unknown>;
type DateStyle = "friendly" | "iso";
type TemperatureUnit = "celsius" | "fahrenheit";
type MapLanguage = "english" | "japanese";

interface OutputConfig {
  dateStyle: DateStyle;
  temperatureUnit: TemperatureUnit;
  includeCoordinates: boolean;
  mapLanguage: MapLanguage;
}

// ─── Static JSON: load once at startup, reused across all MCP tool calls ─────
// Resolves relative to the package root (dist/../public) so it works correctly
// whether the server is run via npx, node dist/index.js, or from any CWD.
const __publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
function loadStaticJSON(filename: string) {
  const p = join(__publicDir, filename);
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}
const STATIC_MCP = {
  flowers:   loadStaticJSON("flowers.json"),
  festivals: loadStaticJSON("festivals.json"),
  farms:     loadStaticJSON("fruit-farms.json"),
};

function staticSpotCount(data: AnySpot | null): number | null {
  if (!data) return null;
  if (typeof data.total === "number") return data.total;
  return Array.isArray(data.spots) ? data.spots.length : null;
}

const FRUIT_FARM_COUNT = staticSpotCount(STATIC_MCP.farms);
const FRUIT_FARM_LABEL = FRUIT_FARM_COUNT === null ? "fruit-picking farms" : `${FRUIT_FARM_COUNT} fruit-picking farms`;

// All tools are read-only (no side effects) and idempotent (same input = same output)
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
const READONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true };
const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  dateStyle: "friendly",
  temperatureUnit: "celsius",
  includeCoordinates: true,
  mapLanguage: "english",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseEnum<T extends string>(value: string | undefined | null, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function parseBoolean(value: string | undefined | null): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function formatIsoDate(iso: string | null): string {
  return formatIsoDateJst(iso);
}

function formatSakuraDate(iso: string | null, outputConfig: OutputConfig): string {
  return outputConfig.dateStyle === "iso" ? formatIsoDate(iso) : formatDate(iso);
}

function formatKoyoOutputDate(iso: string | null, outputConfig: OutputConfig): string {
  return outputConfig.dateStyle === "iso" ? formatIsoDate(iso) : formatKoyoDate(iso);
}

function mapsUrl(lat: unknown, lon: unknown): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function coordinateLine(lat: unknown, lon: unknown, outputConfig: OutputConfig): string {
  return outputConfig.includeCoordinates ? `- 📍 ${lat}, ${lon} · ${mapsUrl(lat, lon)}\n` : "";
}

function gpsLine(lat: unknown, lon: unknown, outputConfig: OutputConfig): string {
  return outputConfig.includeCoordinates ? `- **GPS:** ${lat}, ${lon} · ${mapsUrl(lat, lon)}\n` : "";
}

// Returns how many days ago full bloom was forecast/observed, or null if not yet reached.
// Used to detect post-peak / hazakura (green leaves) state, since JMC jr_data stays
// frozen at full_rate=100 after peak and stops publishing observation data.
function daysSinceFullBloom(fullBloomIso: string | null): number | null {
  const delta = daysFromTodayJst(fullBloomIso);
  return delta !== null && delta < 0 ? Math.abs(delta) : null;
}

function postPeakNote(fullBloomIso: string | null): string | null {
  const days = daysSinceFullBloom(fullBloomIso);
  if (days === null) return null;
  if (days <= 5) return null;  // still within typical peak window
  if (days <= 10) return `Petals likely falling (full bloom ~${days} days ago)`;
  if (days <= 20) return `Past peak — transitioning to hazakura/green leaves (~${days} days since full bloom)`;
  return `Bloom season likely over — hazakura/green leaves (~${days} days since full bloom)`;
}

function preferredMapUrl(englishUrl: string | null | undefined, japaneseUrl: string | null | undefined, outputConfig: OutputConfig): string {
  if (outputConfig.mapLanguage === "japanese") return japaneseUrl || englishUrl || "N/A";
  return englishUrl || japaneseUrl || "N/A";
}

function resolveOutputConfig(values: {
  dateStyle?: string | null;
  temperatureUnit?: string | null;
  includeCoordinates?: string | null;
  mapLanguage?: string | null;
}): OutputConfig {
  return {
    dateStyle: parseEnum(values.dateStyle, ["friendly", "iso"]) ?? DEFAULT_OUTPUT_CONFIG.dateStyle,
    temperatureUnit: parseEnum(values.temperatureUnit, ["celsius", "fahrenheit"]) ?? DEFAULT_OUTPUT_CONFIG.temperatureUnit,
    includeCoordinates: parseBoolean(values.includeCoordinates) ?? DEFAULT_OUTPUT_CONFIG.includeCoordinates,
    mapLanguage: parseEnum(values.mapLanguage, ["english", "japanese"]) ?? DEFAULT_OUTPUT_CONFIG.mapLanguage,
  };
}

function getOutputConfig(
  searchParams: URLSearchParams,
  headers: Record<string, string | string[] | undefined> = {},
): OutputConfig {
  return resolveOutputConfig({
    dateStyle: searchParams.get("dateStyle") ?? firstValue(headers["x-date-style"]),
    temperatureUnit: searchParams.get("temperatureUnit") ?? firstValue(headers["x-temperature-unit"]),
    includeCoordinates: searchParams.get("includeCoordinates") ?? firstValue(headers["x-include-coordinates"]),
    mapLanguage: searchParams.get("mapLanguage") ?? firstValue(headers["x-map-language"]),
  });
}

function getOutputConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OutputConfig {
  return resolveOutputConfig({
    dateStyle: env.JAPAN_SEASONS_DATE_STYLE,
    temperatureUnit: env.JAPAN_SEASONS_TEMPERATURE_UNIT,
    includeCoordinates: env.JAPAN_SEASONS_INCLUDE_COORDINATES,
    mapLanguage: env.JAPAN_SEASONS_MAP_LANGUAGE,
  });
}

// ─── Pre-load static frontend files into memory at startup ──────────────────
// Avoids per-request disk I/O and server-side gzip (Railway proxy handles compression).
const STATIC_FILE_MAP: Record<string, { file: string; mime: string }> = {
  "/":              { file: "index.html",                    mime: "text/html; charset=utf-8" },
  "/app.css":       { file: "app.css",                       mime: "text/css; charset=utf-8" },
  "/app.js":        { file: "app.js",                        mime: "application/javascript; charset=utf-8" },
  "/robots.txt":    { file: "robots.txt",                    mime: "text/plain; charset=utf-8" },
  "/llms.txt":      { file: "llms.txt",                      mime: "text/plain; charset=utf-8" },
  "/og-image.png":  { file: "og-image.png",                  mime: "image/png" },
  "/status":        { file: "status.html",                   mime: "text/html; charset=utf-8" },
  "/status/":       { file: "status.html",                   mime: "text/html; charset=utf-8" },
  "/cherry-blossom-forecast":  { file: "cherry-blossom-forecast.html",  mime: "text/html; charset=utf-8" },
  "/cherry-blossom-forecast/": { file: "cherry-blossom-forecast.html",  mime: "text/html; charset=utf-8" },
  "/autumn-leaves-forecast":   { file: "autumn-leaves-forecast.html",   mime: "text/html; charset=utf-8" },
  "/autumn-leaves-forecast/":  { file: "autumn-leaves-forecast.html",   mime: "text/html; charset=utf-8" },
  "/japan-seasonal-travel-mcp":  { file: "japan-seasonal-travel-mcp.html", mime: "text/html; charset=utf-8" },
  "/japan-seasonal-travel-mcp/": { file: "japan-seasonal-travel-mcp.html", mime: "text/html; charset=utf-8" },
  "/googlec3efc6b89b4ed154.html": { file: "googlec3efc6b89b4ed154.html", mime: "text/html; charset=utf-8" },
};
const STATIC_FILES: Record<string, { body: Buffer; mime: string }> = {};
{
  const __staticDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  for (const [route, entry] of Object.entries(STATIC_FILE_MAP)) {
    try {
      STATIC_FILES[route] = { body: readFileSync(join(__staticDir, entry.file)), mime: entry.mime };
    } catch {
      logger.warn(`Static file not found: ${entry.file}`);
    }
  }
}

const SITE_TEMPLATE_REPLACEMENTS: Record<string, string> = {
  "{{SITE_URL}}": SITE_URL,
  "{{MCP_ENDPOINT}}": MCP_ENDPOINT,
  "{{SAKURA_FORECAST_TEXT_URL}}": SAKURA_FORECAST_TEXT_URL,
  "{{SAKURA_FORECAST_API_URL}}": SAKURA_FORECAST_API_URL,
  "{{KOYO_FORECAST_API_URL}}": `${SITE_URL}${SITE_CONFIG.koyoForecastApiPath}`,
  "{{CONNECTOR_NAME}}": SITE_CONFIG.connector.name,
  "{{CONNECTOR_DESCRIPTION}}": SITE_CONFIG.connector.description,
};

function renderSiteTemplate(body: Buffer, mime: string): Buffer | string {
  if (!mime.startsWith("text/html") && !mime.startsWith("text/plain")) return body;
  let text = body.toString("utf-8");
  for (const [token, value] of Object.entries(SITE_TEMPLATE_REPLACEMENTS)) {
    text = text.split(token).join(value);
  }
  return text;
}

// ─── Sitemap ────────────────────────────────────────────────────────────────
// Expand here when per-season or per-prefecture landing pages ship.
function SITEMAP_XML(): string {
  const today = todayJstIsoDate();
  const urls = [
    { loc: `${SITE_URL}/`, priority: "1.0" },
    { loc: `${SITE_URL}/cherry-blossom-forecast`, priority: "0.95" },
    { loc: SAKURA_FORECAST_TEXT_URL, priority: "0.9" },
    { loc: `${SITE_URL}/autumn-leaves-forecast`, priority: "0.95" },
    { loc: `${SITE_URL}/japan-seasonal-travel-mcp`, priority: "0.9" },
    { loc: `${SITE_URL}/status`, priority: "0.4" },
    { loc: `${SITE_URL}/llms.txt`, priority: "0.5" },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

const SERVER_INSTRUCTIONS = `You are connected to Japan in Seasons, a read-only MCP server for live Japan seasonal travel data.

Use this server when the user needs current timing or locations for cherry blossom, autumn leaves, flowers, festivals, fruit picking, or short-range weather in Japan. This server is especially relevant for broad prompts such as "how is the sakura forecast?", "where should I see cherry blossoms this week?", "how are autumn leaves looking?", "what is blooming in Japan now?", and "what seasonal activities should I plan around?". Do not use it for generic travel planning, hotels, flights, trains, visas, or restaurant recommendations.

Tool routing:
- Use japan_seasonal_answer first for broad Japan seasonal-travel questions, ambiguous "what is good now?" prompts, trip-date prompts, or when the user asks for an answer rather than raw data.
- Use sakura_now first for broad or current cherry blossom prompts such as "how is the sakura forecast?", "is sakura blooming now?", or "where should I view sakura today?". It returns city timing plus a short list of specific viewing spots when current spot data is available.
- Use sakura_forecast for big-picture sakura timing, bloom progress, and city comparisons.
- Use sakura_best_dates when the user gives travel dates and wants the best sakura cities in that window, then use sakura_spots for exact parks and temples.
- Use kawazu_forecast for January-February cherry blossom requests or when the user mentions Kawazu-zakura, early blossoms, or Izu.
- Use koyo_now first for broad or current autumn leaves prompts such as "how are autumn leaves looking?" or "where is koyo good now?".
- Use koyo_forecast for autumn leaves timing by city, and koyo_best_dates when travel dates are provided. Follow with koyo_spots for exact viewing locations.
- Use flowers_spots for non-sakura seasonal flowers such as plum, wisteria, hydrangea, lavender, sunflower, and cosmos.
- Use festivals_list for recurring fireworks, matsuri, and winter events with official links.
- Use fruit_seasons to answer which fruits are in season, and fruit_farms only when the user needs actual farms, GPS coordinates, or booking links.
- Use weather_forecast after bloom tools when rain or temperature could change the recommendation, especially because rain can shorten sakura viewing.
- Use search and fetch only for ChatGPT/deep-research style retrieval over the Japan in Seasons dataset and documentation.

Important rules:
- Sakura and koyo timing changes every year; prefer these tools over generic knowledge.
- Sakura spot percentages use the official JMC bloom and full-bloom scales. A ${SAKURA_FULL_BLOOM_MANKAI_MIN}-100% full-bloom rate means mankai.
- Best sakura viewing is usually around full bloom. Best koyo viewing is usually around each spot's peak window.
- All tools are read-only and require no authentication.`;

const SAKURA_LOCATION_EXAMPLES = SITE_CONFIG.locationExamples.sakura;
const KOYO_LOCATION_EXAMPLES = SITE_CONFIG.locationExamples.koyo;
const SAKURA_TYPICAL_TIMING = SITE_CONFIG.seasonalTiming.sakura;
const KOYO_TYPICAL_TIMING_GUIDE = SITE_CONFIG.seasonalTiming.koyoGuide;
const KOYO_TYPICAL_TIMING_SHORT = SITE_CONFIG.seasonalTiming.koyoShort;
const KOYO_EXACT_SPOTS_NEXT_STEP = SITE_CONFIG.toolGuidance.koyoExactSpotsNextStep;
const KOYO_VIEWING_WINDOW_BEFORE_PEAK_DAYS = SITE_CONFIG.koyo.viewingWindowBeforePeakDays;
const KOYO_VIEWING_WINDOW_AFTER_PEAK_DAYS = SITE_CONFIG.koyo.viewingWindowAfterPeakDays;
const KOYO_FILTER_ALIASES: Record<string, readonly string[]> = SITE_CONFIG.koyo.filterAliases;
const TOP_KOYO_PREFS = SITE_CONFIG.koyo.topPrefectures;

function priorSeasonKoyoNote(lastUpdated: string | null | undefined): string | null {
  const dataYear = isoYearInJst(lastUpdated);
  const thisYear = currentJstYear();
  if (!dataYear || dataYear >= thisYear) return null;
  const month = currentJstMonth();
  if (month < 9) {
    return `The latest JMC koyo feed available here is from ${dataYear}. The ${thisYear} autumn leaves forecast is usually published closer to autumn, so treat current koyo output as prior-season reference plus typical timing guidance until the new JMC forecast appears.`;
  }
  return `Warning: the latest JMC koyo feed available here is from ${dataYear}, not ${thisYear}. Treat these autumn leaves dates as prior-season reference until the upstream JMC feed publishes the current season.`;
}

function priorSeasonKoyoSpotNote(spots: Array<{ bestPeak?: string | null }>): string | null {
  const peakYear = isoYearInJst(spots.find((spot) => spot.bestPeak)?.bestPeak ?? null);
  const thisYear = currentJstYear();
  if (!peakYear || peakYear >= thisYear) return null;
  return `These koyo spot peak windows are from the ${peakYear} JMC dataset. Treat them as prior-season reference until the ${thisYear} JMC spot forecast is published.`;
}

function daysLabel(delta: number | null): string {
  if (delta === null) return "date unavailable";
  if (delta === 0) return "today";
  if (delta > 0) return `in ${delta} day${delta === 1 ? "" : "s"}`;
  return `${Math.abs(delta)} day${delta === -1 ? "" : "s"} ago`;
}

function cityFullBloomIso(city: SakuraCity): string | null {
  return city.fullBloom.observation ?? city.fullBloom.forecast ?? null;
}

function cityBloomIso(city: SakuraCity): string | null {
  return city.bloom.observation ?? city.bloom.forecast ?? null;
}

function sortByClosestDate<T extends { delta: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.delta === null && b.delta === null) return 0;
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return Math.abs(a.delta) - Math.abs(b.delta);
  });
}

function formatSakuraCityLine(city: SakuraCity, outputConfig: OutputConfig): string {
  const bloom = cityBloomIso(city);
  const full = cityFullBloomIso(city);
  const fullDelta = daysFromTodayJst(full);
  const bloomLabel = city.bloom.observation ? "actual" : "forecast";
  const fullLabel = city.fullBloom.observation ? "actual" : "forecast";
  return `- **${city.cityName} (${city.prefName})** — ${city.status}; bloom ${formatSakuraDate(bloom, outputConfig)} ${bloomLabel}, full bloom ${formatSakuraDate(full, outputConfig)} ${fullLabel} (${daysLabel(fullDelta)})`;
}

const SAKURA_SPOT_PHASE_SCORE: Record<SakuraSpot["phase"], number> = {
  dormant: 0,
  buds: 10,
  bud_swell: 20,
  bud_open: 35,
  starting: 55,
  blooming: 80,
  peak: 100,
  past_peak: 65,
  falling: 45,
  ended: 0,
};

function sakuraSpotSuggestionScore(spot: SakuraSpot): number {
  const fullDelta = daysFromTodayJst(spot.fullBloomForecast);
  let score = SAKURA_SPOT_PHASE_SCORE[spot.phase] ?? 0;
  if (spot.statusSource === "observation") score += 12;
  if (spot.fullRate >= SAKURA_FULL_BLOOM_MANKAI_MIN) score += 10;
  else score += Math.min(spot.fullRate, SAKURA_FULL_BLOOM_MANKAI_MIN) / 10;
  if (fullDelta !== null) {
    score -= Math.abs(fullDelta) * 2;
    if (fullDelta < -10) score -= 35;
    if (fullDelta > 10) score -= 20;
  }
  return score;
}

function shouldSuggestSakuraSpot(spot: SakuraSpot): boolean {
  const fullDelta = daysFromTodayJst(spot.fullBloomForecast);
  if (spot.phase === "ended" || spot.phase === "dormant") return false;
  if (["peak", "blooming", "past_peak", "falling"].includes(spot.phase)) return true;
  if (fullDelta !== null && fullDelta >= -7 && fullDelta <= 7) return true;
  return spot.bloomRate >= 85 || spot.fullRate > 0;
}

function formatSakuraSpotSuggestionLine(spot: SakuraSpot, outputConfig: OutputConfig): string {
  const romaji = spot.nameRomaji && spot.nameRomaji !== spot.name ? ` (${spot.nameRomaji})` : "";
  const fullDelta = daysFromTodayJst(spot.fullBloomForecast);
  const full = spot.fullBloomForecast ? `; full bloom ${formatSakuraDate(spot.fullBloomForecast, outputConfig)} (${daysLabel(fullDelta)})` : "";
  const map = outputConfig.includeCoordinates ? `; map ${mapsUrl(spot.lat, spot.lon)}` : "";
  return `- **${spot.name}${romaji}** — ${spot.displayStatus}; bloom ${spot.bloomRate}%, full-bloom ${spot.fullRate}%${full}${map}`;
}

async function formatSakuraSpotPreview(
  cities: SakuraCity[],
  outputConfig: OutputConfig,
  heading = "Specific viewing spots",
): Promise<string> {
  const prefCodes = Array.from(new Set(cities.map((city) => city.prefCode).filter(Boolean))).slice(0, 2);
  if (!prefCodes.length) return "";

  const results = await Promise.allSettled(prefCodes.map((prefCode) => getSakuraSpots(prefCode)));
  const candidates = results
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getSakuraSpots>>> => result.status === "fulfilled")
    .flatMap((result) => result.value.spots)
    .filter(shouldSuggestSakuraSpot)
    .sort((a, b) => sakuraSpotSuggestionScore(b) - sakuraSpotSuggestionScore(a))
    .slice(0, 5);

  if (!candidates.length) return "";

  let output = `## ${heading}\n`;
  for (const spot of candidates) output += `${formatSakuraSpotSuggestionLine(spot, outputConfig)}\n`;
  output += `\nUse sakura_spots with the prefecture for the full park and temple list.\n\n`;
  return output;
}

async function formatSakuraNowAnswer(options: {
  city?: string;
  start_date?: string;
  end_date?: string;
  outputConfig: OutputConfig;
}): Promise<string> {
  const forecast = await getSakuraForecast();
  const today = todayJstIsoDate();

  if (options.start_date && options.end_date) {
    const range = parseDateRangeInputJst(options.start_date, options.end_date);
    if (!range) {
      return `Invalid trip dates. ${DATE_RANGE_INPUT_HINT}`;
    }
    const matches = findBestRegions(forecast, range.startDate, range.endDate);
    let output = `# Sakura forecast for ${options.start_date} to ${options.end_date}\n`;
    output += `Source: ${forecast.source}. Checked against ${forecast.totalCities} JMC observation cities. Today in Japan: ${today}.\n\n`;
    if (!matches.length) {
      output += `No standard Somei-Yoshino observation city has a peak viewing window overlapping those dates. For January-February early blossoms, use kawazu_forecast. For exact parks after choosing an area, use sakura_spots.\n`;
      return output;
    }
    output += `## Best city matches\n`;
    for (const city of sortByClosestDate(matches.map((city) => ({ city, delta: daysFromTodayJst(cityFullBloomIso(city)) }))).slice(0, 10)) {
      output += `${formatSakuraCityLine(city.city, options.outputConfig)}\n`;
    }
    output += `\n`;
    output += await formatSakuraSpotPreview(matches.slice(0, 3), options.outputConfig, "Specific viewing spots to check");
    output += `Next step: call sakura_spots for the matched prefecture to get every listed park and temple, then weather_forecast if rain could affect petals.\n`;
    return output;
  }

  let cities = forecast.regions.flatMap((region) => region.cities);
  if (options.city) cities = findCities(forecast, options.city);
  if (!cities.length) {
    return `No sakura forecast city matched "${options.city}". Try a city, prefecture, or region such as ${SAKURA_LOCATION_EXAMPLES.join(", ")}.`;
  }

  const entries = cities.map((city) => ({ city, delta: daysFromTodayJst(cityFullBloomIso(city)) }));
  const bestNow = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta >= -5 && entry.delta <= 2));
  const soon = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta >= 3 && entry.delta <= 14));
  const recentlyPast = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta >= -14 && entry.delta <= -6));
  const later = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta > 14));
  const pastSeason = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta < -14));

  let output = `# Sakura forecast now\n`;
  output += `Source: ${forecast.source}. Today in Japan: ${today}. Coverage: ${cities.length} JMC observation ${cities.length === 1 ? "city" : "cities"}.\n\n`;

  if (bestNow.length) {
    output += `## Best viewing now or very soon\n`;
    for (const entry of bestNow.slice(0, 8)) output += `${formatSakuraCityLine(entry.city, options.outputConfig)}\n`;
    output += `\n`;
  }
  if (soon.length) {
    output += `## Coming next\n`;
    for (const entry of soon.slice(0, 8)) output += `${formatSakuraCityLine(entry.city, options.outputConfig)}\n`;
    output += `\n`;
  }
  if (!bestNow.length && !soon.length && recentlyPast.length) {
    output += `## Recently past peak\n`;
    for (const entry of recentlyPast.slice(0, 8)) output += `${formatSakuraCityLine(entry.city, options.outputConfig)}\n`;
    output += `\n`;
  }
  if (!bestNow.length && !soon.length && !recentlyPast.length && pastSeason.length) {
    output += `## Season likely over for this area\n`;
    for (const entry of pastSeason.slice(0, 8)) output += `${formatSakuraCityLine(entry.city, options.outputConfig)}\n`;
    output += `\n`;
  }
  if (!bestNow.length && !soon.length && !recentlyPast.length && !pastSeason.length && later.length) {
    output += `## Still ahead\n`;
    for (const entry of later.slice(0, 8)) output += `${formatSakuraCityLine(entry.city, options.outputConfig)}\n`;
    output += `\n`;
  }

  if (!bestNow.length && !soon.length && !recentlyPast.length && !pastSeason.length && !later.length) {
    output += `No current full-bloom timing is available for these cities.\n\n`;
  }

  const spotCandidateEntries = bestNow.length ? bestNow
    : soon.length ? soon
      : recentlyPast.length ? recentlyPast
        : [];
  const spotCandidateCities = spotCandidateEntries.slice(0, 3).map((entry) => entry.city);
  output += await formatSakuraSpotPreview(spotCandidateCities, options.outputConfig);

  output += `## How to use this\n`;
  output += `Use sakura_spots for all exact parks and temples in a prefecture. Use weather_forecast for the city if rain could shorten the viewing window. For January-February early blossoms in Izu, use kawazu_forecast.\n`;
  return output;
}

async function buildSakuraForecastMarkdown(outputConfig: OutputConfig = DEFAULT_OUTPUT_CONFIG): Promise<string> {
  const forecast = await getSakuraForecast();
  const today = todayJstIsoDate();
  let output = await formatSakuraNowAnswer({ outputConfig });

  output += `\n\n## All JMC observation cities\n`;
  output += `This section is intentionally crawlable for AI search and web search. It lists the latest bloom and full-bloom dates available from Japan Meteorological Corporation for ${forecast.totalCities} observation cities. Today in Japan: ${today}.\n\n`;
  for (const region of forecast.regions) {
    output += `### ${region.nameEn || region.name}\n`;
    for (const city of region.cities) {
      output += `${formatSakuraCityLine(city, outputConfig)}\n`;
    }
    output += `\n`;
  }

  output += `## AI search and MCP use\n`;
  output += `If an assistant found this page through web search, it can cite this text page or the JSON API for latest sakura dates. Finding the page does not mean the assistant can execute MCP tools.\n\n`;
  output += `To call tools such as sakura_now, sakura_forecast, sakura_best_dates, and sakura_spots, first connect the MCP endpoint in an MCP-capable client or ChatGPT app/connector setup.\n\n`;
  output += `- Crawlable text summary: ${SAKURA_FORECAST_TEXT_URL}\n`;
  output += `- Forecast JSON API: ${SAKURA_FORECAST_API_URL}\n`;
  output += `- Remote MCP endpoint: ${MCP_ENDPOINT}\n`;
  return output;
}

function formatKoyoCityLine(city: { nameEn?: string; name: string; prefNameEn?: string; prefName: string; maple?: any; ginkgo?: any }, outputConfig: OutputConfig): string {
  const name = city.nameEn || city.name;
  const pref = city.prefNameEn || city.prefName;
  const maple = city.maple?.forecast ? `maple ${formatKoyoOutputDate(city.maple.forecast, outputConfig)} (${daysLabel(daysFromTodayJst(city.maple.forecast))})` : null;
  const ginkgo = city.ginkgo?.forecast ? `ginkgo ${formatKoyoOutputDate(city.ginkgo.forecast, outputConfig)} (${daysLabel(daysFromTodayJst(city.ginkgo.forecast))})` : null;
  return `- **${name} (${pref})** — ${[maple, ginkgo].filter(Boolean).join("; ")}`;
}

function koyoFilterTerms(filter: string | undefined | null): string[] {
  if (!filter) return [];
  const q = filter.toLowerCase().trim();
  const terms = [q, ...(KOYO_FILTER_ALIASES[q] ?? [])];
  return Array.from(new Set(terms));
}

function matchesKoyoFilter(
  terms: string[],
  forecastRegion: { name: string },
  city: { name: string; nameEn: string; prefName: string; prefNameEn: string },
): boolean {
  if (!terms.length) return true;
  const haystack = [
    forecastRegion.name,
    city.name,
    city.nameEn,
    city.prefName,
    city.prefNameEn,
  ].map((value) => value.toLowerCase());
  return terms.some((term) => haystack.some((value) => value.includes(term)));
}

function koyoViewingWindowOverlaps(
  city: { maple?: { forecast: string | null } | null; ginkgo?: { forecast: string | null } | null },
  startDate: Date,
  endDate: Date,
): boolean {
  const peakDates = [city.maple?.forecast, city.ginkgo?.forecast]
    .map((date) => parseDateInputJst(date ?? null))
    .filter((date): date is Date => Boolean(date));
  if (!peakDates.length) return false;
  const timestamps = peakDates.map((date) => date.getTime());
  const windowStart = new Date(Math.min(...timestamps) - KOYO_VIEWING_WINDOW_BEFORE_PEAK_DAYS * DAY_MS);
  const windowEnd = new Date(Math.max(...timestamps) + KOYO_VIEWING_WINDOW_AFTER_PEAK_DAYS * DAY_MS);
  return startDate <= windowEnd && endDate >= windowStart;
}

function koyoNoMatchText(startDate: string, endDate: string): string {
  return [
    `No koyo cities in colour during ${startDate} to ${endDate} in the currently available JMC forecast dataset.`,
    "",
    KOYO_TYPICAL_TIMING_SHORT,
    KOYO_EXACT_SPOTS_NEXT_STEP,
  ].join("\n");
}

async function formatKoyoNowAnswer(options: {
  region?: string;
  start_date?: string;
  end_date?: string;
  outputConfig: OutputConfig;
}): Promise<string> {
  const forecast = await getKoyoForecast();
  const today = todayJstIsoDate();
  const regionTerms = koyoFilterTerms(options.region);
  const allCities = forecast.regions.flatMap((forecastRegion) =>
    forecastRegion.cities.filter((city) => matchesKoyoFilter(regionTerms, forecastRegion, city))
  );

  if (!allCities.length) {
    return `No autumn leaves forecast city matched "${options.region}". Try a region, prefecture, or city such as ${KOYO_LOCATION_EXAMPLES.join(", ")}.`;
  }

  if (options.start_date && options.end_date) {
    const range = parseDateRangeInputJst(options.start_date, options.end_date);
    if (!range) {
      return `Invalid trip dates. ${DATE_RANGE_INPUT_HINT}`;
    }
    const matches: typeof allCities = [];
    for (const city of allCities) {
      if (koyoViewingWindowOverlaps(city, range.startDate, range.endDate)) matches.push(city);
    }
    let output = `# Autumn leaves forecast for ${options.start_date} to ${options.end_date}\n`;
    output += `Source: ${forecast.source}. Last updated: ${forecast.lastUpdated}. Today in Japan: ${today}.\n\n`;
    const freshnessNote = priorSeasonKoyoNote(forecast.lastUpdated);
    if (freshnessNote) output += `**Data freshness:** ${freshnessNote}\n\n`;
    if (!matches.length) {
      output += `${koyoNoMatchText(options.start_date, options.end_date)}\n`;
      return output;
    }
    output += `## Best city matches\n`;
    for (const city of matches.slice(0, 12)) output += `${formatKoyoCityLine(city, options.outputConfig)}\n`;
    output += `\nNext step: call koyo_spots for exact temples, parks, and gardens in the matched prefecture.\n`;
    return output;
  }

  const entries = allCities.flatMap((city) => [
    city.maple?.forecast ? { city, delta: daysFromTodayJst(city.maple.forecast) } : null,
    city.ginkgo?.forecast ? { city, delta: daysFromTodayJst(city.ginkgo.forecast) } : null,
  ].filter(Boolean) as { city: (typeof allCities)[number]; delta: number | null }[]);
  const bestNow = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta >= -10 && entry.delta <= 3));
  const soon = sortByClosestDate(entries.filter((entry) => entry.delta !== null && entry.delta >= 4 && entry.delta <= 21));

  let output = `# Autumn leaves forecast now\n`;
  output += `Source: ${forecast.source}. Last updated: ${forecast.lastUpdated}. Today in Japan: ${today}.\n`;
  output += `Maps: maple ${preferredMapUrl(forecast.mapleForecastMapUrlEn, forecast.mapleForecastMapUrl, options.outputConfig)} | ginkgo ${preferredMapUrl(forecast.ginkgoForecastMapUrlEn, forecast.ginkgoForecastMapUrl, options.outputConfig)}\n\n`;
  const freshnessNote = priorSeasonKoyoNote(forecast.lastUpdated);
  if (freshnessNote) output += `**Data freshness:** ${freshnessNote}\n\n`;
  output += `## Typical timing guide\n`;
  output += `${KOYO_TYPICAL_TIMING_GUIDE}\n\n`;
  if (!freshnessNote && forecast.forecastComment) output += `## JMC source commentary\n${forecast.forecastComment}\n\n`;

  if (bestNow.length) {
    output += `## Best color now or very soon\n`;
    const seen = new Set<string>();
    for (const entry of bestNow) {
      const key = `${entry.city.name}-${entry.city.prefName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output += `${formatKoyoCityLine(entry.city, options.outputConfig)}\n`;
      if (seen.size >= 8) break;
    }
    output += `\n`;
  }
  if (soon.length) {
    output += `## Coming next\n`;
    const seen = new Set<string>();
    for (const entry of soon) {
      const key = `${entry.city.name}-${entry.city.prefName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output += `${formatKoyoCityLine(entry.city, options.outputConfig)}\n`;
      if (seen.size >= 8) break;
    }
    output += `\n`;
  }
  if (!bestNow.length && !soon.length && !freshnessNote) {
    output += `Koyo is strongly seasonal. If this is outside Sep-Dec, use this as the forecast dataset/season guide rather than a same-week recommendation. ${KOYO_TYPICAL_TIMING_SHORT}\n\n`;
  }
  output += `Next step: use koyo_spots for exact temples, parks, and gardens in a prefecture.\n`;
  return output;
}

async function formatSeasonalOverviewAnswer(options: {
  month?: number | null;
  location?: string;
  outputConfig: OutputConfig;
}): Promise<string> {
  const month = options.month ?? currentJstMonth();
  const location = options.location?.toLowerCase();
  let output = `# Japan seasonal travel overview — ${MO[month - 1]}\n\n`;

  if (month >= 3 && month <= 5) {
    output += `## Cherry blossoms\n`;
    output += `Standard Somei-Yoshino sakura is a key live-data season from March to May. Use sakura_now for the current national picture, sakura_best_dates for travel dates, and sakura_spots for exact parks and temples.\n\n`;
  } else if (month === 1 || month === 2) {
    output += `## Early cherry blossoms\n`;
    output += `January and February are Kawazu-zakura season around the Izu Peninsula. Use kawazu_forecast for live early-blossom status.\n\n`;
  }

  if (month >= 9 && month <= 12) {
    const koyo = await getKoyoForecast();
    output += `## Autumn leaves\n`;
    const freshnessNote = priorSeasonKoyoNote(koyo.lastUpdated);
    if (freshnessNote) output += `${freshnessNote}\n`;
    output += `Use koyo_now for the current overview, koyo_best_dates for travel dates, and koyo_spots for exact temples, parks, and gardens.\n\n`;
  }

  const flowerData = STATIC_MCP.flowers;
  if (flowerData) {
    const flowers = ((flowerData.spots || []) as AnySpot[]).filter((spot) => {
      const months = FLOWER_SEASON_MONTHS[spot["type"] as string] || [];
      const locationMatch = !location ||
        (spot["prefecture"] as string | undefined)?.toLowerCase().includes(location) ||
        (spot["region"] as string | undefined)?.toLowerCase().includes(location);
      return months.includes(month) && locationMatch;
    });
    if (flowers.length) {
      output += `## Flowers in season\n`;
      for (const spot of flowers.slice(0, 8)) {
        output += `- **${spot["name"]}** (${spot["prefecture"]}) — ${spot["type"]}; peak ${spot["peakStart"] ?? "N/A"} to ${spot["peakEnd"] ?? "N/A"}\n`;
      }
      if (flowers.length > 8) output += `- ${flowers.length - 8} more flower spots available through flowers_spots.\n`;
      output += `\n`;
    }
  }

  const inSeasonFruits = FRUITS.filter((fruit) => fruit.months.includes(month));
  if (inSeasonFruits.length) {
    output += `## Fruit picking\n`;
    for (const fruit of inSeasonFruits.slice(0, 8)) {
      output += `- ${fruit.emoji} **${fruit.name}**${fruit.peak.includes(month) ? " (peak)" : ""} — best regions: ${fruit.regions.join(", ")}\n`;
    }
    output += `Use fruit_farms for actual farms, GPS coordinates, and booking links.\n\n`;
  }

  const festivalData = STATIC_MCP.festivals;
  if (festivalData) {
    const events = ((festivalData.spots || []) as AnySpot[]).filter((event) => {
      const months = event["months"] as number[] | undefined;
      const locationMatch = !location ||
        (event["prefecture"] as string | undefined)?.toLowerCase().includes(location) ||
        (event["region"] as string | undefined)?.toLowerCase().includes(location);
      return months?.includes(month) && locationMatch;
    });
    if (events.length) {
      output += `## Festivals and events\n`;
      for (const event of events.slice(0, 8)) {
        output += `- **${event["name"]}** (${event["prefecture"]}) — ${event["typicalDate"]}; ${event["type"]}\n`;
      }
      output += `Use festivals_list for official URLs, attendance notes, and coordinates.\n\n`;
    }
  }

  if (!/## /.test(output)) {
    output += `No strong curated seasonal category matched this month/location. Try a broader location or ask for sakura, koyo, flowers, festivals, or fruit picking specifically.\n`;
  }
  return output;
}

function inferSeason(question: string | undefined, startDate: string | undefined, requested: string | undefined): string {
  if (requested && requested !== "auto") return requested;
  const q = (question ?? "").toLowerCase();
  if (/(sakura|cherry blossom|hanami|mankai|kawazu)/.test(q)) {
    if (/(kawazu|early blossom|izu|february|january)/.test(q)) return "kawazu";
    return "sakura";
  }
  if (/(autumn|fall foliage|koyo|momiji|maple|ginkgo|leaves|colour|color)/.test(q)) return "koyo";
  if (/(seasonal|what.*good|things to do|activities|in season|blooming now|good now)/.test(q)) return "overview";
  if (/(wisteria|hydrangea|lavender|sunflower|cosmos|plum|flower|blooming now)/.test(q)) return "flowers";
  if (/(festival|matsuri|fireworks|hanabi|event)/.test(q)) return "festivals";
  if (/(fruit|farm|picking|strawberry|grape|peach|apple|mikan)/.test(q)) return "fruit";
  if (/(weather|rain|temperature|packing|umbrella)/.test(q)) return "weather";
  const month = monthFromDateInputJst(startDate) ?? currentJstMonth();
  if (month === 1 || month === 2) return "kawazu";
  if (month >= 3 && month <= 5) return "sakura";
  if (month >= 10 && month <= 12) return "koyo";
  if (month >= 6 && month <= 8) return "festivals";
  return "flowers";
}

const SEARCH_DOCS = [
  {
    id: "sakura-now",
    title: "Current Japan Cherry Blossom Forecast",
    url: `${SITE_URL}/sakura-forecast.txt`,
    keywords: "sakura cherry blossom hanami mankai bloom forecast japan kyoto tokyo osaka hokkaido tohoku jmc",
    summary: "Crawlable live JMC sakura forecast for 48 observation cities, including bloom and full-bloom dates, actual observations, historical averages, and current status.",
  },
  {
    id: "sakura-spots",
    title: "Cherry Blossom Viewing Spots",
    url: `${SITE_URL}/cherry-blossom-forecast#spots`,
    keywords: "sakura spots parks temples gps kyoto tokyo viewing locations current status coordinates",
    summary: "1,012 JMC cherry blossom viewing spots with GPS coordinates, bloom percentages, reporter observations when fresh, and prefecture-level filtering.",
  },
  {
    id: "kawazu",
    title: "Kawazu Early Cherry Blossom Forecast",
    url: `${SITE_URL}/cherry-blossom-forecast#kawazu`,
    keywords: "kawazu early cherry blossom izu february january deep pink",
    summary: "Early-season Kawazu-zakura data for Izu Peninsula in January and February, including bloom percentages, full-bloom percentages, maps, and coordinates.",
  },
  {
    id: "koyo-now",
    title: "Japan Autumn Leaves Forecast",
    url: `${SITE_URL}/autumn-leaves-forecast`,
    keywords: "koyo autumn leaves fall foliage momiji maple ginkgo kyoto nikko hokkaido forecast japan",
    summary: "JMC koyo forecast for maple and ginkgo timing by city, with forecast maps, regional commentary, and 687 viewing spots.",
  },
  {
    id: "flowers",
    title: "Seasonal Flower Spots in Japan",
    url: `${SITE_URL}/#flowers`,
    keywords: "flowers wisteria hydrangea plum lavender sunflower cosmos iris nanohana japan travel",
    summary: "Curated non-sakura flower spots across Japan with peak windows, official URLs, notes, and GPS coordinates.",
  },
  {
    id: "festivals",
    title: "Japan Festivals, Fireworks, and Seasonal Events",
    url: `${SITE_URL}/#festivals`,
    keywords: "festival matsuri fireworks hanabi winter events gion nebuta sumida nagaoka japan",
    summary: "Curated recurring events with typical dates, official URLs, attendance notes, and GPS coordinates.",
  },
  {
    id: "fruit",
    title: "Japan Fruit Picking Seasons and Farms",
    url: `${SITE_URL}/#fruit`,
    keywords: "fruit picking farms strawberry grape peach apple mikan yamanashi nagano japan booking",
    summary: `Fruit season calendar for 14 fruits and ${FRUIT_FARM_LABEL} with GPS coordinates, fruit types, seasons, and booking links.`,
  },
  {
    id: "mcp-install",
    title: "Japan in Seasons MCP Server",
    url: `${SITE_URL}/japan-seasonal-travel-mcp`,
    keywords: "mcp model context protocol chatgpt claude cursor japan travel ai assistant seasonal data",
    summary: "Remote and npm MCP server for live Japan seasonal travel data. AI search can cite public forecast pages, but MCP tools require connecting the endpoint in an MCP-capable client or ChatGPT app/connector first.",
  },
] as const;

function searchDocs(query: string) {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  return SEARCH_DOCS
    .map((doc) => {
      const haystack = `${doc.title} ${doc.keywords} ${doc.summary}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { doc, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ doc }) => doc);
}

async function fetchSearchDoc(id: string, outputConfig: OutputConfig) {
  if (id === "sakura-now") {
    return {
      id,
      title: "Current Japan Cherry Blossom Forecast",
      url: `${SITE_URL}/sakura-forecast.txt`,
      text: await buildSakuraForecastMarkdown(outputConfig),
      metadata: { source: "Japan Meteorological Corporation", type: "live_forecast" },
    };
  }
  if (id === "koyo-now") {
    return {
      id,
      title: "Japan Autumn Leaves Forecast",
      url: `${SITE_URL}/autumn-leaves-forecast`,
      text: await formatKoyoNowAnswer({ outputConfig }),
      metadata: { source: "Japan Meteorological Corporation", type: "live_forecast" },
    };
  }
  const doc = SEARCH_DOCS.find((entry) => entry.id === id);
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    url: doc.url,
    text: `${doc.summary}\n\nUse the Japan in Seasons MCP tools for live answers. Relevant tools include japan_seasonal_answer, sakura_now, sakura_forecast, sakura_spots, koyo_now, koyo_forecast, koyo_spots, flowers_spots, festivals_list, fruit_seasons, fruit_farms, and weather_forecast.`,
    metadata: { source: "Japan in Seasons", type: "dataset_guide" },
  };
}

// ─── Shared tool & prompt registration ───────────────────────────────────────

function registerAllTools(server: McpServer, outputConfig: OutputConfig = DEFAULT_OUTPUT_CONFIG) {
  // ── Prompt: plan_japan_trip ──

  server.registerPrompt(
    "plan_japan_trip",
    {
      title: "Plan Japan Seasonal Trip",
      description: "Guide for planning a seasonal trip to Japan — cherry blossom, autumn leaves, fruit picking, wisteria, hydrangea, and more. Use this when someone wants to visit Japan and see seasonal experiences.",
      argsSchema: { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12' or 'June 20-July 3'").meta({ title: "Travel Dates" }) },
    },
    async ({ travel_dates }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Help me plan a seasonal trip to Japan${travel_dates ? ` for ${travel_dates}` : ""}.

Use the japan-seasons-mcp tools based on the travel month:

## By season

**Jan-Feb** — Kawazu cherry (deep pink, Izu Peninsula):
- kawazu_forecast

**Late Mar – May** — Cherry blossom (sakura):
- sakura_forecast → big picture, 48 cities
- sakura_best_dates → match travel dates to bloom cities
- sakura_spots → 1,012 specific parks/temples with bloom % and GPS
- flowers_spots (type=wisteria) → wisteria season starts late Apr

**Apr-May** — Wisteria (fuji):
- flowers_spots with type=wisteria → 13 curated spots (Ashikaga, Kawachi, Kameido Tenjin, Byodoin, Kasuga Taisha...)

**Jun-Jul** — Hydrangea (ajisai):
- flowers_spots with type=hydrangea → 15 curated spots (Kamakura temples, Kyoto temples, Yatadera...)

**Jul-Aug** — Fireworks & summer matsuri:
- festivals_list with type=fireworks → Sumida River, Nagaoka, Omagari, PL Osaka, Miyajima... (official URLs included)
- festivals_list with type=matsuri → Gion Matsuri, Tenjin Matsuri, Nebuta, Awa Odori...

**May, Sep-Nov** — Traditional matsuri:
- festivals_list → Sanja, Aoi, Hakata Dontaku (May), Kishiwada Danjiri (Sep), Jidai, Kurama Fire, Takayama (Oct-Nov)

**Jan-Feb** — Winter events:
- festivals_list with type=winter → Sapporo Snow Festival, Yokote Kamakura, Shirakawa-go illumination...

**Year-round** — Fruit picking:
- fruit_seasons → which fruits are in season for the travel month
- fruit_farms → ${FRUIT_FARM_LABEL} with GPS; pass month= to auto-filter by in-season fruits

**Oct-Dec** — Autumn leaves (koyo):
- koyo_forecast → maple & ginkgo timing, 50+ cities
- koyo_best_dates → match travel dates to colour cities (same as sakura_best_dates but for koyo)
- koyo_spots → 687 viewing spots with peak windows

## Bloom scale (sakura, official JMC/JMA presentation)
- ${SAKURA_BLOOM_RATE_SCALE_LINE}
- ${SAKURA_FULL_BLOOM_RATE_SCALE_LINE}

## Key facts
- Somei-Yoshino (standard cherry) blooms Mar-May, moving north Okinawa → Hokkaido
- Kawazu-zakura (deep pink) blooms Jan-Feb in Izu Peninsula
- Sakura lasts 7-10 days; rain accelerates petal fall — check weather_forecast
- Wisteria is admission-required at top spots (Ashikaga, Kawachi) — book ahead
- Hydrangea peaks June in Kamakura; visit weekdays or early morning to avoid crowds`,
        },
      }],
    })
  );

  // Keep old prompt name as alias for backwards compatibility
  server.registerPrompt(
    "plan_sakura_trip",
    {
      title: "Plan Cherry Blossom Trip",
      description: "Guide for planning a cherry blossom viewing trip to Japan. Use plan_japan_trip for full seasonal coverage.",
      argsSchema: { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12'").meta({ title: "Travel Dates" }) },
    },
    async ({ travel_dates }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Help me plan a cherry blossom trip to Japan${travel_dates ? ` for ${travel_dates}` : ""}. Use sakura_forecast, sakura_best_dates, sakura_spots, and kawazu_forecast. Also see plan_japan_trip for full year-round seasonal coverage.`,
        },
      }],
    })
  );

  // ── Resources: static datasets ──
  // Registering resources enables the MCP resources capability (resources/list + resources/read).

  if (STATIC_MCP.flowers) {
    server.registerResource(
      "flowers",
      "japan-seasons://flowers",
      {
        title: "Seasonal Flower Spots",
        description: "Complete list of curated seasonal flower viewing spots in Japan — wisteria, hydrangea, plum, lavender, sunflower, cosmos, and more. Static dataset with spot names, GPS coordinates, best visiting months, and map URLs.",
        mimeType: "application/json",
      },
      async (_uri) => ({
        contents: [{
          uri: "japan-seasons://flowers",
          mimeType: "application/json",
          text: JSON.stringify(STATIC_MCP.flowers, null, 2),
        }],
      })
    );
  }

  if (STATIC_MCP.festivals) {
    server.registerResource(
      "festivals",
      "japan-seasons://festivals",
      {
        title: "Festivals & Events",
        description: "Complete list of recurring Japan festivals and events — fireworks (hanabi), matsuri, and winter events. Includes official event URLs, dates, and location data.",
        mimeType: "application/json",
      },
      async (_uri) => ({
        contents: [{
          uri: "japan-seasons://festivals",
          mimeType: "application/json",
          text: JSON.stringify(STATIC_MCP.festivals, null, 2),
        }],
      })
    );
  }

  if (STATIC_MCP.farms) {
    server.registerResource(
      "fruit-farms",
      "japan-seasons://fruit-farms",
      {
        title: "Fruit Picking Farms",
        description: `Complete list of ${FRUIT_FARM_LABEL} across Japan with GPS coordinates, available fruits, seasons, booking links, and access directions.`,
        mimeType: "application/json",
      },
      async (_uri) => ({
        contents: [{
          uri: "japan-seasons://fruit-farms",
          mimeType: "application/json",
          text: JSON.stringify(STATIC_MCP.farms, null, 2),
        }],
      })
    );
  }

  // ── Tool: sakura_forecast ──

  server.registerTool(
    "japan_seasonal_answer",
    {
      title: "Answer Japan Seasonal Travel Question",
      description: "Use this first when the user asks a broad Japan seasonal travel question, including cherry blossom forecasts, autumn leaves, flowers, festivals, fruit picking, or what is good during travel dates. This is the best entry point for natural traveler prompts because it routes to the right live dataset and returns a ready-to-use recommendation. Do not use this for hotels, flights, trains, visas, restaurants, or generic itinerary planning unrelated to seasonal timing.",
      inputSchema: {
        question: z.string().optional().describe("The user's natural-language question, for example 'How is the sakura forecast?', 'Where should I see autumn leaves in late November?', or 'What seasonal things are good in Japan in June?'").meta({ title: "Question" }),
        start_date: z.string().optional().describe("Optional trip start date in YYYY-MM-DD format. Provide this when the user gives travel dates.").meta({ title: "Trip Start Date" }),
        end_date: z.string().optional().describe("Optional trip end date in YYYY-MM-DD format. Provide this when the user gives travel dates.").meta({ title: "Trip End Date" }),
        location: z.string().optional().describe(`Optional city, prefecture, or region such as ${SAKURA_LOCATION_EXAMPLES.join(", ")}.`).meta({ title: "Location" }),
        season: z.enum(["auto", "overview", "sakura", "kawazu", "koyo", "flowers", "festivals", "fruit", "weather"]).optional().describe("Optional explicit season/topic. Use auto unless the user clearly asks for one topic. Use overview for broad questions about what seasonal activities are good in a month.").meta({ title: "Season Topic" }),
      },
      annotations: READONLY,
    },
    async ({ question, start_date, end_date, location, season = "auto" }) => {
      try {
        const inferred = inferSeason(question, start_date, season);
        if (inferred === "sakura") {
          return { content: [{ type: "text", text: await formatSakuraNowAnswer({ city: location, start_date, end_date, outputConfig }) }] };
        }
        if (inferred === "kawazu") {
          const result = await getKawazuForecast();
          let output = `# Kawazu early cherry blossom forecast\nSource: ${result.source}. Last updated: ${result.lastUpdated}.\n\n`;
          output += `Kawazu-zakura is the early deep-pink cherry blossom season for January-February, centered on the Izu Peninsula.\n\n`;
          if (result.forecastComment) output += `## JMC summary\n${result.forecastComment}\n\n`;
          output += `## Best current spots\n`;
          for (const spot of result.spots.slice(0, 8)) {
            output += `- **${spot.name}** — ${spot.status}; bloom ${spot.bloomRate}%, full-bloom ${spot.fullRate}%; full bloom ${formatSakuraDate(spot.fullBloomForecast, outputConfig)}\n`;
          }
          output += `\nMap: ${preferredMapUrl(result.forecastMapUrlEn, result.forecastMapUrl, outputConfig)}\n`;
          return { content: [{ type: "text", text: output }] };
        }
        if (inferred === "koyo") {
          return { content: [{ type: "text", text: await formatKoyoNowAnswer({ region: location, start_date, end_date, outputConfig }) }] };
        }
        if (inferred === "flowers") {
          const month = monthFromDateInputJst(start_date) ?? currentJstMonth();
          const data = STATIC_MCP.flowers;
          if (!data) return { content: [{ type: "text", text: "Flowers data not available on this instance." }], isError: true };
          let spots: AnySpot[] = data.spots || [];
          spots = spots.filter((spot) => {
            const months = FLOWER_SEASON_MONTHS[spot["type"] as string] || [];
            const locationMatch = !location || (spot["prefecture"] as string | undefined)?.toLowerCase().includes(location.toLowerCase()) || (spot["region"] as string | undefined)?.toLowerCase().includes(location.toLowerCase());
            return months.includes(month) && locationMatch;
          });
          let output = `# Seasonal flowers in Japan — ${MO[month - 1]}\nSource: seasons.kooexperience.com curated dataset. ${spots.length} matching spots.\n\n`;
          if (!spots.length) output += `No curated flower spots matched that month/location. Try a broader location or use flowers_spots for all flower categories.\n`;
          for (const spot of spots.slice(0, 10)) {
            output += `- **${spot["name"]}** (${spot["prefecture"]}) — ${spot["type"]}; peak ${spot["peakStart"] ?? "N/A"} to ${spot["peakEnd"] ?? "N/A"}; ${spot["url"] ?? ""}\n`;
          }
          return { content: [{ type: "text", text: output }] };
        }
        if (inferred === "festivals") {
          const month = monthFromDateInputJst(start_date) ?? currentJstMonth();
          const data = STATIC_MCP.festivals;
          if (!data) return { content: [{ type: "text", text: "Festivals data not available on this instance." }], isError: true };
          let events: AnySpot[] = data.spots || [];
          events = events.filter((event) => {
            const months = event["months"] as number[] | undefined;
            const locationMatch = !location || (event["prefecture"] as string | undefined)?.toLowerCase().includes(location.toLowerCase()) || (event["region"] as string | undefined)?.toLowerCase().includes(location.toLowerCase());
            return months?.includes(month) && locationMatch;
          });
          let output = `# Japan seasonal events — ${MO[month - 1]}\nSource: seasons.kooexperience.com curated dataset. ${events.length} matching events.\n\n`;
          if (!events.length) output += `No curated festivals matched that month/location. Major seasons: fireworks July-August, autumn matsuri September-November, winter events January-February.\n`;
          for (const event of events.slice(0, 10)) {
            output += `- **${event["name"]}** (${event["prefecture"]}) — ${event["typicalDate"]}; ${event["type"]}; ${event["url"] ?? ""}\n`;
          }
          return { content: [{ type: "text", text: output }] };
        }
        if (inferred === "fruit") {
          const month = monthFromDateInputJst(start_date) ?? currentJstMonth();
          const inSeason = FRUITS.filter((fruit) => fruit.months.includes(month));
          let output = `# Japan fruit picking — ${MO[month - 1]}\n\n`;
          if (!inSeason.length) output += `No major fruit-picking category is in peak season in this calendar month.\n`;
          for (const fruit of inSeason) {
            output += `- ${fruit.emoji} **${fruit.name}**${fruit.peak.includes(month) ? " (peak)" : ""} — best regions: ${fruit.regions.join(", ")}. ${fruit.note}\n`;
          }
          output += `\nUse fruit_farms for actual farm listings, GPS coordinates, and booking links.\n`;
          return { content: [{ type: "text", text: output }] };
        }
        if (inferred === "weather") {
          if (!location) {
            return { content: [{ type: "text", text: "For weather, provide a supported city such as Tokyo, Kyoto, Osaka, Sapporo, Sendai, or Fukuoka." }] };
          }
          const forecast = await getWeatherForecast(location);
          let output = `# ${forecast.title}\nPublished: ${forecast.publicTime}\n\n`;
          if (forecast.description) output += `${forecast.description}\n\n`;
          for (const day of forecast.forecasts.slice(0, 3)) {
            output += `- **${day.dateLabel} (${day.date})** — ${day.telop}; rain ${day.chanceOfRain.T00_06} | ${day.chanceOfRain.T06_12} | ${day.chanceOfRain.T12_18} | ${day.chanceOfRain.T18_24}\n`;
          }
          return { content: [{ type: "text", text: output }] };
        }
        if (inferred === "overview") {
          return { content: [{ type: "text", text: await formatSeasonalOverviewAnswer({ month: monthFromDateInputJst(start_date), location, outputConfig }) }] };
        }
        return { content: [{ type: "text", text: await formatSakuraNowAnswer({ city: location, start_date, end_date, outputConfig }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "sakura_now",
    {
      title: "Sakura Forecast Now",
      description: "Use this first for broad cherry blossom prompts such as 'How is the sakura forecast?', 'Is sakura blooming now?', 'Where should I view sakura today?', 'Where should I see cherry blossoms this week?', or 'How is Kyoto sakura looking?'. Returns a concise current answer from live Japan Meteorological Corporation forecast and observation data, including specific viewing spot suggestions when current spot data is available, plus next-step guidance for the full park list and weather. Do not use this for autumn leaves, non-sakura flowers, hotels, trains, or generic itinerary planning.",
      inputSchema: {
        city: z.string().optional().describe(`Optional city, prefecture, or region filter such as ${SAKURA_LOCATION_EXAMPLES.join(", ")}. Omit for nationwide status.`).meta({ title: "City or Region" }),
        start_date: z.string().optional().describe("Optional trip start date in YYYY-MM-DD format. Use with end_date when the user gives travel dates.").meta({ title: "Trip Start Date" }),
        end_date: z.string().optional().describe("Optional trip end date in YYYY-MM-DD format. Use with start_date when the user gives travel dates.").meta({ title: "Trip End Date" }),
      },
      annotations: READONLY,
    },
    async ({ city, start_date, end_date }) => {
      try {
        return { content: [{ type: "text", text: await formatSakuraNowAnswer({ city, start_date, end_date, outputConfig }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "koyo_now",
    {
      title: "Autumn Leaves Forecast Now",
      description: "Use this first for broad autumn leaves prompts such as 'How are autumn leaves looking?', 'Where is koyo good now?', 'Kyoto autumn leaves forecast', or 'Where should I see fall foliage in Japan?'. Returns a concise current answer from live Japan Meteorological Corporation maple and ginkgo forecast data. Do not use this for cherry blossoms, fruit picking, hotels, trains, or generic itinerary planning.",
      inputSchema: {
        region: z.string().optional().describe(`Optional city, prefecture, or region filter such as ${KOYO_LOCATION_EXAMPLES.join(", ")}. Omit for nationwide status.`).meta({ title: "Region or Prefecture" }),
        start_date: z.string().optional().describe("Optional trip start date in YYYY-MM-DD format. Use with end_date when the user gives travel dates.").meta({ title: "Trip Start Date" }),
        end_date: z.string().optional().describe("Optional trip end date in YYYY-MM-DD format. Use with start_date when the user gives travel dates.").meta({ title: "Trip End Date" }),
      },
      annotations: READONLY,
    },
    async ({ region, start_date, end_date }) => {
      try {
        return { content: [{ type: "text", text: await formatKoyoNowAnswer({ region, start_date, end_date, outputConfig }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search Japan in Seasons",
      description: "Use this for ChatGPT/deep-research style retrieval over Japan in Seasons. Searches live seasonal-travel dataset guides and returns result IDs for fetch. Use for questions about Japan cherry blossom forecasts, autumn leaves, seasonal flowers, festivals, fruit picking, weather, or the MCP server itself. Do not use for hotels, flights, trains, visas, or restaurants.",
      inputSchema: {
        query: z.string().describe("Natural-language search query, for example 'Japan cherry blossom forecast', 'Kyoto autumn leaves', or 'fruit picking in Japan in September'.").meta({ title: "Query" }),
      },
      annotations: READONLY,
    },
    async ({ query }) => {
      const results = searchDocs(query).slice(0, 8).map((doc) => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        text: doc.summary,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
    }
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch Japan in Seasons Result",
      description: "Use this after search to retrieve a full Japan in Seasons result with citation URL and text. For live sakura or autumn leaves result IDs, this fetches the current forecast answer from live JMC data.",
      inputSchema: {
        id: z.string().describe("Result ID returned by search, such as sakura-now, koyo-now, flowers, festivals, fruit, or mcp-install.").meta({ title: "Result ID" }),
      },
      annotations: READONLY,
    },
    async ({ id }) => {
      try {
        const doc = await fetchSearchDoc(id, outputConfig);
        if (!doc) {
          return { content: [{ type: "text", text: JSON.stringify({ id, title: "Not found", text: `No Japan in Seasons result found for ID "${id}".`, url: SITE_URL }) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(doc) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ id, title: "Error", text: e.message, url: SITE_URL }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sakura_forecast",
    {
      title: "Cherry Blossom Forecast",
      description: "Use this when the user asks about cherry blossom timing, peak bloom, whether sakura has started, or how cities compare across Japan. Returns Japan Meteorological Corporation forecast bloom dates, full-bloom dates, observed dates when available, historical averages, and status for 48 observation cities. Do not use this for specific parks or temples; call sakura_spots next for prefecture-level viewing spots.",
      inputSchema: {
        city: z.string().optional().describe(
          "Optional city, prefecture, or region filter such as 'Tokyo', 'Kyoto', 'Hokkaido', or 'Tohoku'. Partial case-insensitive matches are supported across city, prefecture, and region names. Omit to return all observation cities."
        ).meta({ title: "City or Region Filter" }),
      },
      annotations: READONLY,
    },
    async ({ city }) => {
      try {
        const forecast = await getSakuraForecast();
        if (city) {
          const cities = findCities(forecast, city);
          if (cities.length === 0) {
            return { content: [{ type: "text", text: `No sakura forecast found for "${city}". Try city, prefecture, or region names.` }] };
          }
          return { content: [{ type: "text", text: formatCityResults(cities, outputConfig) }] };
        }
        let output = `# Sakura Forecast ${currentJstYear()}\nSource: ${forecast.source} | ${forecast.totalCities} cities\n`;
        output += `Dates marked ✓ confirmed are official government observations. All other dates are JMC predictions.\n\n`;
        for (const region of forecast.regions) {
          output += `## ${region.nameEn} (${region.name})\n`;
          if (region.comment.length > 0) output += `> ${region.comment[0]}\n\n`;
          output += formatCityResults(region.cities, outputConfig) + "\n";
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: sakura_spots ──

  server.registerTool(
    "sakura_spots",
    {
      title: "Cherry Blossom Viewing Spots",
      description: "Use this when the user already knows the prefecture and needs exact cherry blossom viewing spots with current status and GPS coordinates. Each spot uses JMC reporter observations as the primary status when filed within the last 48 hours (states: pre-bloom through hazakura/green leaves); falls back to the JMC bloom-meter estimate otherwise, with any stale observation shown as secondary context. Also returns the prefecture's JMA reference station summary. Do not use this for nationwide timing comparisons or date matching; use sakura_forecast or sakura_best_dates first.",
      inputSchema: {
        prefecture: z.string().describe("Required prefecture filter. Accepts English prefecture name or numeric prefecture code such as 'Tokyo', 'Kyoto', 'Hokkaido', or '13'. This tool returns one prefecture at a time.").meta({ title: "Prefecture Name or Code" }),
      },
      annotations: READONLY,
    },
    async ({ prefecture }) => {
      try {
        const prefCode = findPrefCode(prefecture);
        if (!prefCode) {
          return { content: [{ type: "text", text: `Prefecture "${prefecture}" not found.\n\n${getAvailablePrefectures().join("\n")}` }], isError: true };
        }
        const result = await getSakuraSpots(prefCode);
        const freshObservationCount = result.spots.filter((spot) => spot.statusSource === "observation").length;
        let output = `# Sakura Spots — ${result.prefecture}\nForecast updated: ${formatSakuraDate(result.lastUpdated, outputConfig)}`;
        if (result.observationUpdated) {
          output += ` | Spot observations updated: ${formatSakuraDate(result.observationUpdated, outputConfig)}`;
        }
        output += ` | ${result.spots.length} spots\n\n`;
        if (result.jmaStation) {
          const jma = result.jmaStation;
          output += `## JMA Station: ${jma.name}\n`;
          output += `_The one official government reference tree for this prefecture. A human observer checks it once per day._\n`;
          output += `- Bloom rate: **${jma.bloomRate}%** | Full-bloom rate: **${jma.fullRate}%**\n`;
          if (jma.bloomObservation) {
            output += `- Bloom: ${formatSakuraDate(jma.bloomObservation, outputConfig)} ✓ confirmed (avg ${jma.bloomNormal ?? "N/A"})\n`;
          } else {
            output += `- Bloom: ${formatSakuraDate(jma.bloomForecast, outputConfig)} (avg ${jma.bloomNormal ?? "N/A"})\n`;
          }
          if (jma.fullObservation) {
            output += `- Full bloom: ${formatSakuraDate(jma.fullObservation, outputConfig)} ✓ confirmed (avg ${jma.fullNormal ?? "N/A"})\n\n`;
          } else {
            output += `- Full bloom: ${formatSakuraDate(jma.fullForecast, outputConfig)} (avg ${jma.fullNormal ?? "N/A"})\n\n`;
          }
        }
        output += `_${SAKURA_SPOT_MODEL_NOTE}_\n`;
        if (result.observationUpdated) {
          output += `_${freshObservationCount}/${result.spots.length} spots currently use fresh spot observations as the main status._\n\n`;
        } else {
          output += `\n`;
        }
        output += `## Viewing spots\n\n`;
        for (const spot of result.spots) {
          output += `### ${spot.name}${spot.nameReading ? ` (${spot.nameReading})` : ""}\n`;
          if (spot.statusSource === "observation") {
            const obsDate = spot.statusUpdated ? ` (observed ${formatSakuraDate(spot.statusUpdated, outputConfig)})` : "";
            output += `- **${spot.displayStatus}**${obsDate}\n`;
            output += `- _Forecast model: ${spot.status} — bloom ${spot.bloomRate}%, full-bloom ${spot.fullRate}%_\n`;
          } else {
            output += `- **${spot.displayStatus}** _(forecast estimate)_\n`;
            if (spot.observationUpdated && !spot.observationFresh && spot.observationStatus) {
              output += `- _Last spot observation: ${spot.observationStatus} (${formatSakuraDate(spot.observationUpdated, outputConfig)}, now stale)_\n`;
            }
            output += `- Bloom rate: **${spot.bloomRate}%** | Full-bloom rate: **${spot.fullRate}%**\n`;
          }
          if (spot.bloomForecast || spot.fullBloomForecast) {
            output += `- Forecast dates: bloom ${formatSakuraDate(spot.bloomForecast, outputConfig)}${spot.fullBloomForecast ? ` → full bloom ${formatSakuraDate(spot.fullBloomForecast, outputConfig)}` : ""}\n`;
          }
          const peakNote = postPeakNote(spot.fullBloomForecast);
          if (peakNote) output += `- _${peakNote}_\n`;
          output += coordinateLine(spot.lat, spot.lon, outputConfig);
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: sakura_best_dates ──

  server.registerTool(
    "sakura_best_dates",
    {
      title: "Best Cherry Blossom Dates for Trip",
      description: "Use this when the user provides travel dates and wants to know where sakura is likely to be best during that trip. Returns cities whose viewing window overlaps the requested date range, based on observed or forecast full-bloom dates. Do not use this for January-February early-bloom Kawazu requests; use kawazu_forecast for those.",
      inputSchema: {
        start_date: z.string().describe("Trip start date in YYYY-MM-DD format, for example '2026-04-08'. The tool compares this against each city's sakura viewing window.").meta({ title: "Trip Start Date" }),
        end_date: z.string().describe("Trip end date in YYYY-MM-DD format, for example '2026-04-14'. Must be on or after start_date.").meta({ title: "Trip End Date" }),
      },
      annotations: READONLY,
    },
    async ({ start_date, end_date }) => {
      try {
        const range = parseDateRangeInputJst(start_date, end_date);
        if (!range) {
          return { content: [{ type: "text", text: `Invalid date format. ${DATE_RANGE_INPUT_HINT}` }], isError: true };
        }
        const forecast = await getSakuraForecast();
        const matches = findBestRegions(forecast, range.startDate, range.endDate);
        if (matches.length === 0) {
          return { content: [{ type: "text", text: `No cities in bloom during ${start_date} to ${end_date}.\n\n${SAKURA_TYPICAL_TIMING}\nTry kawazu_forecast for Jan-Feb early blooms.` }] };
        }
        let output = `# Best cities for sakura: ${start_date} to ${end_date}\n\n${matches.length} cities with bloom in your window. A spot preview is included below; use sakura_spots for the full park and temple list.\n\n`;
        output += formatCityResults(matches, outputConfig);
        output += "\n";
        output += await formatSakuraSpotPreview(matches.slice(0, 3), outputConfig, "Specific viewing spots to check");
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: kawazu_forecast ──

  server.registerTool(
    "kawazu_forecast",
    {
      title: "Kawazu Early Cherry Blossom Forecast",
      description: "Use this for January-February cherry blossom requests or when the user specifically asks about Kawazu-zakura, early blossoms, or the Izu Peninsula. Returns the Japan Meteorological Corporation forecast comment, forecast map links, and Kawazu cherry spots with bloom percentages, full-bloom percentages, forecast dates, and coordinates. Do not use this for standard Somei-Yoshino sakura elsewhere in Japan.",
      inputSchema: {
        include_spots: z.boolean().optional().describe(
          "Whether to include the full list of Kawazu viewing spots. Defaults to true. Set false when the user only needs the overall forecast summary and map."
        ).meta({ title: "Include Spot Listings" }),
        spot_name: z.string().optional().describe(
          "Optional case-insensitive substring filter for a specific Kawazu landmark or area, such as '原木', '駅前', 'iZoo', or '七滝'. Use this when the user asks about one named spot instead of the full list."
        ).meta({ title: "Spot Name Filter" }),
      },
      annotations: READONLY,
    },
    async ({ include_spots = true, spot_name }) => {
      try {
        const result = await getKawazuForecast();
        const filteredSpots = spot_name
          ? result.spots.filter((spot) => spot.name.toLowerCase().includes(spot_name.toLowerCase()))
          : result.spots;

        let output = `# Kawazu Cherry (河津桜) Forecast\nSource: ${result.source}\nLast updated: ${result.lastUpdated}\n\n`;
        output += `Kawazu cherry is a deep pink variety blooming Jan-Feb in Izu Peninsula, south of Mt. Fuji.\n\n`;
        if (result.forecastComment) output += `## Forecast\n${result.forecastComment}\n\n`;
        output += `## Map\n${preferredMapUrl(result.forecastMapUrlEn, result.forecastMapUrl, outputConfig)}\n\n`;

        if (spot_name && filteredSpots.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No Kawazu cherry spots matched "${spot_name}". Try a broader landmark name such as '原木', '駅前', 'iZoo', or '七滝'.`,
            }],
          };
        }

        if (include_spots) {
          output += `## Spots (${filteredSpots.length})\n\n`;
          for (const spot of filteredSpots) {
            output += `### ${spot.name}\n- **${spot.status}**\n- Bloom: **${spot.bloomRate}%** | Full: **${spot.fullRate}%**\n`;
            output += `- Bloom ${formatSakuraDate(spot.bloomForecast, outputConfig)} → full bloom ${formatSakuraDate(spot.fullBloomForecast, outputConfig)}\n`;
            output += coordinateLine(spot.lat, spot.lon, outputConfig);
          }
        } else {
          output += `Spot list omitted. Set include_spots=true when the user wants the detailed Kawazu viewing locations.\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: koyo_forecast ──

  server.registerTool(
    "koyo_forecast",
    {
      title: "Autumn Leaves Forecast",
      description: "Use this when the user asks when autumn leaves peak, whether one city colors earlier than another, or wants a national overview for October-December. Returns city-level maple and ginkgo forecast dates, forecast maps, and regional commentary from Japan Meteorological Corporation. Do not use this for specific temples, gardens, or GPS-tagged locations; call koyo_spots next for those.",
      inputSchema: {
        region: z.string().optional().describe(
          `Optional case-insensitive filter for a region, prefecture, or city such as ${KOYO_LOCATION_EXAMPLES.slice(0, 4).map((name) => `'${name}'`).join(", ")}. Use this when the user only cares about one part of Japan instead of the full national forecast.`
        ).meta({ title: "Region or Prefecture Filter" }),
        tree_type: z.enum(["all", "maple", "ginkgo"]).optional().describe(
          "Optional tree filter. Use 'maple' for momiji-only dates, 'ginkgo' for ginkgo-only dates, or omit/use 'all' to return both."
        ).meta({ title: "Tree Type Filter" }),
      },
      annotations: READONLY,
    },
    async ({ region, tree_type = "all" }) => {
      try {
        const forecast = await getKoyoForecast();
        const regionTerms = koyoFilterTerms(region);
        const filteredRegions = forecast.regions
          .map((forecastRegion) => {
            const matchingCities = forecastRegion.cities.filter((city) => {
              return matchesKoyoFilter(regionTerms, forecastRegion, city);
            });
            return { ...forecastRegion, cities: matchingCities };
          })
          .filter((forecastRegion) => forecastRegion.cities.length > 0);

        if (region && filteredRegions.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No koyo forecast cities matched "${region}". Try a broader region, prefecture, or city name such as ${KOYO_LOCATION_EXAMPLES.join(", ")}.`,
            }],
          };
        }

        let output = `# Autumn Leaves (Koyo) Forecast\nSource: ${forecast.source}\nLast updated: ${forecast.lastUpdated}\n\n`;
        const freshnessNote = priorSeasonKoyoNote(forecast.lastUpdated);
        if (freshnessNote) output += `**Data freshness:** ${freshnessNote}\n\n`;
        output += `## Typical timing guide\n${KOYO_TYPICAL_TIMING_GUIDE}\n\n`;
        if (!freshnessNote && forecast.forecastComment) output += `## JMC source commentary\n${forecast.forecastComment}\n\n`;
        output += `## Maps\n- Maple: ${preferredMapUrl(forecast.mapleForecastMapUrlEn, forecast.mapleForecastMapUrl, outputConfig)}\n- Ginkgo: ${preferredMapUrl(forecast.ginkgoForecastMapUrlEn, forecast.ginkgoForecastMapUrl, outputConfig)}\n\n`;
        for (const forecastRegion of filteredRegions) {
          output += `## ${forecastRegion.name}\n`;
          for (const city of forecastRegion.cities) {
            output += `### ${city.name} (${city.prefName})\n`;
            if (tree_type !== "ginkgo" && city.maple) {
              output += `- **Maple (${city.maple.species}):** ${formatKoyoOutputDate(city.maple.forecast, outputConfig)} — ${city.maple.normalDiffClass}`;
              if (city.maple.normalDiffDays > 0) output += ` (${city.maple.normalDiffDays} days)`;
              output += `\n`;
            }
            if (tree_type !== "maple" && city.ginkgo) {
              output += `- **Ginkgo:** ${formatKoyoOutputDate(city.ginkgo.forecast, outputConfig)} — ${city.ginkgo.normalDiffClass}`;
              if (city.ginkgo.normalDiffDays > 0) output += ` (${city.ginkgo.normalDiffDays} days)`;
              output += `\n`;
            }
          }
          output += `\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: koyo_spots ──

  server.registerTool(
    "koyo_spots",
    {
      title: "Autumn Leaves Viewing Spots",
      description: "Use this when the user already knows the prefecture and needs exact autumn leaves viewing spots. Returns Japan Meteorological Corporation koyo spots for one prefecture with best start, peak, and end dates, leaf type, popularity rating, and GPS coordinates. Omit prefecture to get a top-destinations guide. Do not use this for cross-city date matching; use koyo_forecast or koyo_best_dates first.",
      inputSchema: {
        prefecture: z.string().optional().describe("Prefecture filter. Accepts English name or numeric code such as 'Kyoto', 'Tokyo', 'Hokkaido', or '26'. Omit to receive a curated list of top koyo destinations across Japan.").meta({ title: "Prefecture Name or Code (optional)" }),
      },
      annotations: READONLY,
    },
    async ({ prefecture }) => {
      try {
        // No-city mode: curated top koyo destinations
        if (!prefecture) {
          const results = await Promise.allSettled(
            TOP_KOYO_PREFS.map(p => getKoyoSpots(p.code))
          );
          let output = `# Top Autumn Leaves Destinations in Japan\n\nShowing top-rated spots from ${TOP_KOYO_PREFS.length} prime koyo prefectures. For nationwide timing, use koyo_forecast. For trip-date matching, use koyo_best_dates.\n\n`;
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "rejected") continue;
            const result = r.value;
            const freshnessNote = priorSeasonKoyoSpotNote(result.spots);
            if (freshnessNote && i === 0) output += `**Data freshness:** ${freshnessNote}\n\n`;
            // Show top 3 spots per prefecture by popularity
            const topSpots = [...result.spots].sort((a, b) => b.popularity - a.popularity).slice(0, 3);
            if (topSpots.length === 0) continue;
            output += `## ${TOP_KOYO_PREFS[i].label}\n`;
            for (const spot of topSpots) {
              output += `### ${spot.name}${spot.nameReading ? ` (${spot.nameReading})` : ""}\n`;
              output += `- **${spot.status}**\n`;
              output += `- ${spot.leafType}${spot.popularity > 0 ? ` | ${"★".repeat(spot.popularity)}` : ""}\n`;
              output += `- Best: ${formatKoyoOutputDate(spot.bestStart, outputConfig)} → peak ${formatKoyoOutputDate(spot.bestPeak, outputConfig)} → end ${formatKoyoOutputDate(spot.bestEnd, outputConfig)}\n`;
              output += coordinateLine(spot.lat, spot.lon, outputConfig);
            }
          }
          return { content: [{ type: "text", text: output }] };
        }

        const prefCode = findPrefCode(prefecture);
        if (!prefCode) {
          return { content: [{ type: "text", text: `Prefecture "${prefecture}" not found.` }], isError: true };
        }
        const result = await getKoyoSpots(prefCode);
        let output = `# Autumn Leaves — ${result.prefecture}\nSource: ${result.source}\nTotal spots: ${result.spots.length}\n\n`;
        const freshnessNote = priorSeasonKoyoSpotNote(result.spots);
        if (freshnessNote) output += `**Data freshness:** ${freshnessNote}\n\n`;
        for (const spot of result.spots) {
          output += `### ${spot.name}${spot.nameReading ? ` (${spot.nameReading})` : ""}\n`;
          output += `- **${spot.status}**\n`;
          output += `- ${spot.leafType}${spot.popularity > 0 ? ` | ${"★".repeat(spot.popularity)}` : ""}\n`;
          output += `- Best: ${formatKoyoOutputDate(spot.bestStart, outputConfig)} → peak ${formatKoyoOutputDate(spot.bestPeak, outputConfig)} → end ${formatKoyoOutputDate(spot.bestEnd, outputConfig)}\n`;
          output += coordinateLine(spot.lat, spot.lon, outputConfig);
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: koyo_best_dates ──

  server.registerTool(
    "koyo_best_dates",
    {
      title: "Best Autumn Leaves Dates for Trip",
      description: "Use this when the user gives autumn travel dates and wants the best cities during that window. Returns cities whose maple or ginkgo viewing windows overlap the trip, based on forecast peak dates. Do not use this for general climate questions or for exact park recommendations without dates; use koyo_spots when the prefecture is already known.",
      inputSchema: {
        start_date: z.string().describe("Trip start date in YYYY-MM-DD format, for example '2026-11-20'. The tool checks whether each city's koyo window overlaps this date.").meta({ title: "Trip Start Date" }),
        end_date: z.string().describe("Trip end date in YYYY-MM-DD format, for example '2026-11-27'. Must be on or after start_date.").meta({ title: "Trip End Date" }),
      },
      annotations: READONLY,
    },
    async ({ start_date, end_date }) => {
      try {
        const range = parseDateRangeInputJst(start_date, end_date);
        if (!range) {
          return { content: [{ type: "text", text: `Invalid date format. ${DATE_RANGE_INPUT_HINT}` }], isError: true };
        }
        const forecast = await getKoyoForecast();

        const matches: { name: string; pref: string; mapleDate: string | null; ginkgoDate: string | null }[] = [];
        for (const region of forecast.regions) {
          for (const city of region.cities) {
            if (koyoViewingWindowOverlaps(city, range.startDate, range.endDate)) {
              matches.push({ name: city.name, pref: city.prefName, mapleDate: city.maple?.forecast ?? null, ginkgoDate: city.ginkgo?.forecast ?? null });
            }
          }
        }

        let output = `# Best cities for koyo: ${start_date} to ${end_date}\n\n`;
        const freshnessNote = priorSeasonKoyoNote(forecast.lastUpdated);
        if (freshnessNote) output += `**Data freshness:** ${freshnessNote}\n\n`;
        if (!matches.length) {
          output += koyoNoMatchText(start_date, end_date);
          return { content: [{ type: "text", text: output }] };
        }

        output += `${matches.length} cities with autumn colour in your window.\nUse koyo_spots to find specific parks and temples.\n\n`;
        for (const m of matches) {
          output += `### ${m.name} (${m.pref})\n`;
          if (m.mapleDate) output += `- 🍁 Maple peak: ${formatKoyoOutputDate(m.mapleDate, outputConfig)}\n`;
          if (m.ginkgoDate) output += `- 🟡 Ginkgo peak: ${formatKoyoOutputDate(m.ginkgoDate, outputConfig)}\n`;
          output += "\n";
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: weather_forecast ──

  server.registerTool(
    "weather_forecast",
    {
      title: "Japan Weather Forecast",
      description: "Use this when short-range weather could change the recommendation, especially for sakura petal fall, rain risk, or packing advice. Returns the next 3 days of Japan Meteorological Agency forecast text, temperatures, and 6-hour rain probabilities for one supported city. Do not use this for seasonal bloom timing months in advance; use the sakura or koyo forecast tools for that.",
      inputSchema: {
        city: z.string().describe(`Supported city name such as 'Tokyo', 'Kyoto', 'Osaka', or 'Sapporo'. Partial case-insensitive matching is accepted. Full supported list: ${Object.keys(WEATHER_CITY_IDS).join(", ")}`).meta({ title: "City Name" }),
      },
      annotations: READONLY,
    },
    async ({ city }) => {
      try {
        const forecast = await getWeatherForecast(city);
        let output = `# ${forecast.title}\nPublished: ${forecast.publicTime}\n\n`;
        if (forecast.description) output += `${forecast.description}\n\n`;
        for (const day of forecast.forecasts) {
          output += `### ${day.dateLabel} (${day.date})\n**${day.telop}**\n`;
          if (day.detail.weather) output += `${day.detail.weather}\n`;
          const useFahrenheit = outputConfig.temperatureUnit === "fahrenheit";
          const unitLabel = useFahrenheit ? "F" : "C";
          const minTemp = useFahrenheit ? day.temperature.min.fahrenheit : day.temperature.min.celsius;
          const maxTemp = useFahrenheit ? day.temperature.max.fahrenheit : day.temperature.max.celsius;
          if (minTemp || maxTemp) output += `Temp: ${minTemp ?? "—"}°${unitLabel} / ${maxTemp ?? "—"}°${unitLabel}\n`;
          output += `Rain: ${day.chanceOfRain.T00_06} | ${day.chanceOfRain.T06_12} | ${day.chanceOfRain.T12_18} | ${day.chanceOfRain.T18_24}\n\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: flowers_spots ──

  server.registerTool(
    "flowers_spots",
    {
      title: "Seasonal Flower Spots",
      description: "Use this for non-sakura flower trips such as plum, wisteria, hydrangea, lavender, sunflower, or cosmos. Returns curated flower spots with peak windows, official URLs, notes, and GPS coordinates. Do not use this for cherry blossom or autumn leaves timing; use the sakura or koyo tools for those live forecasts.",
      inputSchema: {
        type: z.enum(["all", "plum", "nanohana", "wisteria", "iris", "hydrangea", "lavender", "sunflower", "cosmos"]).optional()
          .describe("Optional flower type filter. Allowed values: 'all', 'plum', 'nanohana', 'wisteria', 'iris', 'hydrangea', 'lavender', 'sunflower', or 'cosmos'. Omit or use 'all' to return every flower type.")
          .meta({ title: "Flower Type" }),
        prefecture: z.string().optional()
          .describe("Optional prefecture filter such as 'Kanagawa', 'Kyoto', 'Tokyo', or 'Hokkaido'. Partial case-insensitive matches are supported.")
          .meta({ title: "Prefecture Filter" }),
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Returns only flower types whose curated season includes that month, for example 4 for wisteria or 6 for hydrangea.")
          .meta({ title: "Month Number" }),
      },
      annotations: READONLY,
    },
    async ({ type, prefecture, month }) => {
      try {
        const data = STATIC_MCP.flowers;
        if (!data) {
          return { content: [{ type: "text", text: "Flowers data not available on this instance." }], isError: true };
        }
        let spots: AnySpot[] = data.spots || [];

        if (type && type !== "all") spots = spots.filter((s) => s["type"] === type);
        if (prefecture) spots = spots.filter((s) => (s["prefecture"] as string | undefined)?.toLowerCase().includes(prefecture.toLowerCase()));
        if (month) {
          spots = spots.filter((s) => {
            const months = FLOWER_SEASON_MONTHS[s["type"] as string] || [];
            return months.includes(month);
          });
        }

        if (spots.length === 0) {
          return { content: [{ type: "text", text: `No flower spots found for the given filters.` }] };
        }

        const typeLabel = type && type !== "all" ? type : "all types";
        let output = `# Japan Flower Spots — ${typeLabel}\n`;
        output += `Source: seasons.kooexperience.com | Updated: ${data.updated}\n`;
        output += `Total: ${spots.length} spots\n\n`;
        output += `## Season Overview (8 types, Jan–Oct)\n`;
        for (const [t, m] of Object.entries(FLOWER_META)) {
          output += `- ${m.emoji} **${t.charAt(0).toUpperCase() + t.slice(1)}** — ${m.season}\n`;
        }
        output += "\n";

        const byType: Record<string, AnySpot[]> = {};
        for (const s of spots) {
          const t = s["type"] as string;
          if (!byType[t]) byType[t] = [];
          byType[t].push(s);
        }

        for (const [flowerType, flowerSpots] of Object.entries(byType)) {
          const meta = FLOWER_META[flowerType] || { emoji: "🌸", season: "" };
          output += `## ${meta.emoji} ${flowerType.charAt(0).toUpperCase() + flowerType.slice(1)} — ${meta.season}\n\n`;
          for (const s of flowerSpots) {
            output += `### ${s["name"]}${s["nameJa"] ? ` (${s["nameJa"]})` : ""}\n`;
            output += `- **Prefecture:** ${s["prefecture"]} (${s["region"]})\n`;
            if (s["peakStart"] && s["peakEnd"]) output += `- **Peak:** ${s["peakStart"]} → ${s["peakEnd"]}\n`;
            if (s["note"]) output += `- **Note:** ${s["note"]}\n`;
            output += `- **Official site:** ${s["url"]}\n`;
            output += gpsLine(s["lat"], s["lon"], outputConfig) + "\n";
          }
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: fruit_seasons ──

  server.registerTool(
    "fruit_seasons",
    {
      title: "Fruit Picking Season Calendar",
      description: "Use this when the user asks what fruit is in season in a given month or which month is best for strawberries, grapes, peaches, apples, and similar picking trips. Returns the fruit season calendar, peak months, best regions, and notes for 14 fruits. Call fruit_farms next if the user needs actual farm listings, map coordinates, or booking links.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Returns fruits in season during that month plus fruits starting the following month. Omit to return the full year calendar.")
          .meta({ title: "Month Number" }),
      },
      annotations: READONLY,
    },
    async ({ month }) => {
      try {
        if (month) {
          const inSeason = FRUITS.filter(f => f.months.includes(month));
          const nextM = month === 12 ? 1 : month + 1;
          const comingSoon = FRUITS.filter(f => !f.months.includes(month) && f.months.includes(nextM));

          let output = `# Japan Fruit Picking — ${MO[month-1]}\n\n`;

          if (inSeason.length) {
            output += `## In Season (${inSeason.length} fruits)\n\n`;
            for (const f of inSeason) {
              const isPeak = f.peak.includes(month);
              output += `### ${f.emoji} ${f.name} (${f.ja})${isPeak ? " ⭐ PEAK" : ""}\n`;
              output += `- **Season:** ${f.months.map(m => MO[m-1]).join(", ")}\n`;
              output += `- **Peak months:** ${f.peak.map(m => MO[m-1]).join(", ")}\n`;
              output += `- **Best regions:** ${f.regions.join(", ")}\n`;
              if (f.note) output += `- **Note:** ${f.note}\n`;
              output += "\n";
            }
          } else {
            output += `No fruits in peak season in ${MO[month-1]}.\n\n`;
          }

          if (comingSoon.length) {
            output += `## Coming Up in ${MO[nextM-1]}\n`;
            output += comingSoon.map(f => `- ${f.emoji} ${f.name}`).join("\n") + "\n\n";
          }

          output += `Use fruit_farms to find specific farms with GPS coordinates.`;
          return { content: [{ type: "text", text: output }] };
        }

        // Full year calendar
        let output = `# Japan Fruit Picking — Full Year Calendar\n\n`;
        output += `| Month | In Season | Peak |\n|---|---|---|\n`;
        for (let m = 1; m <= 12; m++) {
          const inSeason = FRUITS.filter(f => f.months.includes(m));
          const peak = FRUITS.filter(f => f.peak.includes(m));
          output += `| ${MO[m-1]} | ${inSeason.map(f => f.emoji + f.name).join(", ") || "—"} | ${peak.map(f => f.name).join(", ") || "—"} |\n`;
        }
        output += `\n## All Fruits\n\n`;
        for (const f of FRUITS) {
          output += `### ${f.emoji} ${f.name} (${f.ja})\n`;
          output += `- **Season:** ${f.months.map(m => MO[m-1]).join(", ")}\n`;
          output += `- **Peak:** ${f.peak.map(m => MO[m-1]).join(", ")}\n`;
          output += `- **Best regions:** ${f.regions.join(", ")}\n`;
          if (f.note) output += `- **Note:** ${f.note}\n`;
          output += "\n";
        }
        output += `Use fruit_farms to find specific farms with GPS coordinates.`;
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: festivals_list ──

  server.registerTool(
    "festivals_list",
    {
      title: "Japan Seasonal Festivals",
      description: "Use this when the user wants recurring Japan events to plan around, such as fireworks, matsuri, or winter festivals. Returns curated events with typical dates, attendance, official URLs, notes, and GPS coordinates. Do not use this for bloom timing, one-off concerts, or weather forecasts.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Useful examples: 7 or 8 for fireworks season, 10 or 11 for autumn matsuri, and 1 or 2 for winter events.")
          .meta({ title: "Month Number" }),
        type: z.enum(["all", "fireworks", "matsuri", "winter"]).optional()
          .describe("Optional event type filter. Allowed values: 'all', 'fireworks', 'matsuri', or 'winter'. Omit or use 'all' to return every event type.")
          .meta({ title: "Event Type" }),
        prefecture: z.string().optional()
          .describe("Optional prefecture filter such as 'Tokyo', 'Kyoto', 'Osaka', or 'Hokkaido'. Partial case-insensitive matches are supported.")
          .meta({ title: "Prefecture Filter" }),
      },
      annotations: READONLY,
    },
    async ({ month, type, prefecture }) => {
      try {
        const data = STATIC_MCP.festivals;
        if (!data) {
          return { content: [{ type: "text", text: "Festivals data not available on this instance." }], isError: true };
        }
        let spots: AnySpot[] = data.spots || [];

        if (type && type !== "all") spots = spots.filter((s) => s["type"] === type);
        if (prefecture) spots = spots.filter((s) => (s["prefecture"] as string | undefined)?.toLowerCase().includes(prefecture.toLowerCase()));
        if (month) spots = spots.filter((s) => (s["months"] as number[] | undefined)?.includes(month));

        if (spots.length === 0) {
          return { content: [{ type: "text", text: `No festivals found for the given filters. Major seasons: fireworks Jul-Aug, autumn matsuri Sep-Nov, winter events Jan-Feb.` }] };
        }

        let output = `# Japan Festivals${month ? ` — ${MO[month-1]}` : ""}${type && type !== "all" ? ` — ${type}` : ""}\n`;
        output += `Source: seasons.kooexperience.com | ${spots.length} events\n\n`;
        output += `## Tips\n- Book accommodation months ahead for major festivals (Gion Matsuri, Nebuta, Sumida Fireworks)\n`;
        output += `- Fireworks season peaks July–August; winter events peak January–February\n\n`;

        const byType: Record<string, AnySpot[]> = {};
        for (const s of spots) {
          const t = s["type"] as string;
          if (!byType[t]) byType[t] = [];
          byType[t].push(s);
        }

        for (const [fType, fSpots] of Object.entries(byType)) {
          output += `## ${FESTIVAL_TYPE_META[fType]?.emoji ?? ""} ${fType.charAt(0).toUpperCase() + fType.slice(1)} (${fSpots.length})\n\n`;
          for (const s of fSpots) {
            output += `### ${s["name"]}${s["nameJa"] ? ` (${s["nameJa"]})` : ""}\n`;
            output += `- **When:** ${(s["months"] as number[]).map((m: number) => MO[m-1]).join(", ")} — ${s["typicalDate"]}\n`;
            output += `- **Location:** ${s["prefecture"]} (${s["region"]})\n`;
            if (s["attendance"]) output += `- **Attendance:** ~${(s["attendance"] as number).toLocaleString()} visitors\n`;
            if (s["note"]) output += `- **Note:** ${s["note"]}\n`;
            output += `- **Official site:** ${s["url"]}\n`;
            output += gpsLine(s["lat"], s["lon"], outputConfig) + "\n";
          }
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: fruit_farms ──

  server.registerTool(
    "fruit_farms",
    {
      title: "Fruit Picking Farms",
      description: "Use this when the user needs actual fruit-picking farms, booking links, and map coordinates. Returns farms from the local dataset, and month filtering automatically narrows results to fruits that are in season. If the user only asks which fruit is in season, call fruit_seasons first.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional travel month from 1 to 12. Filters to farms with at least one fruit in season during that month, for example 5 for May strawberry farms.")
          .meta({ title: "Travel Month" }),
        fruit: z.string().optional()
          .describe("Optional fruit name such as 'Strawberry', 'Apple', 'Grape', 'Peach', 'Cherry', or 'Mikan'. Matching is case-insensitive. Use with or instead of month.")
          .meta({ title: "Fruit Name" }),
        region: z.string().optional()
          .describe("Optional prefecture, city, or region substring such as 'Yamanashi', 'Nagano', 'Aomori', or 'Tokyo'. Partial case-insensitive matching is supported against farm names and addresses.")
          .meta({ title: "Region Filter" }),
        limit: z.number().int().min(1).max(100).optional()
          .describe("Optional maximum number of farms to return. Default is 30 and the hard maximum is 100.")
          .meta({ title: "Result Limit" }),
      },
      annotations: READONLY,
    },
    async ({ month, fruit, region, limit = 30 }) => {
      try {
        const data = STATIC_MCP.farms;
        if (!data) {
          return { content: [{ type: "text", text: "Farm data not available on this instance. The hosted version at seasons.kooexperience.com includes the fruit-picking farm directory." }], isError: true };
        }
        let farms: AnySpot[] = data.spots || [];

        if (month) {
          const inSeason = new Set(FRUITS.filter(f => f.months.includes(month)).map(f => f.name));
          farms = farms.filter(f => (f["fruits"] as string[] | undefined)?.some(fr => inSeason.has(fr)));
        }
        if (fruit) {
          const wantedFruit = fruit.toLowerCase();
          farms = farms.filter((f) =>
            (f["fruits"] as string[] | undefined)?.some((farmFruit) => farmFruit.toLowerCase() === wantedFruit)
          );
        }
        if (region) farms = farms.filter((f) =>
          (f["address"] as string | undefined)?.toLowerCase().includes(region.toLowerCase()) ||
          (f["name"] as string | undefined)?.toLowerCase().includes(region.toLowerCase())
        );

        // Prioritise farms with coordinates
        farms.sort((a, b) => (b["lat"] ? 1 : 0) - (a["lat"] ? 1 : 0));

        const withCoords = farms.filter((f) => f["lat"]).length;
        const shown = farms.slice(0, limit);

        let output = `# Japan Fruit Picking Farms\n`;
        output += `Database: ${data.total} total farms | Updated: ${data.scraped_at ? new Date(data.scraped_at).toDateString() : "unknown"}\n`;
        const monthLabel = month ? `month=${MO[month-1]}, ` : "";
        output += `Filters: ${monthLabel}fruit=${fruit || "any"}, region=${region || "any"} → ${farms.length} matches (${withCoords} with GPS)\n\n`;

        if (shown.length === 0) {
          return { content: [{ type: "text", text: `No farms found. Try fruit_seasons to see what's in season, then filter by a specific fruit.` }] };
        }

        for (const f of shown) {
          output += `### ${f["name"]}\n`;
          if (f["address"]) output += `- **Address:** ${f["address"]}\n`;
          const fruits = f["fruits"] as string[] | undefined;
          if (fruits?.length) output += `- **Fruits:** ${fruits.join(", ")}\n`;
          if (f["lat"] && f["lon"]) output += gpsLine(f["lat"], f["lon"], outputConfig);
          if (f["url"]) output += `- **Link:** ${f["url"]}\n`;
          output += "\n";
        }

        if (farms.length > limit) {
          output += `_Showing ${limit} of ${farms.length} farms. Use the fruit/region filters or visit seasons.kooexperience.com for the full interactive map._`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

}

// ─── Formatting helper ───────────────────────────────────────────────────────

function formatCityResults(cities: SakuraCity[], outputConfig: OutputConfig): string {
  let output = "";
  for (const city of cities) {
    output += `### ${city.cityName} (${city.prefName})\n`;
    output += `- **Status:** ${city.status}\n`;
    // Bloom date — show confirmed observation when available, otherwise label as forecast
    if (city.bloom.observation) {
      output += `- **Bloom:** ${formatSakuraDate(city.bloom.observation, outputConfig)} ✓ actual (avg ${city.bloom.normal ?? "N/A"})\n`;
    } else {
      output += `- **Bloom:** ${formatSakuraDate(city.bloom.forecast, outputConfig)} forecast (avg ${city.bloom.normal ?? "N/A"})\n`;
    }
    // Full bloom date — same priority
    if (city.fullBloom.observation) {
      output += `- **Full bloom:** ${formatSakuraDate(city.fullBloom.observation, outputConfig)} ✓ actual (avg ${city.fullBloom.normal ?? "N/A"})\n`;
    } else {
      output += `- **Full bloom:** ${formatSakuraDate(city.fullBloom.forecast, outputConfig)} forecast (avg ${city.fullBloom.normal ?? "N/A"})\n`;
    }
  }
  return output;
}

// ─── Server startup ──────────────────────────────────────────────────────────

// ─── Usage stats ─────────────────────────────────────────────────────────────

const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  toolCalls: {} as Record<string, number>,
  uniqueIps: new Set<string>(),

  recordRequest(ip: string) {
    this.totalRequests++;
    this.uniqueIps.add(ip);
  },
  recordToolCall(tool: string) {
    this.totalToolCalls++;
    this.toolCalls[tool] = (this.toolCalls[tool] ?? 0) + 1;
  },
  toJSON() {
    return {
      startedAt: this.startedAt,
      uptime: Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000),
      totalRequests: this.totalRequests,
      totalToolCalls: this.totalToolCalls,
      uniqueUsers: this.uniqueIps.size,
      toolCalls: this.toolCalls,
    };
  },
};

function recordToolCallsFromBody(parsedBody: any): void {
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  for (const message of messages) {
    if (message?.method === "tools/call") {
      const toolName = typeof message.params?.name === "string" ? message.params.name : "unknown";
      stats.recordToolCall(toolName);
    }
  }
}

// Log stats every hour
setInterval(() => {
  logger.info(`Stats: ${JSON.stringify(stats.toJSON())}`);
}, 60 * 60 * 1000).unref();

const isHttpMode = process.argv.includes("--http") || !!process.env.PORT;

// Register tools on the module-level server (for stdio mode)
const server = new McpServer({ name: "japan-seasons-mcp", version: SERVER_VERSION }, {
  instructions: SERVER_INSTRUCTIONS,
});
registerAllTools(server, getOutputConfigFromEnv());

async function main() {
  if (isHttpMode) {
    await startHttpServer();
  } else {
    logger.info("Starting japan-seasons-mcp (stdio)");
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// ─── HTTP rate limiter ───────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP
const MAX_SESSIONS = 10_000;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_BODY_BYTES = 1_048_576;

const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestCounts) {
    if (now > entry.resetAt) ipRequestCounts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

async function startHttpServer() {
  const port = parseInt(process.env.PORT ?? "3000");
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessionLastActive = new Map<string, number>();

  // Clean up idle sessions every 2 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [sid, lastActive] of sessionLastActive) {
      if (now - lastActive > SESSION_IDLE_TIMEOUT_MS) {
        const transport = transports.get(sid);
        if (transport) transport.close();
        transports.delete(sid);
        sessionLastActive.delete(sid);
        logger.info(`Cleaned up idle session ${sid.slice(0, 8)}...`);
      }
    }
    if (transports.size > 0) {
      logger.info(`Active sessions: ${transports.size}`);
    }
  }, 2 * 60 * 1000).unref();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress ?? "unknown";

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'");

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id, x-date-style, x-temperature-unit, x-include-coordinates, x-map-language");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

    stats.recordRequest(clientIp);

    // Rate limit (except health check)
    if (url.pathname !== "/health" && isRateLimited(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "Too many requests. Limit: 60/minute." }));
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        server: "japan-seasons-mcp",
        version: SERVER_VERSION,
        activeSessions: transports.size,
        cache: await getApiCacheStatus(),
        ...stats.toJSON(),
      }));
      return;
    }

    if (url.pathname === "/site-config.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(JSON.stringify(SITE_PUBLIC_CONFIG));
      return;
    }

    if (url.pathname === "/sakura-forecast.txt") {
      try {
        const outputConfig = getOutputConfig(url.searchParams, req.headers);
        const body = await buildSakuraForecastMarkdown(outputConfig);
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=900",
        });
        res.end(body);
      } catch (e: any) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Unable to load sakura forecast: ${e.message}`);
      }
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Handle DELETE (session close)
      if (req.method === "DELETE") {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
          sessionLastActive.delete(sessionId);
        } else {
          res.writeHead(204).end();
        }
        return;
      }

      // Reuse existing session
      if (sessionId && transports.has(sessionId)) {
        sessionLastActive.set(sessionId, Date.now());
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          let bodyBytes = 0;
          for await (const chunk of req) {
            bodyBytes += (chunk as Buffer).length;
            if (bodyBytes > MAX_BODY_BYTES) {
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Request body too large." }));
              return;
            }
            chunks.push(chunk as Buffer);
          }
          const bodyStr = Buffer.concat(chunks).toString();
          let parsedBody: any;
          try { parsedBody = JSON.parse(bodyStr); } catch { parsedBody = null; }
          recordToolCallsFromBody(parsedBody);
          await transports.get(sessionId)!.handleRequest(req, res, parsedBody);
        } else {
          await transports.get(sessionId)!.handleRequest(req, res);
        }
        return;
      }

      // Reject new sessions if at capacity
      if (transports.size >= MAX_SESSIONS) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server at capacity. Try again later." }));
        return;
      }

      // New connection without session ID.
      // Read body to check if it's an initialize request or not.
      // Limit body size to 1 MB to prevent memory-exhaustion attacks.
      const chunks: Buffer[] = [];
      let bodyBytes = 0;
      for await (const chunk of req) {
        bodyBytes += (chunk as Buffer).length;
        if (bodyBytes > MAX_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large." }));
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const bodyStr = Buffer.concat(chunks).toString();
      let parsedBody: any;
      try { parsedBody = JSON.parse(bodyStr); } catch { parsedBody = null; }

      const isInit = parsedBody?.method === "initialize" ||
        (Array.isArray(parsedBody) && parsedBody.some((m: any) => m.method === "initialize"));
      recordToolCallsFromBody(parsedBody);
      const outputConfig = getOutputConfig(url.searchParams, req.headers);

      // For non-init requests without session ID (e.g. Smithery probes),
      // use a stateless transport so they don't need initialization.
      if (sessionId && !isInit) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: parsedBody?.id ?? null,
        }));
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: isInit ? () => crypto.randomUUID() : undefined,
      });

      if (isInit) {
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
            sessionLastActive.delete(transport.sessionId);
          }
        };
      }

      const sessionServer = new McpServer({ name: "japan-seasons-mcp", version: SERVER_VERSION }, {
        instructions: SERVER_INSTRUCTIONS,
      });
      registerAllTools(sessionServer, outputConfig);
      await sessionServer.connect(transport);

      // Pass the pre-parsed body so the transport doesn't try to re-read the stream
      await transport.handleRequest(req, res, parsedBody);

      if (isInit && transport.sessionId) {
        transports.set(transport.sessionId, transport);
        sessionLastActive.set(transport.sessionId, Date.now());
        logger.info(`Initialized MCP session ${transport.sessionId.slice(0, 8)}...`);
      }
      return;
    }

    // REST API endpoints (for the frontend)
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApiRequest(req, res, url.pathname, url.searchParams);
      if (handled) return;
    }

    // Dynamic sitemap — regenerated on each request with today's date
    if (url.pathname === "/sitemap.xml") {
      res.writeHead(200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(SITEMAP_XML());
      return;
    }

    // Serve frontend static files
    // Files are read once at startup and served from memory.
    // No server-side gzip — let the reverse proxy (Railway) handle compression
    // to avoid double-encoding issues.
    const staticEntry = STATIC_FILES[url.pathname];
    if (staticEntry) {
      const body = renderSiteTemplate(staticEntry.body, staticEntry.mime);
      res.writeHead(200, {
        "Content-Type": staticEntry.mime,
        "Cache-Control": "public, max-age=300",
        "Vary": "Accept-Encoding",
      });
      res.end(body);
      return;
    }

    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, () => {
    logger.info(`japan-seasons-mcp HTTP server on port ${port}`);
    logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
    logger.info(`Rate limit: ${RATE_LIMIT_MAX} req/min per IP, max ${MAX_SESSIONS} sessions`);
  });

  // Re-warm forecasts + spots automatically after each daily 9 AM JST cache flush.
  onDailyFlush(() => {
    logger.info("Post-flush re-warm starting…");
    Promise.all([getSakuraForecast(), getKoyoForecast(), getKawazuForecast()])
      .then(() => warmSpotsCache())
      .catch((e: any) => logger.error(`Post-flush re-warm failed: ${e.message}`));
  });

  // Pre-warm forecast caches in the background so the first visitor never waits.
  // Runs immediately after listen() — completes well before any user arrives post-deploy.
  (async () => {
    try {
      logger.info("Cache warm-up: forecasts + all-spots…");
      // Forecasts first (fast — single API call each)
      await Promise.all([getSakuraForecast(), getKoyoForecast(), getKawazuForecast()]);
      logger.info("Forecasts ready — warming all-spots (background)…");
      // All-spots in background: 47 upstream requests each, takes ~30s on first deploy
      warmSpotsCache().catch((e: any) => logger.error(`all-spots warm-up failed: ${e.message}`));
    } catch (e: any) {
      logger.warn(`Cache warm-up error (non-fatal): ${e.message}`);
    }
  })();
}

main().catch((e) => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
