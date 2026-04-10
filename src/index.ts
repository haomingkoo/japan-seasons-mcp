#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";
import { handleApiRequest } from "./api.js";
import {
  getSakuraForecast,
  getSakuraSpots,
  getKawazuForecast,
  findCities,
  findBestRegions,
  findPrefCode,
  getAvailablePrefectures,
  formatDate,
  type SakuraCity,
} from "./lib/sakura-forecast.js";
import { getKoyoForecast, getKoyoSpots, formatDate as formatKoyoDate } from "./lib/koyo.js";
import { getWeatherForecast } from "./lib/weather.js";
import { WEATHER_CITY_IDS } from "./lib/areas.js";

// ─── Shared tool & prompt registration ───────────────────────────────────────

function registerAllTools(server: McpServer) {

  // ── Prompt: plan_japan_trip ──

  server.prompt(
    "plan_japan_trip",
    "Guide for planning a seasonal trip to Japan — cherry blossom, autumn leaves, fruit picking, wisteria, hydrangea, and more. Use this when someone wants to visit Japan and see seasonal experiences.",
    { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12' or 'June 20-July 3'") },
    async ({ travel_dates }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Help me plan a seasonal trip to Japan${travel_dates ? ` for ${travel_dates}` : ""}.

Use the japan-seasons-mcp tools based on the travel month:

## By season

**Jan-Feb** — Kawazu cherry (deep pink, Izu Peninsula):
- get_kawazu_cherry

**Late Mar – May** — Cherry blossom (sakura):
- get_sakura_forecast → big picture, 48 cities
- get_sakura_best_dates → match travel dates to bloom cities
- get_sakura_spots → 1,012 specific parks/temples with bloom % and GPS
- get_flowers (type=wisteria) → wisteria season starts late Apr

**Apr-May** — Wisteria (fuji):
- get_flowers with type=wisteria → 13 curated spots (Ashikaga, Kawachi, Kameido Tenjin, Byodoin, Kasuga Taisha...)

**Jun-Jul** — Hydrangea (ajisai):
- get_flowers with type=hydrangea → 15 curated spots (Kamakura temples, Kyoto temples, Yatadera...)

**Jul-Aug** — Fireworks & summer matsuri:
- get_festivals with type=fireworks → Sumida River, Nagaoka, Omagari, PL Osaka, Miyajima... (official URLs included)
- get_festivals with type=matsuri → Gion Matsuri, Tenjin Matsuri, Nebuta, Awa Odori...

**May, Sep-Nov** — Traditional matsuri:
- get_festivals → Sanja, Aoi, Hakata Dontaku (May), Kishiwada Danjiri (Sep), Jidai, Kurama Fire, Takayama (Oct-Nov)

**Jan-Feb** — Winter events:
- get_festivals with type=winter → Sapporo Snow Festival, Yokote Kamakura, Shirakawa-go illumination...

**Year-round** — Fruit picking:
- get_fruit_seasons → which fruits are in season for the travel month
- get_fruit_farms → 350+ farms with GPS, filterable by fruit type and region

**Oct-Dec** — Autumn leaves (koyo):
- get_koyo_forecast → maple & ginkgo timing, 50+ cities
- get_koyo_spots → 687 viewing spots with peak windows

## Bloom scale (sakura, official JMA)
- Bloom rate: 0-59% bud → 60-84% swelling → 85-99% opening → 100% first bloom
- Full rate: 0-19% just opened → 20-69% partial → 70-89% 70% → 90-100% mankai (満開)

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
  server.prompt(
    "plan_sakura_trip",
    "Guide for planning a cherry blossom viewing trip to Japan. Use plan_japan_trip for full seasonal coverage.",
    { travel_dates: z.string().optional().describe("Travel date range, e.g. 'April 5-12'") },
    async ({ travel_dates }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Help me plan a cherry blossom trip to Japan${travel_dates ? ` for ${travel_dates}` : ""}. Use get_sakura_forecast, get_sakura_best_dates, get_sakura_spots, and get_kawazu_cherry. Also see plan_japan_trip for full year-round seasonal coverage.`,
        },
      }],
    })
  );

  // ── Tool: get_sakura_forecast ──

  server.tool(
    "get_sakura_forecast",
    "Get cherry blossom (sakura) bloom forecast for 48 major Japanese cities. Returns forecast dates, actual observation dates, historical averages, and current bloom status. Start here for the big picture, then use get_sakura_spots to drill into specific viewing spots. Data from Japan Meteorological Corporation, updated daily.",
    {
      city: z.string().optional().describe(
        "City or region to search (e.g. 'Tokyo', 'Kyoto', 'Hokkaido', 'Tohoku'). Omit to get all cities."
      ),
    },
    async ({ city }) => {
      try {
        const forecast = await getSakuraForecast();
        if (city) {
          const cities = findCities(forecast, city);
          if (cities.length === 0) {
            return { content: [{ type: "text", text: `No sakura forecast found for "${city}". Try city, prefecture, or region names.` }] };
          }
          return { content: [{ type: "text", text: formatCityResults(cities) }] };
        }
        let output = `# Sakura Forecast ${new Date().getFullYear()}\nSource: ${forecast.source}\nTotal observation cities: ${forecast.totalCities}\n\n`;
        for (const region of forecast.regions) {
          output += `## ${region.nameEn} (${region.name})\n`;
          if (region.comment.length > 0) output += `> ${region.comment[0]}\n\n`;
          output += formatCityResults(region.cities) + "\n";
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_sakura_spots ──

  server.tool(
    "get_sakura_spots",
    "Get detailed cherry blossom info for individual viewing spots in a Japanese prefecture. Returns 1000+ spots across Japan with bloom percentage (0-100%), full bloom percentage, GPS coordinates, and forecast dates. Data from Japan Meteorological Corporation, updated daily at 9 AM JST.",
    {
      prefecture: z.string().describe("Prefecture name or code (e.g. 'Tokyo', 'Kyoto', '13')."),
    },
    async ({ prefecture }) => {
      try {
        const prefCode = findPrefCode(prefecture);
        if (!prefCode) {
          return { content: [{ type: "text", text: `Prefecture "${prefecture}" not found.\n\n${getAvailablePrefectures().join("\n")}` }], isError: true };
        }
        const result = await getSakuraSpots(prefCode);
        let output = `# Sakura Spots — ${result.prefecture}\nSource: ${result.source}\nLast updated: ${result.lastUpdated}\nTotal spots: ${result.spots.length}\n\n`;
        output += `## Bloom Scale\nBloom rate: 0-59% bud → 60-84% swelling → 85-99% opening → 100% first bloom\nFull bloom rate: 0-19% just opened → 20-39% 30% → 40-69% 50% → 70-89% 70% → 90-100% full bloom\n\n`;
        if (result.jmaStation) {
          const jma = result.jmaStation;
          output += `## JMA Station: ${jma.name}\n- Bloom: **${jma.bloomRate}%** | Full bloom: **${jma.fullRate}%**\n`;
          output += `- Bloom: ${formatDate(jma.bloomForecast)}${jma.bloomObservation ? ` → observed ${formatDate(jma.bloomObservation)}` : ""} (avg ${jma.bloomNormal ?? "N/A"})\n`;
          output += `- Full bloom: ${formatDate(jma.fullForecast)}${jma.fullObservation ? ` → observed ${formatDate(jma.fullObservation)}` : ""} (avg ${jma.fullNormal ?? "N/A"})\n\n`;
        }
        output += `## Spots\n\n`;
        for (const spot of result.spots) {
          output += `### ${spot.name}${spot.nameReading ? ` (${spot.nameReading})` : ""}\n`;
          output += `- **${spot.status}**\n`;
          output += `- Bloom: **${spot.bloomRate}%** → Full bloom: **${spot.fullRate}%**\n`;
          output += `- Forecast: ${formatDate(spot.bloomForecast)}${spot.fullBloomForecast ? ` → full ${formatDate(spot.fullBloomForecast)}` : ""}\n`;
          output += `- 📍 ${spot.lat}, ${spot.lon}\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_sakura_best_dates ──

  server.tool(
    "get_sakura_best_dates",
    "Find the best cities to visit for cherry blossoms given your travel dates. Matches your dates against full bloom dates across 48 major cities. Best viewing is typically full bloom ± 3 days. Follow up with get_sakura_spots.",
    {
      start_date: z.string().describe("Travel start date (YYYY-MM-DD)"),
      end_date: z.string().describe("Travel end date (YYYY-MM-DD)"),
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
          return { content: [{ type: "text", text: `No cities in bloom during ${start_date} to ${end_date}.\n\nSeason: Okinawa Jan-Feb, Kyushu/Kansai late Mar, Kanto early Apr, Tohoku mid Apr, Hokkaido late Apr-May.\nTry get_kawazu_cherry for Jan-Feb early blooms.` }] };
        }
        let output = `# Best cities for sakura: ${start_date} to ${end_date}\n\n${matches.length} cities with bloom in your window.\nUse get_sakura_spots to find specific parks.\n\n`;
        output += formatCityResults(matches);
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_kawazu_cherry ──

  server.tool(
    "get_kawazu_cherry",
    "Get Kawazu cherry blossom (河津桜) forecast — the early-blooming deep pink variety in Izu Peninsula, Shizuoka. Blooms January-February, months before standard Somei-Yoshino. 9 spots with bloom percentages. Data from Japan Meteorological Corporation.",
    {},
    async () => {
      try {
        const result = await getKawazuForecast();
        let output = `# Kawazu Cherry (河津桜) Forecast\nSource: ${result.source}\nLast updated: ${result.lastUpdated}\n\n`;
        output += `Kawazu cherry is a deep pink variety blooming Jan-Feb in Izu Peninsula, south of Mt. Fuji.\n\n`;
        if (result.forecastComment) output += `## Forecast\n${result.forecastComment}\n\n`;
        output += `## Map\n${result.forecastMapUrlEn || result.forecastMapUrl}\n\n`;
        output += `## Spots (${result.spots.length})\n\n`;
        for (const spot of result.spots) {
          output += `### ${spot.name}\n- **${spot.status}**\n- Bloom: **${spot.bloomRate}%** → Full: **${spot.fullRate}%**\n`;
          output += `- Forecast: ${formatDate(spot.bloomForecast)} → full ${formatDate(spot.fullBloomForecast)}\n- 📍 ${spot.lat}, ${spot.lon}\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_koyo_forecast ──

  server.tool(
    "get_koyo_forecast",
    "Get autumn leaves (koyo/紅葉) forecast for Japan. Per-city maple and ginkgo dates, forecast maps, and regional commentary. 50+ observation cities. For Oct-Dec trips. Follow up with get_koyo_spots for specific viewing spots. Data from Japan Meteorological Corporation.",
    {},
    async () => {
      try {
        const forecast = await getKoyoForecast();
        let output = `# Autumn Leaves (Koyo) Forecast\nSource: ${forecast.source}\nLast updated: ${forecast.lastUpdated}\n\n`;
        if (forecast.forecastComment) output += `## Summary\n${forecast.forecastComment}\n\n`;
        output += `## Maps\n- Maple: ${forecast.mapleForecastMapUrlEn || forecast.mapleForecastMapUrl}\n- Ginkgo: ${forecast.ginkgoForecastMapUrlEn || forecast.ginkgoForecastMapUrl}\n\n`;
        for (const region of forecast.regions) {
          output += `## ${region.name}\n`;
          for (const city of region.cities) {
            output += `### ${city.name} (${city.prefName})\n`;
            if (city.maple) {
              output += `- **Maple (${city.maple.species}):** ${formatKoyoDate(city.maple.forecast)} — ${city.maple.normalDiffClass}`;
              if (city.maple.normalDiffDays > 0) output += ` (${city.maple.normalDiffDays} days)`;
              output += `\n`;
            }
            if (city.ginkgo) {
              output += `- **Ginkgo:** ${formatKoyoDate(city.ginkgo.forecast)} — ${city.ginkgo.normalDiffClass}`;
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

  server.tool(
    "get_koyo_spots",
    "Get autumn leaves viewing spots in a Japanese prefecture. 687 spots across Japan with best viewing window (start/peak/end dates), leaf type, popularity rating, and GPS. Famous spots like Arashiyama, Eikando, Tofukuji. Data from Japan Meteorological Corporation.",
    {
      prefecture: z.string().describe("Prefecture name or code (e.g. 'Kyoto', 'Tokyo', '26')."),
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
          output += `- Best: ${formatKoyoDate(spot.bestStart)} → peak ${formatKoyoDate(spot.bestPeak)} → end ${formatKoyoDate(spot.bestEnd)}\n`;
          output += `- 📍 ${spot.lat}, ${spot.lon}\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_weather_forecast ──

  server.tool(
    "get_weather_forecast",
    "Get 3-day weather forecast for a Japanese city. Temperature, rain probability, wind. Rain during bloom = faster petal fall. Data from Japan Meteorological Agency.",
    {
      city: z.string().describe(`City name. Available: ${Object.keys(WEATHER_CITY_IDS).join(", ")}`),
    },
    async ({ city }) => {
      try {
        const forecast = await getWeatherForecast(city);
        let output = `# ${forecast.title}\nPublished: ${forecast.publicTime}\n\n`;
        if (forecast.description) output += `${forecast.description}\n\n`;
        for (const day of forecast.forecasts) {
          output += `### ${day.dateLabel} (${day.date})\n**${day.telop}**\n`;
          if (day.detail.weather) output += `${day.detail.weather}\n`;
          const minC = day.temperature.min.celsius;
          const maxC = day.temperature.max.celsius;
          if (minC || maxC) output += `Temp: ${minC ?? "—"}°C / ${maxC ?? "—"}°C\n`;
          output += `Rain: ${day.chanceOfRain.T00_06} | ${day.chanceOfRain.T06_12} | ${day.chanceOfRain.T12_18} | ${day.chanceOfRain.T18_24}\n\n`;
        }
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_flowers ──

  server.tool(
    "get_flowers",
    "Get curated seasonal flower spots in Japan — plum blossom (ume, Jan-Mar), wisteria (fuji, Apr-May), and hydrangea (ajisai, Jun-Jul). Each spot includes official website URL, peak dates, GPS coordinates, and notes. 40 hand-picked spots at Japan's most famous locations (Mito Kairakuen, Dazaifu Tenmangu, Ashikaga Flower Park, Kawachi Wisteria Garden, Meigetsu-in, Hasedera, Mimurotoji, etc.).",
    {
      type: z.enum(["all", "plum", "wisteria", "hydrangea"]).optional()
        .describe("Filter by flower type. 'plum' = Jan-Mar season. 'wisteria' = Apr-May season. 'hydrangea' = Jun-Jul season. Omit for all."),
      prefecture: z.string().optional()
        .describe("Filter by prefecture, e.g. 'Kanagawa', 'Kyoto', 'Tokyo', 'Fukuoka'."),
      month: z.number().int().min(1).max(12).optional()
        .describe("Filter to spots in season for this month (1-12). April/May for wisteria, June/July for hydrangea."),
    },
    async ({ type, prefecture, month }) => {
      try {
        const flowersPath = resolve(process.cwd(), "public/flowers.json");
        if (!existsSync(flowersPath)) {
          return { content: [{ type: "text", text: "Flowers data not available on this instance." }], isError: true };
        }
        const raw = readFileSync(flowersPath, "utf-8");
        const data = JSON.parse(raw);
        let spots: any[] = data.spots || [];

        const SEASON_MONTHS: Record<string, number[]> = { plum: [1, 2, 3], wisteria: [4, 5], hydrangea: [6, 7] };

        if (type && type !== "all") spots = spots.filter((s: any) => s.type === type);
        if (prefecture) spots = spots.filter((s: any) => s.prefecture?.toLowerCase().includes(prefecture.toLowerCase()));
        if (month) {
          spots = spots.filter((s: any) => {
            const months = SEASON_MONTHS[s.type] || [];
            return months.includes(month);
          });
        }

        if (spots.length === 0) {
          return { content: [{ type: "text", text: `No flower spots found for the given filters. Wisteria is Apr-May; hydrangea is Jun-Jul.` }] };
        }

        const typeLabel = type && type !== "all" ? type : "all types";
        let output = `# Japan Flower Spots — ${typeLabel}\n`;
        output += `Source: seasons.kooexperience.com | Updated: ${data.updated}\n`;
        output += `Total: ${spots.length} spots\n\n`;
        output += `## Season Overview\n`;
        output += `- 🌸 **Plum Blossom (梅)** — January–March. Japan's first spring bloom, 4–6 weeks before cherry blossom. Atami blooms in late January.\n`;
        output += `- 💜 **Wisteria (藤)** — April–May. Famous for tunnel/dome structures, century-old vines.\n`;
        output += `- 💙 **Hydrangea (紫陽花)** — June–July. Kamakura is the top destination with 10+ spots.\n\n`;

        const byType: Record<string, any[]> = {};
        for (const s of spots) {
          if (!byType[s.type]) byType[s.type] = [];
          byType[s.type].push(s);
        }

        for (const [flowerType, flowerSpots] of Object.entries(byType)) {
          const emoji = flowerType === "plum" ? "🌸" : flowerType === "wisteria" ? "💜" : "💙";
          const season = flowerType === "plum" ? "January–March" : flowerType === "wisteria" ? "April–May" : "June–July";
          output += `## ${emoji} ${flowerType.charAt(0).toUpperCase() + flowerType.slice(1)} — ${season}\n\n`;
          for (const s of flowerSpots) {
            output += `### ${s.name}${s.nameJa ? ` (${s.nameJa})` : ""}\n`;
            output += `- **Prefecture:** ${s.prefecture} (${s.region})\n`;
            if (s.peakStart && s.peakEnd) output += `- **Peak:** ${s.peakStart} → ${s.peakEnd}\n`;
            if (s.note) output += `- **Note:** ${s.note}\n`;
            output += `- **Official site:** ${s.url}\n`;
            output += `- **GPS:** ${s.lat}, ${s.lon}\n\n`;
          }
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_fruit_seasons ──

  server.tool(
    "get_fruit_seasons",
    "Get the Japan fruit picking season calendar — which fruits are available when, peak months, best regions, and farm count. Use this to plan fruit picking experiences by travel month. Covers 14 fruits year-round: strawberry, cherry, peach, grape, apple, mikan, and more.",
    {
      month: z.number().int().min(1).max(12).optional()
        .describe("Month to check (1-12). Returns in-season and coming-soon fruits. Omit for full year calendar."),
    },
    async ({ month }) => {
      const FRUITS = [
        { name: "Strawberry", ja: "いちご", emoji: "🍓", months: [12,1,2,3,4,5], peak: [2,3,4], regions: ["Tochigi","Nagano","Chiba","Ibaraki","Hokkaido"], note: "Kyushu (Fukuoka) season ends ~April; May is Kanto & northern only" },
        { name: "Melon", ja: "メロン", emoji: "🍈", months: [5,6,7,8], peak: [6,7], regions: ["Hokkaido (Yubari)","Ibaraki","Kumamoto"], note: "Yubari King is Japan's most prized melon" },
        { name: "Cherry", ja: "さくらんぼ", emoji: "🍒", months: [6,7], peak: [6,7], regions: ["Yamagata","Hokkaido","Nagano","Aomori"], note: "Very short season — book farms early" },
        { name: "Watermelon", ja: "すいか", emoji: "🍉", months: [6,7,8], peak: [7], regions: ["Kumamoto","Yamagata","Chiba"] },
        { name: "Peach", ja: "もも", emoji: "🍑", months: [7,8,9], peak: [7,8], regions: ["Yamanashi","Fukushima","Nagano","Okayama"] },
        { name: "Blueberry", ja: "ブルーベリー", emoji: "🫐", months: [7,8,9], peak: [7,8], regions: ["Nagano","Chiba","Tokyo (suburbs)","Hokkaido"] },
        { name: "Grape", ja: "ぶどう", emoji: "🍇", months: [8,9,10,11], peak: [9,10], regions: ["Yamanashi","Nagano","Yamagata","Okayama"], note: "50+ varieties; shine muscat is very popular" },
        { name: "Pear", ja: "なし", emoji: "🍐", months: [8,9,10], peak: [8,9], regions: ["Tottori","Chiba","Ibaraki","Nagano"], note: "Japanese pears are round and crisp" },
        { name: "Fig", ja: "いちじく", emoji: "🍈", months: [8,9,10], peak: [9], regions: ["Aichi","Osaka","Hyogo"] },
        { name: "Apple", ja: "りんご", emoji: "🍎", months: [9,10,11], peak: [10,11], regions: ["Aomori","Nagano","Iwate","Yamagata"], note: "Aomori produces ~60% of Japan's apples" },
        { name: "Persimmon", ja: "柿", emoji: "🟠", months: [10,11,12], peak: [10,11], regions: ["Nara","Wakayama","Gifu","Fukuoka"] },
        { name: "Kiwi", ja: "キウイ", emoji: "🥝", months: [10,11,12], peak: [11], regions: ["Ehime","Kanagawa","Fukuoka"] },
        { name: "Chestnut", ja: "栗", emoji: "🌰", months: [9,10,11], peak: [9,10], regions: ["Ibaraki","Kumamoto","Ehime","Aichi"], note: "Japan's most prized variety is Tanba (Kyoto/Hyogo)" },
        { name: "Mikan", ja: "みかん", emoji: "🍊", months: [11,12,1], peak: [11,12], regions: ["Wakayama","Ehime","Shizuoka","Nagasaki"], note: "Japan's most popular winter citrus" },
      ];

      const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

  // ── Tool: get_festivals ──

  server.tool(
    "get_festivals",
    "Get major recurring Japanese festivals and events by month. Covers 52 curated events: fireworks (hanabi), matsuri (traditional festivals), and winter events. Each entry includes official URL, GPS coordinates, typical dates, and attendance figures. Great for planning around major events and booking accommodation early.",
    {
      month: z.number().int().min(1).max(12).optional()
        .describe("Filter to festivals occurring in this month (1-12). July/August = fireworks season; October/November = autumn matsuri; January/February = winter events."),
      type: z.enum(["all", "fireworks", "matsuri", "winter"]).optional()
        .describe("Filter by event type: 'fireworks' (hanabi), 'matsuri' (traditional festivals), 'winter' (snow/illumination events). Omit for all types."),
      prefecture: z.string().optional()
        .describe("Filter by prefecture, e.g. 'Tokyo', 'Kyoto', 'Osaka', 'Hokkaido'."),
    },
    async ({ month, type, prefecture }) => {
      try {
        const festivalsPath = resolve(process.cwd(), "public/festivals.json");
        if (!existsSync(festivalsPath)) {
          return { content: [{ type: "text", text: "Festivals data not available on this instance." }], isError: true };
        }
        const raw = readFileSync(festivalsPath, "utf-8");
        const data = JSON.parse(raw);
        let spots: any[] = data.spots || [];

        if (type && type !== "all") spots = spots.filter((s: any) => s.type === type);
        if (prefecture) spots = spots.filter((s: any) => s.prefecture?.toLowerCase().includes(prefecture.toLowerCase()));
        if (month) spots = spots.filter((s: any) => s.months?.includes(month));

        if (spots.length === 0) {
          return { content: [{ type: "text", text: `No festivals found for the given filters. Major seasons: fireworks Jul-Aug, autumn matsuri Sep-Nov, winter events Jan-Feb.` }] };
        }

        const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const TYPE_EMOJI: Record<string, string> = { fireworks: "🎆", matsuri: "🏮", winter: "❄️" };

        let output = `# Japan Festivals${month ? ` — ${MO[month-1]}` : ""}${type && type !== "all" ? ` — ${type}` : ""}\n`;
        output += `Source: seasons.kooexperience.com | ${spots.length} events\n\n`;
        output += `## Tips\n- Book accommodation months ahead for major festivals (Gion Matsuri, Nebuta, Sumida Fireworks)\n`;
        output += `- Fireworks season peaks July–August; winter events peak January–February\n\n`;

        const byType: Record<string, any[]> = {};
        for (const s of spots) {
          if (!byType[s.type]) byType[s.type] = [];
          byType[s.type].push(s);
        }

        for (const [fType, fSpots] of Object.entries(byType)) {
          output += `## ${TYPE_EMOJI[fType] || ""} ${fType.charAt(0).toUpperCase() + fType.slice(1)} (${fSpots.length})\n\n`;
          for (const s of fSpots) {
            output += `### ${s.name}${s.nameJa ? ` (${s.nameJa})` : ""}\n`;
            output += `- **When:** ${s.months.map((m: number) => MO[m-1]).join(", ")} — ${s.typicalDate}\n`;
            output += `- **Location:** ${s.prefecture} (${s.region})\n`;
            if (s.attendance) output += `- **Attendance:** ~${s.attendance.toLocaleString()} visitors\n`;
            if (s.note) output += `- **Note:** ${s.note}\n`;
            output += `- **Official site:** ${s.url}\n`;
            output += `- **GPS:** ${s.lat}, ${s.lon}\n\n`;
          }
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── Tool: get_fruit_farms ──

  server.tool(
    "get_fruit_farms",
    "Get fruit picking farms in Japan with GPS coordinates and booking links. 350+ farms scraped from Jalan and Navitime. Filter by fruit type or region. Use get_fruit_seasons first to find what's in season for your travel month.",
    {
      fruit: z.string().optional()
        .describe("Fruit to filter by, e.g. 'Strawberry', 'Apple', 'Grape', 'Peach', 'Cherry', 'Mikan'. Case-sensitive."),
      region: z.string().optional()
        .describe("Prefecture or city to filter by (partial match), e.g. 'Yamanashi', 'Nagano', 'Aomori'."),
      limit: z.number().int().min(1).max(100).optional()
        .describe("Max number of farms to return (default 30, max 100). Use with fruit/region filters for best results."),
    },
    async ({ fruit, region, limit = 30 }) => {
      try {
        const farmsPath = resolve(process.cwd(), "public/fruit-farms.json");
        if (!existsSync(farmsPath)) {
          return { content: [{ type: "text", text: "Farm data not available on this instance. The hosted version at seasons.kooexperience.com has 350+ farms." }], isError: true };
        }
        const raw = readFileSync(farmsPath, "utf-8");
        const data = JSON.parse(raw);
        let farms: any[] = data.spots || [];

        if (fruit) farms = farms.filter((f: any) => f.fruits?.includes(fruit));
        if (region) farms = farms.filter((f: any) =>
          f.address?.toLowerCase().includes(region.toLowerCase()) ||
          f.name?.toLowerCase().includes(region.toLowerCase())
        );

        // Prioritise farms with coordinates
        farms.sort((a: any, b: any) => (b.lat ? 1 : 0) - (a.lat ? 1 : 0));

        const withCoords = farms.filter((f: any) => f.lat).length;
        const shown = farms.slice(0, limit);

        let output = `# Japan Fruit Picking Farms\n`;
        output += `Database: ${data.total} total farms | Updated: ${data.scraped_at ? new Date(data.scraped_at).toDateString() : "unknown"}\n`;
        output += `Filters: fruit=${fruit || "any"}, region=${region || "any"} → ${farms.length} matches (${withCoords} with GPS)\n\n`;

        if (shown.length === 0) {
          return { content: [{ type: "text", text: `No farms found. Try get_fruit_seasons to see what's in season, then filter by a specific fruit.` }] };
        }

        for (const f of shown) {
          output += `### ${f.name}\n`;
          if (f.address) output += `- **Address:** ${f.address}\n`;
          if (f.fruits?.length) output += `- **Fruits:** ${f.fruits.join(", ")}\n`;
          if (f.lat && f.lon) output += `- **GPS:** ${f.lat}, ${f.lon}\n`;
          if (f.url) output += `- **Link:** ${f.url}\n`;
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

function formatCityResults(cities: SakuraCity[]): string {
  let output = "";
  for (const city of cities) {
    output += `### ${city.cityName} (${city.prefName})\n`;
    output += `- **Status:** ${city.status}\n`;
    output += `- **Bloom:** forecast ${formatDate(city.bloom.forecast)}`;
    if (city.bloom.observation) output += ` → observed ${formatDate(city.bloom.observation)}`;
    output += ` (avg ${city.bloom.normal ?? "N/A"})\n`;
    output += `- **Full bloom:** forecast ${formatDate(city.fullBloom.forecast)}`;
    if (city.fullBloom.observation) output += ` → observed ${formatDate(city.fullBloom.observation)}`;
    output += ` (avg ${city.fullBloom.normal ?? "N/A"})\n`;
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
const server = new McpServer({ name: "japan-seasons-mcp", version: "0.1.0" });
registerAllTools(server);

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
        version: "0.1.0",
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

      // For non-init requests without session ID (e.g. Smithery probes),
      // use a stateless transport so they don't need initialization.
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

      const sessionServer = new McpServer({ name: "japan-seasons-mcp", version: "0.1.0" });
      registerAllTools(sessionServer);
      await sessionServer.connect(transport);

      if (isInit && transport.sessionId) {
        transports.set(transport.sessionId, transport);
        sessionLastActive.set(transport.sessionId, Date.now());
      }

      // Pass the pre-parsed body so the transport doesn't try to re-read the stream
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    // REST API endpoints (for the frontend)
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApiRequest(req, res, url.pathname, url.searchParams);
      if (handled) return;
    }

    // Serve frontend
    if (url.pathname === "/") {
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const htmlPath = join(__dirname, "..", "public", "index.html");
        const html = readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html><html><body><h1>japan-seasons-mcp</h1>
<p>MCP endpoint: <code>https://${req.headers.host}/mcp</code></p></body></html>`);
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
}

main().catch((e) => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
