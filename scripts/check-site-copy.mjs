#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  MCP_ENDPOINT,
  KOYO_FORECAST_API_URL,
  KOYO_FORECAST_TEXT_URL,
  SAKURA_FORECAST_API_URL,
  SAKURA_FORECAST_TEXT_URL,
  SITE_CONFIG,
  SITE_URL,
} from "../dist/lib/site-config.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function read(path) {
  return readFileSync(join(root, path), "utf-8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`site-copy check failed: ${message}`);
    process.exitCode = 1;
  }
}

const publicTemplates = [
  "public/index.html",
  "public/japan-seasonal-travel-mcp.html",
  "public/cherry-blossom-forecast.html",
  "public/autumn-leaves-forecast.html",
  "public/japan-autumn-leaves-trip-planner.html",
  "public/kyoto-autumn-leaves-forecast.html",
  "public/nikko-autumn-leaves-forecast.html",
  "public/status.html",
  "public/llms.txt",
  "public/robots.txt",
];

for (const path of publicTemplates) {
  const text = read(path);
  assert(!text.includes(SITE_URL), `${path} hardcodes SITE_URL instead of {{SITE_URL}}`);
  assert(!text.includes(MCP_ENDPOINT), `${path} hardcodes MCP_ENDPOINT instead of {{MCP_ENDPOINT}}`);
  assert(!text.includes(KOYO_FORECAST_TEXT_URL), `${path} hardcodes KOYO_FORECAST_TEXT_URL`);
  assert(!text.includes(KOYO_FORECAST_API_URL), `${path} hardcodes KOYO_FORECAST_API_URL`);
  assert(!text.includes(SAKURA_FORECAST_TEXT_URL), `${path} hardcodes SAKURA_FORECAST_TEXT_URL`);
  assert(!text.includes(SAKURA_FORECAST_API_URL), `${path} hardcodes SAKURA_FORECAST_API_URL`);
}

const readme = read("README.md");
assert(readme.includes(SITE_URL), "README.md should mention the canonical site URL");
assert(readme.includes(MCP_ENDPOINT), "README.md should mention the canonical MCP endpoint");
assert(readme.includes(KOYO_FORECAST_TEXT_URL), "README.md should mention the canonical koyo text URL");
assert(readme.includes(KOYO_FORECAST_API_URL), "README.md should mention the canonical koyo forecast API URL");
assert(readme.includes(SAKURA_FORECAST_TEXT_URL), "README.md should mention the canonical sakura text URL");
assert(readme.includes(SAKURA_FORECAST_API_URL), "README.md should mention the canonical sakura forecast API URL");

const pkg = JSON.parse(read("package.json"));
assert(pkg.homepage === SITE_URL, "package.json homepage must match SITE_CONFIG.siteUrl");

const server = JSON.parse(read("server.json"));
assert(server.remotes?.[0]?.url?.startsWith(MCP_ENDPOINT), "server.json remote URL must start with MCP_ENDPOINT");

const connectorBlock = `Name: {{CONNECTOR_NAME}}\nDescription: {{CONNECTOR_DESCRIPTION}}\nConnector URL: {{MCP_ENDPOINT}}`;
for (const path of ["public/index.html", "public/japan-seasonal-travel-mcp.html"]) {
  assert(read(path).includes(connectorBlock), `${path} must render connector metadata from site config tokens`);
}

if (!process.exitCode) {
  console.log(`site-copy check ok: ${SITE_CONFIG.name} metadata is centralized`);
}
