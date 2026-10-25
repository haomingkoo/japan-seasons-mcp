# CLAUDE.md — japan-seasons-mcp

## Build and test
- `npm run build`: `tsc` to `dist/`, then `scripts/check-site-copy.mjs` checks public copy against `src/lib/site-config.ts`. A copy mismatch fails the build.
- `npx vitest run`: tests (`npm test` starts Vitest in watch mode).
- `npm run start:http` (or any `PORT` set) serves the site, `/api/*` and the remote MCP endpoint `/mcp`. Without it the server runs stdio MCP.
- No lint script. CI only runs `npm ci && npm run build`, plus a daily probe of the upstream JMC and weather APIs.

## Deploys
- Railway service `japan-sakura-koyo-mcp` auto-deploys every push to main (Docker, health check `/health`). Any merge, docs included, redeploys production.
- `JAPAN_SEASONS_CACHE_DIR` enables the on-disk durable cache. Without it, caches reset on every deploy.
- `Scrape Fruit Farm Spots` (weekly) commits `public/fruit-farms.json` to main, which also redeploys. Pull before branching.

## Gotchas
- Release: `npm version` syncs the version into `server.json` (MCP registry metadata). Do not hand-edit versions in `server.json`.
- JMC publishes forecasts daily at 9 AM JST. The all-spots cache keys off that time, so stale data before 9 AM JST is expected.
- The HTTP server is raw `http.createServer` in `src/index.ts`, not Express, despite the dependency.
