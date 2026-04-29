import type { IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  getSakuraForecast,
  getSakuraSpots,
  getKawazuForecast,
  findCities,
  findBestRegions,
  findPrefCode,
  type SakuraSpot,
} from "./lib/sakura-forecast.js";
import { getKoyoForecast, getKoyoSpots } from "./lib/koyo.js";
import { getWeatherForecast } from "./lib/weather.js";
import { pMapSettled } from "./lib/fetch.js";
import { logger } from "./lib/logger.js";
import { TTL } from "./lib/cache.js";
import { durableCacheEnabled, readDurableTextCache, writeDurableTextCache } from "./lib/durable-cache.js";
import { JAPAN_BOUNDS, JAPAN_PREFECTURE_COUNT } from "./lib/constants.js";
import { DATE_RANGE_INPUT_HINT, parseDateRangeInputJst } from "./lib/dates.js";

// ── Minimal shared spot type ──────────────────────────────────────────────────
interface SpotRecord { lat?: number; lon?: number; name?: string; [key: string]: unknown; }

// ── Static JSON: read once at startup, served from memory on every request ──
// These files change only when you deploy new data — no need to re-read from disk.
function loadStatic(filename: string): unknown {
  const p = resolve(process.cwd(), "public", filename);
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}
const STATIC = {
  flowers:   loadStatic("flowers.json"),
  festivals: loadStatic("festivals.json"),
  farms:     loadStatic("fruit-farms.json"),
};

// ── Server-side caches — shared across users ──
// All-spots: 47 upstream requests → cache aggressively so only first user pays the cost.
// JMC publishes the daily sakura/koyo update at 09:00 JST, which is 00:00 UTC.
const ALL_SPOTS_CDN_TTL = TTL.SPOTS;
const ALL_SPOTS_STALE_TTL = 24 * 60 * 60 * 1000;
const allSpotsCache = new Map<string, { json: string; ts: number }>();
let allSpotsRefreshPromise: Promise<void> | null = null;
type AllSpotsKind = "sakura" | "koyo";

const spotWeatherCache = new Map<string, { data: unknown; ts: number }>();

function durableAllSpotsKey(kind: AllSpotsKind): string {
  return `all-spots-${kind}`;
}

function lastJmcUpdateMs(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const todayUpdateMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  return nowMs >= todayUpdateMs ? todayUpdateMs : todayUpdateMs - 24 * 60 * 60 * 1000;
}

function isAllSpotsFreshForJmcDay(ts: number): boolean {
  return ts >= lastJmcUpdateMs();
}

function allSpotsEntryStatus(entry: { json: string; ts: number } | null | undefined) {
  if (!entry) return { present: false };
  const ageSeconds = Math.max(0, Math.round((Date.now() - entry.ts) / 1000));
  return {
    present: true,
    freshForJmcDay: isAllSpotsFreshForJmcDay(entry.ts),
    updatedAt: new Date(entry.ts).toISOString(),
    ageSeconds,
    bytes: Buffer.byteLength(entry.json),
  };
}

export async function getApiCacheStatus() {
  const [sakuraDurable, koyoDurable] = await Promise.all([
    readDurableTextCache(durableAllSpotsKey("sakura")),
    readDurableTextCache(durableAllSpotsKey("koyo")),
  ]);
  return {
    jmcLastUpdate: new Date(lastJmcUpdateMs()).toISOString(),
    durableCacheEnabled: durableCacheEnabled(),
    allSpots: {
      sakura: {
        memory: allSpotsEntryStatus(allSpotsCache.get("sakura")),
        durable: allSpotsEntryStatus(sakuraDurable ? { json: sakuraDurable.body, ts: sakuraDurable.ts } : null),
      },
      koyo: {
        memory: allSpotsEntryStatus(allSpotsCache.get("koyo")),
        durable: allSpotsEntryStatus(koyoDurable ? { json: koyoDurable.body, ts: koyoDurable.ts } : null),
      },
    },
  };
}

function setAllSpotsCache(kind: AllSpotsKind, json: string, ts = Date.now()) {
  allSpotsCache.set(kind, { json, ts });
  if (!durableCacheEnabled()) return;
  writeDurableTextCache(durableAllSpotsKey(kind), json, ts).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`Durable all-spots cache write failed (${kind}): ${msg}`);
  });
}

async function getAllSpotsCache(kind: AllSpotsKind): Promise<{ json: string; ts: number } | undefined> {
  const cached = allSpotsCache.get(kind);
  if (cached) return cached;
  const durable = await readDurableTextCache(durableAllSpotsKey(kind));
  if (!durable) return undefined;
  if (Date.now() - durable.ts > ALL_SPOTS_STALE_TTL) return undefined;
  const entry = { json: durable.body, ts: durable.ts };
  allSpotsCache.set(kind, entry);
  logger.info(`Loaded durable all-spots cache (${kind})`);
  return entry;
}

function writeAllSpotsJson(res: ServerResponse, body: string, maxAge = TTL.FORECAST / 1000) {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Vary": "Accept-Encoding",
    "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=3600`,
  });
  res.end(body);
}

function refreshAllSpotsInBackground(reason: string) {
  if (allSpotsRefreshPromise) return;
  logger.info(`All-spots stale cache served; background refresh starting (${reason})`);
  warmSpotsCache().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`All-spots background refresh failed: ${msg}`);
  });
}

// ── Response helpers ──
function json(res: ServerResponse, data: unknown, status = 200, maxAge = 0, immutable = false) {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Vary": "Accept-Encoding",
  };
  if (maxAge > 0) {
    headers["Cache-Control"] = `public, max-age=${maxAge}, stale-while-revalidate=60${immutable ? ", immutable" : ""}`;
  }
  res.writeHead(status, headers);
  res.end(body);
}

function error(res: ServerResponse, msg: string, status = 400) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
}

// Strip fields not needed for map rendering — reduces all-spots payload by ~30%
function slimSakuraSpot(s: SakuraSpot) {
  return {
    lat: s.lat, lon: s.lon,
    name: s.name, nameRomaji: s.nameRomaji,
    prefecture: s.prefecture,
    code: s.code, // first 2 chars = pref code for JMA link
    bloomRate: s.bloomRate, fullRate: s.fullRate,
    bloomForecast: s.bloomForecast, fullBloomForecast: s.fullBloomForecast,
    status: s.status,
    displayStatus: s.displayStatus,
    statusSource: s.statusSource,
    statusUpdated: s.statusUpdated,
    observationState: s.observationState,
    observationStatus: s.observationStatus,
    observationUpdated: s.observationUpdated,
    observationFresh: s.observationFresh,
    phase: s.phase,
  };
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  params: URLSearchParams
): Promise<boolean> {
  try {
    // GET /api/sakura/forecast?city=Tokyo
    if (pathname === "/api/sakura/forecast") {
      const forecast = await getSakuraForecast();
      const city = params.get("city");
      if (city) {
        const cities = findCities(forecast, city);
        json(res, { cities }, 200, TTL.FORECAST / 1000);
      } else {
        json(res, forecast, 200, TTL.FORECAST / 1000);
      }
      return true;
    }

    // GET /api/sakura/spots?pref=Tokyo (or pref=13)
    if (pathname === "/api/sakura/spots") {
      const pref = params.get("pref");
      if (!pref) { error(res, "Missing ?pref= parameter"); return true; }
      const safePref = pref.replace(/[<>&"]/g, "").trim();
      const prefCode = findPrefCode(safePref);
      if (!prefCode) { error(res, `Prefecture "${safePref}" not found`); return true; }
      const spots = await getSakuraSpots(prefCode);
      json(res, spots, 200, TTL.SPOTS / 1000);
      return true;
    }

    // GET /api/sakura/best?start=2026-04-10&end=2026-04-15
    if (pathname === "/api/sakura/best") {
      const start = params.get("start");
      const end = params.get("end");
      if (!start || !end) { error(res, "Missing ?start= and ?end= parameters"); return true; }
      const range = parseDateRangeInputJst(start, end);
      if (!range) {
        error(res, `Invalid date format. ${DATE_RANGE_INPUT_HINT}`);
        return true;
      }
      const forecast = await getSakuraForecast();
      const matches = findBestRegions(forecast, range.startDate, range.endDate);
      json(res, { start, end, matches });
      return true;
    }

    // GET /api/sakura/all-spots — load all 1,012 spots across Japan
    if (pathname === "/api/sakura/all-spots") {
      const cached = await getAllSpotsCache("sakura");
      if (cached) {
        const age = Date.now() - cached.ts;
        if (isAllSpotsFreshForJmcDay(cached.ts)) {
          writeAllSpotsJson(res, cached.json, ALL_SPOTS_CDN_TTL / 1000);
          return true;
        }
        if (age < ALL_SPOTS_STALE_TTL) {
          refreshAllSpotsInBackground("sakura");
          writeAllSpotsJson(res, cached.json, 60);
          return true;
        }
      }
      if (allSpotsRefreshPromise) {
        await allSpotsRefreshPromise;
        const warmed = allSpotsCache.get("sakura");
        if (warmed) {
          writeAllSpotsJson(res, warmed.json, ALL_SPOTS_CDN_TTL / 1000);
          return true;
        }
      }
      const allSpots: unknown[] = [];
      const prefCodes = Array.from({ length: JAPAN_PREFECTURE_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));
      const results = await pMapSettled(prefCodes, (code) => getSakuraSpots(code, { includeObservations: false }), 5);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.spots) {
          allSpots.push(...r.value.spots.map(slimSakuraSpot));
        } else if (r.status === "rejected") logger.warn(`all-spots sakura: ${r.reason}`);
      }
      const data = { totalSpots: allSpots.length, spots: allSpots };
      const jsonStr = JSON.stringify(data);
      setAllSpotsCache("sakura", jsonStr);
      writeAllSpotsJson(res, jsonStr, ALL_SPOTS_CDN_TTL / 1000);
      return true;
    }

    // GET /api/kawazu
    if (pathname === "/api/kawazu") {
      const data = await getKawazuForecast();
      json(res, data, 200, TTL.FORECAST / 1000);
      return true;
    }

    // GET /api/koyo/forecast
    if (pathname === "/api/koyo/forecast") {
      const data = await getKoyoForecast();
      json(res, data, 200, TTL.FORECAST / 1000);
      return true;
    }

    // GET /api/koyo/spots?pref=Kyoto
    if (pathname === "/api/koyo/spots") {
      const pref = params.get("pref");
      if (!pref) { error(res, "Missing ?pref= parameter"); return true; }
      const safePref = pref.replace(/[<>&"]/g, "").trim();
      const prefCode = findPrefCode(safePref);
      if (!prefCode) { error(res, `Prefecture "${safePref}" not found`); return true; }
      const spots = await getKoyoSpots(prefCode);
      json(res, spots, 200, TTL.SPOTS / 1000);
      return true;
    }

    // GET /api/koyo/all-spots — load all koyo spots across 47 prefectures
    if (pathname === "/api/koyo/all-spots") {
      const cached = await getAllSpotsCache("koyo");
      if (cached) {
        const age = Date.now() - cached.ts;
        if (isAllSpotsFreshForJmcDay(cached.ts)) {
          writeAllSpotsJson(res, cached.json, ALL_SPOTS_CDN_TTL / 1000);
          return true;
        }
        if (age < ALL_SPOTS_STALE_TTL) {
          refreshAllSpotsInBackground("koyo");
          writeAllSpotsJson(res, cached.json, 60);
          return true;
        }
      }
      if (allSpotsRefreshPromise) {
        await allSpotsRefreshPromise;
        const warmed = allSpotsCache.get("koyo");
        if (warmed) {
          writeAllSpotsJson(res, warmed.json, ALL_SPOTS_CDN_TTL / 1000);
          return true;
        }
      }
      const allSpots: unknown[] = [];
      const prefCodes = Array.from({ length: JAPAN_PREFECTURE_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));
      const results = await pMapSettled(prefCodes, (code) => getKoyoSpots(code), 5);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.spots) allSpots.push(...r.value.spots);
        else if (r.status === "rejected") logger.warn(`all-spots koyo: ${r.reason}`);
      }
      const data = { totalSpots: allSpots.length, spots: allSpots };
      const jsonStr = JSON.stringify(data);
      setAllSpotsCache("koyo", jsonStr);
      writeAllSpotsJson(res, jsonStr, ALL_SPOTS_CDN_TTL / 1000);
      return true;
    }

    // GET /api/fruit/farms — in-memory static data
    if (pathname === "/api/fruit/farms") {
      if (STATIC.farms) json(res, STATIC.farms, 200, TTL.HISTORICAL / 1000, true); // curated, immutable until deploy
      else json(res, { spots: [], scraped_at: null, total: 0, error: "Farm data not yet available." }, 200);
      return true;
    }

    // GET /api/flowers — in-memory static data, 24-hour CDN cache
    if (pathname === "/api/flowers") {
      if (STATIC.flowers) json(res, STATIC.flowers, 200, TTL.HISTORICAL / 1000, true); // curated, immutable until deploy
      else json(res, { spots: [], total: 0, error: "Flowers data not available." }, 200);
      return true;
    }

    // GET /api/festivals — in-memory static data, 24-hour CDN cache
    if (pathname === "/api/festivals") {
      if (STATIC.festivals) json(res, STATIC.festivals, 200, TTL.HISTORICAL / 1000, true); // curated, immutable until deploy
      else json(res, { spots: [], total: 0, error: "Festivals data not available." }, 200);
      return true;
    }

    // GET /api/weather?lat=35.69&lon=139.69  (spot weather, Open-Meteo, server-side cached)
    // GET /api/weather?city=Tokyo             (city weather, JMA)
    if (pathname === "/api/weather") {
      const latStr = params.get("lat");
      const lonStr = params.get("lon");
      if (latStr && lonStr) {
        const latF = parseFloat(latStr);
        const lonF = parseFloat(lonStr);
        if (isNaN(latF) || isNaN(lonF) || latF < JAPAN_BOUNDS.lat.min || latF > JAPAN_BOUNDS.lat.max || lonF < JAPAN_BOUNDS.lon.min || lonF > JAPAN_BOUNDS.lon.max) { error(res, "Invalid coordinates"); return true; }
        const key = `${latF.toFixed(3)},${lonF.toFixed(3)}`;
        const cached = spotWeatherCache.get(key);
        if (cached && Date.now() - cached.ts < TTL.WEATHER) {
          json(res, cached.data, 200, TTL.WEATHER_CDN / 1000);
          return true;
        }
        try {
          const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latF.toFixed(4)}&longitude=${lonF.toFixed(4)}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=3`;
          const r = await fetch(omUrl);
          if (!r.ok) throw new Error(`open-meteo ${r.status}`);
          const data = await r.json();
          spotWeatherCache.set(key, { data, ts: Date.now() });
          json(res, data, 200, TTL.WEATHER_CDN / 1000);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.error(`Weather fetch error [${pathname}]: ${msg}`);
          json(res, { error: "Weather unavailable" }, 503);
        }
        return true;
      }
      const city = params.get("city");
      if (!city) { error(res, "Missing ?lat=&lon= or ?city= parameter"); return true; }
      const data = await getWeatherForecast(city);
      json(res, data);
      return true;
    }

    return false; // not an API route
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`API error [${pathname}]: ${msg}`);
    error(res, "An internal error occurred. Please try again.", 500);
    return true;
  }
}

// Called at server startup to pre-warm the all-spots cache before the first visitor arrives.
export async function warmSpotsCache(): Promise<void> {
  if (allSpotsRefreshPromise) return allSpotsRefreshPromise;
  allSpotsRefreshPromise = warmSpotsCacheImpl()
    .finally(() => { allSpotsRefreshPromise = null; });
  return allSpotsRefreshPromise;
}

async function warmSpotsCacheImpl(): Promise<void> {
  const prefCodes = Array.from({ length: JAPAN_PREFECTURE_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));

  const cachedSakura = await getAllSpotsCache("sakura");
  if (cachedSakura && isAllSpotsFreshForJmcDay(cachedSakura.ts)) {
    logger.info("Cache warm: sakura all-spots loaded from durable cache");
  } else {
    const sakuraResults = await pMapSettled(prefCodes, (code) => getSakuraSpots(code, { includeObservations: false }), 5);
    const sakuraSpots: unknown[] = [];
    for (const r of sakuraResults) {
      if (r.status === "fulfilled" && r.value.spots) {
        sakuraSpots.push(...r.value.spots.map(slimSakuraSpot));
      }
    }
    const sakuraData = { totalSpots: sakuraSpots.length, spots: sakuraSpots };
    setAllSpotsCache("sakura", JSON.stringify(sakuraData));
    logger.info(`Cache warm: sakura all-spots ${sakuraSpots.length} spots`);
  }

  const cachedKoyo = await getAllSpotsCache("koyo");
  if (cachedKoyo && isAllSpotsFreshForJmcDay(cachedKoyo.ts)) {
    logger.info("Cache warm: koyo all-spots loaded from durable cache");
  } else {
    const koyoResults = await pMapSettled(prefCodes, (code) => getKoyoSpots(code), 5);
    const koyoSpots: unknown[] = [];
    for (const r of koyoResults) {
      if (r.status === "fulfilled" && r.value.spots) koyoSpots.push(...r.value.spots);
    }
    const koyoData = { totalSpots: koyoSpots.length, spots: koyoSpots };
    setAllSpotsCache("koyo", JSON.stringify(koyoData));
    logger.info(`Cache warm: koyo all-spots ${koyoSpots.length} spots`);
  }
}
