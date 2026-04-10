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
} from "./lib/sakura-forecast.js";
import { getKoyoForecast, getKoyoSpots } from "./lib/koyo.js";
import { getWeatherForecast } from "./lib/weather.js";

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

// ── Server-side weather cache: keyed by "lat,lon", 1-hour TTL ──
// Shared across users — second person to open the same spot gets instant response.
const spotWeatherCache = new Map<string, { data: unknown; ts: number }>();

// ── Response helpers ──
function json(res: ServerResponse, data: unknown, status = 200, maxAge = 0) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (maxAge > 0) headers["Cache-Control"] = `public, max-age=${maxAge}, stale-while-revalidate=60`;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
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
        json(res, { cities }, 200, 3600);
      } else {
        json(res, forecast, 200, 3600);
      }
      return true;
    }

    // GET /api/sakura/spots?pref=Tokyo (or pref=13)
    if (pathname === "/api/sakura/spots") {
      const pref = params.get("pref");
      if (!pref) { error(res, "Missing ?pref= parameter"); return true; }
      const prefCode = findPrefCode(pref);
      if (!prefCode) { error(res, `Prefecture "${pref}" not found`); return true; }
      const spots = await getSakuraSpots(prefCode);
      json(res, spots, 200, 10800); // 3 hours
      return true;
    }

    // GET /api/sakura/best?start=2026-04-10&end=2026-04-15
    if (pathname === "/api/sakura/best") {
      const start = params.get("start");
      const end = params.get("end");
      if (!start || !end) { error(res, "Missing ?start= and ?end= parameters"); return true; }
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        error(res, "Invalid date format. Use YYYY-MM-DD.");
        return true;
      }
      const forecast = await getSakuraForecast();
      const matches = findBestRegions(forecast, startDate, endDate);
      json(res, { start, end, matches });
      return true;
    }

    // GET /api/sakura/all-spots — load all 1,012 spots across Japan
    if (pathname === "/api/sakura/all-spots") {
      const allSpots: any[] = [];
      const prefCodes = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0"));
      const results = await Promise.allSettled(
        prefCodes.map(code => getSakuraSpots(code))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.spots) {
          allSpots.push(...r.value.spots);
        }
      }
      json(res, { totalSpots: allSpots.length, spots: allSpots });
      return true;
    }

    // GET /api/kawazu
    if (pathname === "/api/kawazu") {
      const data = await getKawazuForecast();
      json(res, data, 200, 3600);
      return true;
    }

    // GET /api/koyo/forecast
    if (pathname === "/api/koyo/forecast") {
      const data = await getKoyoForecast();
      json(res, data, 200, 3600);
      return true;
    }

    // GET /api/koyo/spots?pref=Kyoto
    if (pathname === "/api/koyo/spots") {
      const pref = params.get("pref");
      if (!pref) { error(res, "Missing ?pref= parameter"); return true; }
      const prefCode = findPrefCode(pref);
      if (!prefCode) { error(res, `Prefecture "${pref}" not found`); return true; }
      const spots = await getKoyoSpots(prefCode);
      json(res, spots, 200, 10800); // 3 hours
      return true;
    }

    // GET /api/fruit/farms — in-memory static data
    if (pathname === "/api/fruit/farms") {
      if (STATIC.farms) json(res, STATIC.farms, 200, 86400); // 24 hours
      else json(res, { spots: [], scraped_at: null, total: 0, error: "Farm data not yet available." }, 200);
      return true;
    }

    // GET /api/flowers — in-memory static data, 24-hour CDN cache
    if (pathname === "/api/flowers") {
      if (STATIC.flowers) json(res, STATIC.flowers, 200, 86400);
      else json(res, { spots: [], total: 0, error: "Flowers data not available." }, 200);
      return true;
    }

    // GET /api/festivals — in-memory static data, 24-hour CDN cache
    if (pathname === "/api/festivals") {
      if (STATIC.festivals) json(res, STATIC.festivals, 200, 86400);
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
        if (isNaN(latF) || isNaN(lonF)) { error(res, "Invalid coordinates"); return true; }
        const key = `${latF.toFixed(2)},${lonF.toFixed(2)}`;
        const cached = spotWeatherCache.get(key);
        if (cached && Date.now() - cached.ts < 3_600_000) {
          json(res, cached.data, 200, 1800); // 30-min CDN cache on top of server cache
          return true;
        }
        try {
          const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latF.toFixed(4)}&longitude=${lonF.toFixed(4)}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=3`;
          const r = await fetch(omUrl);
          if (!r.ok) throw new Error(`open-meteo ${r.status}`);
          const data = await r.json();
          spotWeatherCache.set(key, { data, ts: Date.now() });
          json(res, data, 200, 1800);
        } catch {
          json(res, { error: "Weather unavailable" });
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
  } catch (e: any) {
    error(res, e.message, 500);
    return true;
  }
}
