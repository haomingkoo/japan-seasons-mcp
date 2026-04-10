<p align="center">
  <h1 align="center">japan-seasons-mcp</h1>
  <p align="center">
    Year-round Japan seasonal travel — cherry blossom, autumn leaves, fruit picking, flowers & more.<br>
    1,700+ spots. Live data. Built for AI assistants.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/japan-seasons-mcp"><img src="https://img.shields.io/npm/v/japan-seasons-mcp" alt="npm"></a>
  <a href="https://github.com/haomingkoo/japan-seasons-mcp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-brightgreen" alt="MCP"></a>
</p>

---

**Try it live:** [seasons.kooexperience.com](https://seasons.kooexperience.com) — interactive map with 1,700+ spots

**The problem:** You ask ChatGPT, Gemini, or Claude *"When should I visit Kyoto for cherry blossoms?"* and get a generic answer based on training data. The actual bloom date shifts by weeks every year depending on temperature.

**The fix:** This MCP server gives AI assistants access to **live forecast data** from the Japan Meteorological Corporation — the same source behind Japan's #1 cherry blossom app (SAKURA NAVI). Real dates. Real bloom percentages. Updated daily.

## What You Get

| Data | Coverage | Updated |
|------|----------|---------|
| **Sakura forecast** | 48 JMA observation cities — forecast vs actual bloom dates, historical averages | Daily |
| **Sakura spots** | **1,012** parks, temples, gardens — bloom %, full bloom %, GPS coordinates | Daily 9AM JST |
| **Kawazu cherry** | 9 early-bloom spots in Izu Peninsula (Jan-Feb, deep pink variety) | Seasonal |
| **Koyo forecast** | 50+ cities — maple & ginkgo color change dates vs historical normal | Seasonal |
| **Koyo spots** | **687** autumn viewing spots — peak window (start/peak/end), popularity rating, GPS | Seasonal |
| **Flowers** | **28** curated spots — wisteria (Apr-May) & hydrangea (Jun-Jul) with official site links | Static |
| **Fruit picking** | **350+** farms — Jalan + Navitime data, GPS coordinates, season calendar for 14 fruits | Weekly |
| **Weather** | 51 cities — 3-day forecast, temperature, rain probability | Hourly |

Every data point comes from a live API call. Nothing is hardcoded or hallucinated.

## Quick Start

### Use with Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "japan-seasons": {
      "command": "npx",
      "args": ["japan-seasons-mcp"]
    }
  }
}
```

Then ask Claude: *"I'm going to Japan April 10-15. Where should I see cherry blossoms?"*

### Use with any MCP client (hosted)

```bash
PORT=3000 npx japan-seasons-mcp --http
# MCP endpoint: http://localhost:3000/mcp
```

Or use the hosted instance: `https://seasons.kooexperience.com/mcp`

## Tools

### Cherry Blossom (Sakura)

**`get_sakura_forecast`** — Big picture across all of Japan
```
"I want to see cherry blossoms in Japan"
→ Returns 48 cities with bloom status, forecast dates, actual observation dates, historical averages
```

**`get_sakura_spots`** — Drill into specific viewing spots
```
"Show me cherry blossom spots in Kyoto"
→ Returns 51 spots: Kiyomizu-dera, Arashiyama, Philosopher's Path... with bloom %, GPS
```

**`get_sakura_best_dates`** — Match your travel dates
```
"I'm traveling April 10-15"
→ Returns cities where bloom overlaps your dates, ranked by timing
```

**`get_kawazu_cherry`** — Early-season deep pink variety
```
"I want to see cherry blossoms in February"
→ Returns 9 Kawazu cherry spots in Izu Peninsula (blooms Jan-Feb, months before standard sakura)
```

### Autumn Leaves (Koyo)

**`get_koyo_forecast`** — Maple & ginkgo timing by city
```
"When do autumn leaves peak in Japan?"
→ Returns 50+ cities with maple/ginkgo dates and comparison to historical normal
```

**`get_koyo_spots`** — Famous viewing spots
```
"Best autumn leaves spots in Kyoto"
→ Returns 52 spots: Arashiyama, Eikando, Tofukuji... with peak dates, popularity rating, GPS
```

### Flowers

**`get_flowers`** — Wisteria & hydrangea spots with official website links
```
"Where can I see wisteria in Japan?"
→ 13 wisteria spots (Ashikaga, Kawachi, Kameido Tenjin, Byodoin...) with peak dates, GPS, official URLs

"Best hydrangea temples in Kamakura?"
→ Meigetsu-in, Hasedera, Engakuji + 12 more spots across Japan with June peak dates
```

### Fruit Picking

**`get_fruit_seasons`** — Season calendar by month
```
"What fruit can I pick in September?"
→ Grape (peak), Pear, Peach ending, Apple starting — with regions and farm tips
```

**`get_fruit_farms`** — 350+ farms with GPS and booking links
```
"Apple picking farms in Aomori"
→ Farm names, addresses, GPS coordinates, Jalan/Navitime links
```

### Weather

**`get_weather_forecast`** — 3-day forecast for trip planning
```
"What's the weather in Osaka?"
→ Temperature, rain probability (6-hour windows), wind, conditions
```

## Bloom Scale

The official Japan Meteorological Corporation scale, used for all 1,012 sakura spots:

```
BLOOM RATE (progress toward first bloom)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0%          60%         85%        100%
|  Bud stage  |  Swelling  | Opening | Bloom!
   花芽〜つぼみ   膨らみ始め    開き始め    開花

FULL BLOOM RATE (progress toward mankai/満開)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0%     20%     40%     70%     90%   100%
| Open | 30%  | 50%  | 70%  | Full bloom!
  開花   三分咲き  五分咲き  七分咲き    満開
```

## How It Works

```
┌──────────────────────────────────────────────┐
│  Japan Meteorological Corporation APIs       │
│  (n-kishou.co.jp)                            │
│                                              │
│  get-sakura-hw     → 48 city forecasts       │
│  list-jr-points    → 1,012 sakura spots      │
│  list-jr-points    → 687 koyo spots          │
│  kawazu_info.json  → Kawazu cherry data      │
│  koyo_*.json       → Autumn leaves forecasts │
└──────────────┬───────────────────────────────┘
               │ live API calls (cached 1-6 hours)
               │
┌──────────────▼───────────────────────────────┐
│  japan-seasons-mcp                           │
│                                              │
│  stdio mode:  npx japan-seasons-mcp          │
│  HTTP mode:   PORT=3000 ... --http           │
│                                              │
│  7 tools, 1 prompt template                  │
└──────────────┬───────────────────────────────┘
               │ MCP protocol
               │
     ┌─────────┼─────────┐
     │         │         │
  Claude    ChatGPT   Gemini
```

## Season Guide

| When | What to See | Tool to Use |
|------|-------------|-------------|
| Jan-Feb | Kawazu cherry (deep pink, Izu Peninsula) | `get_kawazu_cherry` |
| Late Mar | Sakura begins in Kyushu, Shikoku, Kansai | `get_sakura_forecast` |
| Early Apr | Peak sakura in Tokyo, Osaka, Kyoto | `get_sakura_spots` |
| Mid Apr | Sakura moves to Tohoku | `get_sakura_best_dates` |
| Late Apr-May | Sakura reaches Hokkaido + wisteria season | `get_sakura_spots` |
| Jun-Jul | Hydrangea season across Japan | — |
| Oct-Nov | Autumn leaves begin in Hokkaido, mountains | `get_koyo_forecast` |
| Nov-Dec | Peak koyo in Kyoto, Tokyo, Kansai | `get_koyo_spots` |

## Development

```bash
git clone https://github.com/haomingkoo/japan-seasons-mcp.git
cd japan-seasons-mcp
npm install
npm run build
npm start            # stdio mode
npm run start:http   # HTTP mode on port 3000
```

## Data Sources

- **[Japan Meteorological Corporation](https://n-kishou.com)** (日本気象株式会社) — Sakura & koyo forecasts, bloom rates, 1,700+ viewing spots
- **[Japan Meteorological Agency](https://www.jma.go.jp)** (気象庁) — Weather forecasts via [tsukumijima API](https://weather.tsukumijima.net)

## Web App

Visit [seasons.kooexperience.com](https://seasons.kooexperience.com) for the interactive frontend:

- **Interactive map** with all 1,012 sakura spots + marker clustering
- **Lifecycle colors** — orange (bud) → pink (bloom) → green (ended)
- **Autumn leaves** — 687 spots with peak date windows
- **Fruit picking** — 350+ farms with seasonal calendar
- **Flowers** — wisteria & hydrangea spots with official website links
- **Plan My Trip** — pick cities, find nearby seasonal spots with distance
- **Near Me** — uses your location to find spots within 30km
- **Pinpoint weather** — exact-coordinate forecast via Open-Meteo (JMA model)

## Formerly

Previously published as `japan-sakura-koyo-mcp` (deprecated). Install the new package:

```bash
npx japan-seasons-mcp
```

## License

MIT
