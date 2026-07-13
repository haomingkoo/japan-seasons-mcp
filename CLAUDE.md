# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**japan-seasons-mcp** — an MCP (Model Context Protocol) server that gives AI assistants live Japan seasonal-travel data: cherry blossom (sakura) and autumn leaves (koyo) forecasts, flowers, festivals, fruit picking, and weather, sourced from the Japan Meteorological Corporation (JMC). Also serves a public website (`seasons.kooexperience.com`) with maps and a hosted remote MCP endpoint at `/mcp`.

## Tech Stack

- TypeScript (Node >=18), compiled with `tsc` to `dist/`
- `@modelcontextprotocol/sdk` for MCP server/tools, `zod` for schemas
- `express` (declared dep, but the HTTP server itself is built on Node's raw `http.createServer`, see `src/index.ts`)
- Vitest for tests
- Vanilla JS/HTML/CSS frontend in `public/`
- Deployed on Railway via Docker (`Dockerfile`, `railway.json`)

## Commands

- `npm run dev` — run `src/index.ts` directly with `node --watch` (stdio MCP mode)
- `npm run build` — `tsc` compile to `dist/`, chmod the entrypoint, then run `scripts/check-site-copy.mjs`
- `npm start` — run compiled server (`dist/index.js`), stdio MCP mode
- `npm run start:http` — run compiled server in HTTP mode (`--http` flag; also auto-enabled if `PORT` env var is set)
- `npm test` — run Vitest test suite (currently just `src/lib/dates.test.ts`)
- `npm version` — syncs version into `server.json` via `scripts/sync-version.mjs`, then stages it

No lint script exists in `package.json`.

## Architecture

- `src/index.ts` — entrypoint. Registers all MCP tools/prompts (`registerAllTools`), and runs either stdio transport or a raw Node HTTP server (`--http` / `PORT` env) that serves: the streamable-HTTP MCP endpoint at `/mcp`, REST endpoints under `/api/*` (delegated to `src/api.ts`), a dynamic `/sitemap.xml`, and static frontend files from `public/` (pre-read into memory at startup).
- `src/api.ts` — REST API handlers for the frontend (`/api/sakura/forecast`, `/api/sakura/spots`, `/api/sakura/best`, `/api/sakura/all-spots`, `/api/kawazu`, `/api/koyo/forecast`, `/api/koyo/spots`, `/api/koyo/all-spots`, `/api/fruit/farms`, `/api/flowers`, `/api/festivals`, `/api/weather`). Includes an in-memory + durable "all-spots" cache keyed off the daily 9 AM JST JMC publish time.
- `src/lib/sakura-forecast.ts`, `src/lib/koyo.ts` — fetch/parse live JMC sakura and koyo (autumn leaves) forecast + spot data.
- `src/lib/weather.ts`, `src/lib/areas.ts`, `src/lib/constants.ts`, `src/lib/dates.ts`, `src/lib/romaji.ts` — supporting data/utilities (weather lookups, city/area tables, fruit/festival/flower constants, JST date helpers, romaji formatting).
- `src/lib/cache.ts` / `src/lib/durable-cache.ts` — in-memory TTL cache and an optional durable (persisted) cache layer.
- `src/lib/site-config.ts` — shared site URLs/copy used by both the MCP server text and the HTML templates.
- `public/` — static site: landing page, `cherry-blossom-forecast.html`, `autumn-leaves-forecast.html`, `japan-seasonal-travel-mcp.html`, plus static JSON data (`flowers.json`, `festivals.json`, `fruit-farms.json`).

### MCP tools registered (`src/index.ts`)

`japan_seasonal_answer`, `sakura_now`, `koyo_now`, `search`, `fetch`, `sakura_forecast`, `sakura_spots`, `sakura_best_dates`, `kawazu_forecast`, `koyo_forecast`, `koyo_spots`, `koyo_best_dates`, `weather_forecast`, `flowers_spots`, `fruit_seasons`, `festivals_list`, `fruit_farms`, plus a `plan_japan_trip` prompt.

## Key Files

- `src/index.ts` — MCP tool registration + HTTP/stdio server
- `src/api.ts` — REST API + spot caching
- `src/lib/sakura-forecast.ts`, `src/lib/koyo.ts` — core JMC data fetch/parse logic
- `package.json` — scripts, deps, `bin` entries (`japan-seasons-mcp`, `japan-sakura-koyo-mcp`)
- `server.json`, `smithery.yaml`, `smithery.remote-config.json` — MCP registry/Smithery packaging metadata
- `Dockerfile`, `railway.json` — Railway deployment (Docker build, healthcheck at `/health`)
