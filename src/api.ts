import type { IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
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

// Server-side weather cache keyed by "lat,lon" (1-hour TTL, shared across users)
const spotWeatherCache = new Map<string, { data: unknown; ts: number }>();

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
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
        json(res, { cities });
      } else {
        json(res, forecast);
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
      json(res, spots);
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
      json(res, data);
      return true;
    }

    // GET /api/koyo/forecast
    if (pathname === "/api/koyo/forecast") {
      const data = await getKoyoForecast();
      json(res, data);
      return true;
    }

    // GET /api/koyo/spots?pref=Kyoto
    if (pathname === "/api/koyo/spots") {
      const pref = params.get("pref");
      if (!pref) { error(res, "Missing ?pref= parameter"); return true; }
      const prefCode = findPrefCode(pref);
      if (!prefCode) { error(res, `Prefecture "${pref}" not found`); return true; }
      const spots = await getKoyoSpots(prefCode);
      json(res, spots);
      return true;
    }

    // GET /api/fruit/farms — serve cached Navitime farm data
    if (pathname === "/api/fruit/farms") {
      try {
        const farmsPath = resolve(process.cwd(), "public/fruit-farms.json");
        const raw = readFileSync(farmsPath, "utf-8");
        const data = JSON.parse(raw);
        json(res, data);
      } catch {
        json(res, { spots: [], scraped_at: null, total: 0, error: "Farm data not yet available. Run scrape-fruit-farms.py to populate." });
      }
      return true;
    }

    // GET /api/flowers — serve curated seasonal flower spots (wisteria, hydrangea, etc.)
    if (pathname === "/api/flowers") {
      try {
        const flowersPath = resolve(process.cwd(), "public/flowers.json");
        const raw = readFileSync(flowersPath, "utf-8");
        const data = JSON.parse(raw);
        json(res, data);
      } catch {
        json(res, { spots: [], total: 0, error: "Flowers data not available." });
      }
      return true;
    }

    // GET /api/festivals — serve curated recurring Japanese festivals
    if (pathname === "/api/festivals") {
      try {
        const festivalsPath = resolve(process.cwd(), "public/festivals.json");
        const raw = readFileSync(festivalsPath, "utf-8");
        const data = JSON.parse(raw);
        json(res, data);
      } catch {
        json(res, { spots: [], total: 0, error: "Festivals data not available." });
      }
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
          json(res, cached.data);
          return true;
        }
        try {
          const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latF.toFixed(4)}&longitude=${lonF.toFixed(4)}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=3`;
          const r = await fetch(omUrl);
          if (!r.ok) throw new Error(`open-meteo ${r.status}`);
          const data = await r.json();
          spotWeatherCache.set(key, { data, ts: Date.now() });
          json(res, data);
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
