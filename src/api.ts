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

    // GET /api/weather?city=Tokyo
    if (pathname === "/api/weather") {
      const city = params.get("city");
      if (!city) { error(res, "Missing ?city= parameter"); return true; }
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
