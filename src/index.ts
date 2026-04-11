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
import { handleApiRequest, warmSpotsCache } from "./api.js";
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
} from "./lib/sakura-forecast.js";
import { getKoyoForecast, getKoyoSpots, formatDate as formatKoyoDate } from "./lib/koyo.js";
import { getWeatherForecast } from "./lib/weather.js";
import { WEATHER_CITY_IDS } from "./lib/areas.js";
import { FLOWER_SEASON_MONTHS, FLOWER_META, FESTIVAL_TYPE_META, MO, FRUITS } from "./lib/constants.js";

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
function loadStaticJSON(filename: string) {
  const p = resolve(process.cwd(), "public", filename);
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}
const STATIC_MCP = {
  flowers:   loadStaticJSON("flowers.json"),
  festivals: loadStaticJSON("festivals.json"),
  farms:     loadStaticJSON("fruit-farms.json"),
};

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
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

function formatSakuraDate(iso: string | null, outputConfig: OutputConfig): string {
  return outputConfig.dateStyle === "iso" ? formatIsoDate(iso) : formatDate(iso);
}

function formatKoyoOutputDate(iso: string | null, outputConfig: OutputConfig): string {
  return outputConfig.dateStyle === "iso" ? formatIsoDate(iso) : formatKoyoDate(iso);
}

function coordinateLine(lat: unknown, lon: unknown, outputConfig: OutputConfig): string {
  return outputConfig.includeCoordinates ? `- 📍 ${lat}, ${lon}\n` : "";
}

function gpsLine(lat: unknown, lon: unknown, outputConfig: OutputConfig): string {
  return outputConfig.includeCoordinates ? `- **GPS:** ${lat}, ${lon}\n` : "";
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

const SERVER_INSTRUCTIONS = `You are connected to Japan in Seasons, a read-only MCP server for live Japan seasonal travel data.

Use this server when the user needs current timing or locations for cherry blossom, autumn leaves, flowers, festivals, fruit picking, or short-range weather in Japan. Do not use it for generic travel planning, hotels, flights, trains, visas, or restaurant recommendations.

Tool routing:
- Use get_sakura_forecast for big-picture sakura timing, bloom progress, and city comparisons.
- Use get_sakura_best_dates when the user gives travel dates and wants the best sakura cities in that window, then use get_sakura_spots for exact parks and temples.
- Use get_kawazu_cherry_forecast for January-February cherry blossom requests or when the user mentions Kawazu-zakura, early blossoms, or Izu.
- Use get_koyo_forecast for autumn leaves timing by city, and get_koyo_best_dates when travel dates are provided. Follow with get_koyo_spots for exact viewing locations.
- Use get_seasonal_flowers for non-sakura seasonal flowers such as plum, wisteria, hydrangea, lavender, sunflower, and cosmos.
- Use get_japan_festivals for recurring fireworks, matsuri, and winter events with official links.
- Use get_fruit_seasons to answer which fruits are in season, and get_fruit_farms only when the user needs actual farms, GPS coordinates, or booking links.
- Use get_weather_forecast after bloom tools when rain or temperature could change the recommendation, especially because rain can shorten sakura viewing.

Important rules:
- Sakura and koyo timing changes every year; prefer these tools over generic knowledge.
- Sakura spot percentages use the official JMC bloom and full-bloom scales. A ${SAKURA_FULL_BLOOM_MANKAI_MIN}-100% full-bloom rate means mankai.
- Best sakura viewing is usually around full bloom. Best koyo viewing is usually around each spot's peak window.
- All tools are read-only and require no authentication.`;

// ─── Shared tool & prompt registration ───────────────────────────────────────

function registerAllTools(server: McpServer, outputConfig: OutputConfig = DEFAULT_OUTPUT_CONFIG) {

  // ── Prompt: plan_japan_trip ──

  server.registerPrompt(
    "plan_japan_trip",
    {
      title: "Plan Japan Seasonal Trip",
      description: "Guide for planning a seasonal trip to Japan — cherry blossom, autumn leaves, fruit picking, wisteria, hydrangea, and more. Use this when someone wants to visit Japan and see seasonal experiences.",
      argsSchema: { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12' or 'June 20-July 3'") },
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
- get_kawazu_cherry_forecast

**Late Mar – May** — Cherry blossom (sakura):
- get_sakura_forecast → big picture, 48 cities
- get_sakura_best_dates → match travel dates to bloom cities
- get_sakura_spots → 1,012 specific parks/temples with bloom % and GPS
- get_seasonal_flowers (type=wisteria) → wisteria season starts late Apr

**Apr-May** — Wisteria (fuji):
- get_seasonal_flowers with type=wisteria → 13 curated spots (Ashikaga, Kawachi, Kameido Tenjin, Byodoin, Kasuga Taisha...)

**Jun-Jul** — Hydrangea (ajisai):
- get_seasonal_flowers with type=hydrangea → 15 curated spots (Kamakura temples, Kyoto temples, Yatadera...)

**Jul-Aug** — Fireworks & summer matsuri:
- get_japan_festivals with type=fireworks → Sumida River, Nagaoka, Omagari, PL Osaka, Miyajima... (official URLs included)
- get_japan_festivals with type=matsuri → Gion Matsuri, Tenjin Matsuri, Nebuta, Awa Odori...

**May, Sep-Nov** — Traditional matsuri:
- get_japan_festivals → Sanja, Aoi, Hakata Dontaku (May), Kishiwada Danjiri (Sep), Jidai, Kurama Fire, Takayama (Oct-Nov)

**Jan-Feb** — Winter events:
- get_japan_festivals with type=winter → Sapporo Snow Festival, Yokote Kamakura, Shirakawa-go illumination...

**Year-round** — Fruit picking:
- get_fruit_seasons → which fruits are in season for the travel month
- get_fruit_farms → 350+ farms with GPS; pass month= to auto-filter by in-season fruits

**Oct-Dec** — Autumn leaves (koyo):
- get_koyo_forecast → maple & ginkgo timing, 50+ cities
- get_koyo_best_dates → match travel dates to colour cities (same as get_sakura_best_dates but for koyo)
- get_koyo_spots → 687 viewing spots with peak windows

## Bloom scale (sakura, official JMC/JMA presentation)
- ${SAKURA_BLOOM_RATE_SCALE_LINE}
- ${SAKURA_FULL_BLOOM_RATE_SCALE_LINE}

## Key facts
- Somei-Yoshino (standard cherry) blooms Mar-May, moving north Okinawa → Hokkaido
- Kawazu-zakura (deep pink) blooms Jan-Feb in Izu Peninsula
- Sakura lasts 7-10 days; rain accelerates petal fall — check get_weather_forecast
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
      argsSchema: { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12'") },
    },
    async ({ travel_dates }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Help me plan a cherry blossom trip to Japan${travel_dates ? ` for ${travel_dates}` : ""}. Use get_sakura_forecast, get_sakura_best_dates, get_sakura_spots, and get_kawazu_cherry_forecast. Also see plan_japan_trip for full year-round seasonal coverage.`,
        },
      }],
    })
  );

  // ── Tool: get_sakura_forecast ──

  server.registerTool(
    "get_sakura_forecast",
    {
      title: "Cherry Blossom Forecast",
      description: "Use this when the user asks about cherry blossom timing, peak bloom, whether sakura has started, or how cities compare across Japan. Returns Japan Meteorological Corporation forecast bloom dates, full-bloom dates, observed dates when available, historical averages, and status for 48 observation cities. Do not use this for specific parks or temples; call get_sakura_spots next for prefecture-level viewing spots.",
      inputSchema: {
        city: z.string().optional().describe(
          "Optional city, prefecture, or region filter such as 'Tokyo', 'Kyoto', 'Hokkaido', or 'Tohoku'. Partial case-insensitive matches are supported across city, prefecture, and region names. Omit to return all observation cities."
        ),
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
        let output = `# Sakura Forecast ${new Date().getFullYear()}\nSource: ${forecast.source} | ${forecast.totalCities} cities\n`;
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

  // ── Tool: get_sakura_spots ──

  server.registerTool(
    "get_sakura_spots",
    {
      title: "Cherry Blossom Viewing Spots",
      description: "Use this when the user already knows the prefecture and needs exact cherry blossom viewing spots, bloom percentages, or GPS coordinates. Returns all Japan Meteorological Corporation sakura spots for one prefecture, plus the prefecture's reference JMA station summary when available. Do not use this for nationwide timing comparisons or date matching; use get_sakura_forecast or get_sakura_best_dates first.",
      inputSchema: {
        prefecture: z.string().describe("Required prefecture filter. Accepts English prefecture name or numeric prefecture code such as 'Tokyo', 'Kyoto', 'Hokkaido', or '13'. This tool returns one prefecture at a time."),
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
        let output = `# Sakura Spots — ${result.prefecture}\nLast updated: ${result.lastUpdated} | ${result.spots.length} spots\n\n`;
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
        output += `_${SAKURA_SPOT_MODEL_NOTE}_\n\n`;
        output += `## Viewing spots\n\n`;
        for (const spot of result.spots) {
          output += `### ${spot.name}${spot.nameReading ? ` (${spot.nameReading})` : ""}\n`;
          output += `- **${spot.status}**\n`;
          output += `- Bloom rate: **${spot.bloomRate}%** | Full-bloom rate: **${spot.fullRate}%**\n`;
          if (spot.bloomForecast || spot.fullBloomForecast) {
            output += `- Bloom ${formatSakuraDate(spot.bloomForecast, outputConfig)}${spot.fullBloomForecast ? ` → full bloom ${formatSakuraDate(spot.fullBloomForecast, outputConfig)}` : ""}\n`;
          }
          output += coordinateLine(spot.lat, spot.lon, outputConfig);
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_sakura_best_dates ──

  server.registerTool(
    "get_sakura_best_dates",
    {
      title: "Best Cherry Blossom Dates for Trip",
      description: "Use this when the user provides travel dates and wants to know where sakura is likely to be best during that trip. Returns cities whose viewing window overlaps the requested date range, based on observed or forecast full-bloom dates. Do not use this for January-February early-bloom Kawazu requests; use get_kawazu_cherry_forecast for those.",
      inputSchema: {
        start_date: z.string().describe("Trip start date in YYYY-MM-DD format, for example '2026-04-08'. The tool compares this against each city's sakura viewing window."),
        end_date: z.string().describe("Trip end date in YYYY-MM-DD format, for example '2026-04-14'. Must be on or after start_date."),
      },
      annotations: READONLY,
    },
    async ({ start_date, end_date }) => {
      try {
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return { content: [{ type: "text", text: "Invalid date format. Use YYYY-MM-DD." }], isError: true };
        }
        const forecast = await getSakuraForecast();
        const matches = findBestRegions(forecast, startDate, endDate);
        if (matches.length === 0) {
          return { content: [{ type: "text", text: `No cities in bloom during ${start_date} to ${end_date}.\n\nSeason: Okinawa Jan-Feb, Kyushu/Kansai late Mar, Kanto early Apr, Tohoku mid Apr, Hokkaido late Apr-May.\nTry get_kawazu_cherry_forecast for Jan-Feb early blooms.` }] };
        }
        let output = `# Best cities for sakura: ${start_date} to ${end_date}\n\n${matches.length} cities with bloom in your window.\nUse get_sakura_spots to find specific parks.\n\n`;
        output += formatCityResults(matches, outputConfig);
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_kawazu_cherry_forecast ──

  server.registerTool(
    "get_kawazu_cherry_forecast",
    {
      title: "Kawazu Early Cherry Blossom Forecast",
      description: "Use this for January-February cherry blossom requests or when the user specifically asks about Kawazu-zakura, early blossoms, or the Izu Peninsula. Returns the Japan Meteorological Corporation forecast comment, forecast map links, and Kawazu cherry spots with bloom percentages, full-bloom percentages, forecast dates, and coordinates. Do not use this for standard Somei-Yoshino sakura elsewhere in Japan.",
      inputSchema: {
        include_spots: z.boolean().optional().describe(
          "Whether to include the full list of Kawazu viewing spots. Defaults to true. Set false when the user only needs the overall forecast summary and map."
        ),
        spot_name: z.string().optional().describe(
          "Optional case-insensitive substring filter for a specific Kawazu landmark or area, such as '原木', '駅前', 'iZoo', or '七滝'. Use this when the user asks about one named spot instead of the full list."
        ),
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

  // ── Tool: get_koyo_forecast ──

  server.registerTool(
    "get_koyo_forecast",
    {
      title: "Autumn Leaves Forecast",
      description: "Use this when the user asks when autumn leaves peak, whether one city colors earlier than another, or wants a national overview for October-December. Returns city-level maple and ginkgo forecast dates, forecast maps, and regional commentary from Japan Meteorological Corporation. Do not use this for specific temples, gardens, or GPS-tagged locations; call get_koyo_spots next for those.",
      inputSchema: {
        region: z.string().optional().describe(
          "Optional case-insensitive filter for a region, prefecture, or city such as 'Kansai', 'Kyoto', 'Hokkaido', or 'Tokyo'. Use this when the user only cares about one part of Japan instead of the full national forecast."
        ),
        tree_type: z.enum(["all", "maple", "ginkgo"]).optional().describe(
          "Optional tree filter. Use 'maple' for momiji-only dates, 'ginkgo' for ginkgo-only dates, or omit/use 'all' to return both."
        ),
      },
      annotations: READONLY,
    },
    async ({ region, tree_type = "all" }) => {
      try {
        const forecast = await getKoyoForecast();
        const regionFilter = region?.toLowerCase();
        const filteredRegions = forecast.regions
          .map((forecastRegion) => {
            const matchingCities = forecastRegion.cities.filter((city) => {
              if (!regionFilter) return true;
              return (
                forecastRegion.name.toLowerCase().includes(regionFilter) ||
                city.name.toLowerCase().includes(regionFilter) ||
                city.prefName.toLowerCase().includes(regionFilter)
              );
            });
            return { ...forecastRegion, cities: matchingCities };
          })
          .filter((forecastRegion) => forecastRegion.cities.length > 0);

        if (region && filteredRegions.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No koyo forecast cities matched "${region}". Try a broader region, prefecture, or city name such as 'Kansai', 'Kyoto', 'Tohoku', or 'Hokkaido'.`,
            }],
          };
        }

        let output = `# Autumn Leaves (Koyo) Forecast\nSource: ${forecast.source}\nLast updated: ${forecast.lastUpdated}\n\n`;
        if (forecast.forecastComment) output += `## Summary\n${forecast.forecastComment}\n\n`;
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

  // ── Tool: get_koyo_spots ──

  server.registerTool(
    "get_koyo_spots",
    {
      title: "Autumn Leaves Viewing Spots",
      description: "Use this when the user already knows the prefecture and needs exact autumn leaves viewing spots. Returns Japan Meteorological Corporation koyo spots for one prefecture with best start, peak, and end dates, leaf type, popularity rating, and GPS coordinates. Do not use this for cross-city date matching; use get_koyo_forecast or get_koyo_best_dates first.",
      inputSchema: {
        prefecture: z.string().describe("Required prefecture filter. Accepts English prefecture name or numeric prefecture code such as 'Kyoto', 'Tokyo', 'Hokkaido', or '26'. This tool returns one prefecture at a time."),
      },
      annotations: READONLY,
    },
    async ({ prefecture }) => {
      try {
        const prefCode = findPrefCode(prefecture);
        if (!prefCode) {
          return { content: [{ type: "text", text: `Prefecture "${prefecture}" not found.` }], isError: true };
        }
        const result = await getKoyoSpots(prefCode);
        let output = `# Autumn Leaves — ${result.prefecture}\nSource: ${result.source}\nTotal spots: ${result.spots.length}\n\n`;
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

  // ── Tool: get_koyo_best_dates ──

  server.registerTool(
    "get_koyo_best_dates",
    {
      title: "Best Autumn Leaves Dates for Trip",
      description: "Use this when the user gives autumn travel dates and wants the best cities during that window. Returns cities whose maple or ginkgo viewing windows overlap the trip, based on forecast peak dates. Do not use this for general climate questions or for exact park recommendations without dates; use get_koyo_spots when the prefecture is already known.",
      inputSchema: {
        start_date: z.string().describe("Trip start date in YYYY-MM-DD format, for example '2026-11-20'. The tool checks whether each city's koyo window overlaps this date."),
        end_date: z.string().describe("Trip end date in YYYY-MM-DD format, for example '2026-11-27'. Must be on or after start_date."),
      },
      annotations: READONLY,
    },
    async ({ start_date, end_date }) => {
      try {
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return { content: [{ type: "text", text: "Invalid date format. Use YYYY-MM-DD." }], isError: true };
        }
        const forecast = await getKoyoForecast();

        const matches: { name: string; pref: string; mapleDate: string | null; ginkgoDate: string | null }[] = [];
        for (const region of forecast.regions) {
          for (const city of region.cities) {
            const peakDates = [city.maple?.forecast, city.ginkgo?.forecast].filter(Boolean) as string[];
            if (!peakDates.length) continue;
            // Viewing window: 3 days before earliest peak → 10 days after latest peak
            const timestamps = peakDates.map(d => new Date(d).getTime());
            const windowStart = new Date(Math.min(...timestamps));
            windowStart.setDate(windowStart.getDate() - 3);
            const windowEnd = new Date(Math.max(...timestamps));
            windowEnd.setDate(windowEnd.getDate() + 10);
            if (startDate <= windowEnd && endDate >= windowStart) {
              matches.push({ name: city.name, pref: city.prefName, mapleDate: city.maple?.forecast ?? null, ginkgoDate: city.ginkgo?.forecast ?? null });
            }
          }
        }

        if (!matches.length) {
          return { content: [{ type: "text", text: `No koyo cities in colour during ${start_date} to ${end_date}.\n\nTypical season: Hokkaido/mountains Sep–Oct, Tohoku/Nikko Oct, Kanto/Kyoto mid-Oct to Nov, Kyushu Nov–early Dec.` }] };
        }

        let output = `# Best cities for koyo: ${start_date} to ${end_date}\n\n${matches.length} cities with autumn colour in your window.\nUse get_koyo_spots to find specific parks and temples.\n\n`;
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

  // ── Tool: get_weather_forecast ──

  server.registerTool(
    "get_weather_forecast",
    {
      title: "Japan Weather Forecast",
      description: "Use this when short-range weather could change the recommendation, especially for sakura petal fall, rain risk, or packing advice. Returns the next 3 days of Japan Meteorological Agency forecast text, temperatures, and 6-hour rain probabilities for one supported city. Do not use this for seasonal bloom timing months in advance; use the sakura or koyo forecast tools for that.",
      inputSchema: {
        city: z.string().describe(`Supported city name such as 'Tokyo', 'Kyoto', 'Osaka', or 'Sapporo'. Partial case-insensitive matching is accepted. Full supported list: ${Object.keys(WEATHER_CITY_IDS).join(", ")}`),
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

  // ── Tool: get_seasonal_flowers ──

  server.registerTool(
    "get_seasonal_flowers",
    {
      title: "Seasonal Flower Spots",
      description: "Use this for non-sakura flower trips such as plum, wisteria, hydrangea, lavender, sunflower, or cosmos. Returns curated flower spots with peak windows, official URLs, notes, and GPS coordinates. Do not use this for cherry blossom or autumn leaves timing; use the sakura or koyo tools for those live forecasts.",
      inputSchema: {
        type: z.enum(["all", "plum", "nanohana", "wisteria", "iris", "hydrangea", "lavender", "sunflower", "cosmos"]).optional()
          .describe("Optional flower type filter. Allowed values: 'all', 'plum', 'nanohana', 'wisteria', 'iris', 'hydrangea', 'lavender', 'sunflower', or 'cosmos'. Omit or use 'all' to return every flower type."),
        prefecture: z.string().optional()
          .describe("Optional prefecture filter such as 'Kanagawa', 'Kyoto', 'Tokyo', or 'Hokkaido'. Partial case-insensitive matches are supported."),
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Returns only flower types whose curated season includes that month, for example 4 for wisteria or 6 for hydrangea."),
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

  // ── Tool: get_fruit_seasons ──

  server.registerTool(
    "get_fruit_seasons",
    {
      title: "Fruit Picking Season Calendar",
      description: "Use this when the user asks what fruit is in season in a given month or which month is best for strawberries, grapes, peaches, apples, and similar picking trips. Returns the fruit season calendar, peak months, best regions, and notes for 14 fruits. Call get_fruit_farms next if the user needs actual farm listings, map coordinates, or booking links.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Returns fruits in season during that month plus fruits starting the following month. Omit to return the full year calendar."),
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

          output += `Use get_fruit_farms to find specific farms with GPS coordinates.`;
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
        output += `Use get_fruit_farms to find specific farms with GPS coordinates.`;
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_japan_festivals ──

  server.registerTool(
    "get_japan_festivals",
    {
      title: "Japan Seasonal Festivals",
      description: "Use this when the user wants recurring Japan events to plan around, such as fireworks, matsuri, or winter festivals. Returns curated events with typical dates, attendance, official URLs, notes, and GPS coordinates. Do not use this for bloom timing, one-off concerts, or weather forecasts.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional month number from 1 to 12. Useful examples: 7 or 8 for fireworks season, 10 or 11 for autumn matsuri, and 1 or 2 for winter events."),
        type: z.enum(["all", "fireworks", "matsuri", "winter"]).optional()
          .describe("Optional event type filter. Allowed values: 'all', 'fireworks', 'matsuri', or 'winter'. Omit or use 'all' to return every event type."),
        prefecture: z.string().optional()
          .describe("Optional prefecture filter such as 'Tokyo', 'Kyoto', 'Osaka', or 'Hokkaido'. Partial case-insensitive matches are supported."),
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

  // ── Tool: get_fruit_farms ──

  server.registerTool(
    "get_fruit_farms",
    {
      title: "Fruit Picking Farms",
      description: "Use this when the user needs actual fruit-picking farms, booking links, and map coordinates. Returns farms from the local dataset, and month filtering automatically narrows results to fruits that are in season. If the user only asks which fruit is in season, call get_fruit_seasons first.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional()
          .describe("Optional travel month from 1 to 12. Filters to farms with at least one fruit in season during that month, for example 5 for May strawberry farms."),
        fruit: z.string().optional()
          .describe("Optional fruit name such as 'Strawberry', 'Apple', 'Grape', 'Peach', 'Cherry', or 'Mikan'. Matching is case-insensitive. Use with or instead of month."),
        region: z.string().optional()
          .describe("Optional prefecture, city, or region substring such as 'Yamanashi', 'Nagano', 'Aomori', or 'Tokyo'. Partial case-insensitive matching is supported against farm names and addresses."),
        limit: z.number().int().min(1).max(100).optional()
          .describe("Optional maximum number of farms to return. Default is 30 and the hard maximum is 100."),
      },
      annotations: READONLY,
    },
    async ({ month, fruit, region, limit = 30 }) => {
      try {
        const data = STATIC_MCP.farms;
        if (!data) {
          return { content: [{ type: "text", text: "Farm data not available on this instance. The hosted version at seasons.kooexperience.com has 350+ farms." }], isError: true };
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
          return { content: [{ type: "text", text: `No farms found. Try get_fruit_seasons to see what's in season, then filter by a specific fruit.` }] };
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

// Log stats every hour
setInterval(() => {
  logger.info(`Stats: ${JSON.stringify(stats.toJSON())}`);
}, 60 * 60 * 1000).unref();

const isHttpMode = process.argv.includes("--http") || !!process.env.PORT;

// Register tools on the module-level server (for stdio mode)
const server = new McpServer({ name: "japan-seasons-mcp", version: "0.3.9" }, {
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

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
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
        version: "0.3.9",
        activeSessions: transports.size,
        ...stats.toJSON(),
      }));
      return;
    }

    if (url.pathname === "/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats.toJSON(), null, 2));
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
        await transports.get(sessionId)!.handleRequest(req, res);
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
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const bodyStr = Buffer.concat(chunks).toString();
      let parsedBody: any;
      try { parsedBody = JSON.parse(bodyStr); } catch { parsedBody = null; }

      const isInit = parsedBody?.method === "initialize" ||
        (Array.isArray(parsedBody) && parsedBody.some((m: any) => m.method === "initialize"));
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

      const sessionServer = new McpServer({ name: "japan-seasons-mcp", version: "0.3.9" }, {
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

    // Serve frontend static files
    const staticFiles: Record<string, { file: string; mime: string }> = {
      "/":         { file: "index.html", mime: "text/html; charset=utf-8" },
      "/app.css":  { file: "app.css",    mime: "text/css; charset=utf-8" },
      "/app.js":   { file: "app.js",     mime: "application/javascript; charset=utf-8" },
    };
    const staticEntry = staticFiles[url.pathname];
    if (staticEntry) {
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const filePath = join(__dirname, "..", "public", staticEntry.file);
        const content = readFileSync(filePath);
        const acceptsGzip = (req.headers["accept-encoding"] as string || "").includes("gzip");
        if (acceptsGzip) {
          const compressed = gzipSync(content);
          res.writeHead(200, {
            "Content-Type": staticEntry.mime,
            "Cache-Control": "public, max-age=300",
            "Content-Encoding": "gzip",
            "Vary": "Accept-Encoding",
          });
          res.end(compressed);
        } else {
          res.writeHead(200, { "Content-Type": staticEntry.mime, "Cache-Control": "public, max-age=300" });
          res.end(content);
        }
      } catch {
        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!DOCTYPE html><html><body><h1>japan-seasons-mcp</h1>
<p>MCP endpoint: <code>https://${req.headers.host}/mcp</code></p></body></html>`);
        } else {
          res.writeHead(404).end("Not found");
        }
      }
      return;
    }

    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, () => {
    logger.info(`japan-seasons-mcp HTTP server on port ${port}`);
    logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
    logger.info(`Rate limit: ${RATE_LIMIT_MAX} req/min per IP, max ${MAX_SESSIONS} sessions`);
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
      warmSpotsCache().catch((e: any) => logger.warn(`all-spots warm-up error: ${e.message}`));
    } catch (e: any) {
      logger.warn(`Cache warm-up error (non-fatal): ${e.message}`);
    }
  })();
}

main().catch((e) => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
