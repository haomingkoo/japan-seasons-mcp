#!/usr/bin/env node
// verify-festivals.mjs — run manually or via GitHub Actions
// Checks all festival URLs for 200 responses, validates required fields,
// and flags biennial events + any data consistency issues.
//
// Usage: node verify-festivals.mjs

import { readFileSync } from "fs";
import { resolve } from "path";

const festPath = resolve(process.cwd(), "public/festivals.json");
const data = JSON.parse(readFileSync(festPath, "utf-8"));
const spots = data.spots || [];

const CURRENT_YEAR = new Date().getFullYear();
const REQUIRED = ["id", "type", "name", "lat", "lon", "months", "typicalDate", "url"];
const VALID_TYPES = ["fireworks", "matsuri", "winter"];

let passed = 0, failed = 0, warnings = 0;
const issues = [];

function fail(id, msg) { issues.push({ level: "FAIL", id, msg }); failed++; }
function warn(id, msg) { issues.push({ level: "WARN", id, msg }); warnings++; }
function ok(msg)       { passed++; if (process.env.VERBOSE) console.log("  ✓", msg); }

// ── 1. Schema validation ───────────────────────────────────────────────────
console.log(`\n── Schema (${spots.length} spots) ──`);
for (const s of spots) {
  for (const field of REQUIRED) {
    if (!s[field] && s[field] !== 0) fail(s.id, `Missing required field: ${field}`);
    else ok(`${s.id}.${field}`);
  }
  if (!VALID_TYPES.includes(s.type)) fail(s.id, `Unknown type: ${s.type}`);
  if (!Array.isArray(s.months) || s.months.length === 0) fail(s.id, `months must be non-empty array`);
  if (s.months?.some(m => m < 1 || m > 12)) fail(s.id, `months out of range: ${s.months}`);
  if (s.years && !["odd", "even", "annual"].includes(s.years))
    fail(s.id, `Invalid years value: ${s.years}`);
}

// ── 2. Biennial awareness ─────────────────────────────────────────────────
console.log(`\n── Biennial events (current year: ${CURRENT_YEAR}) ──`);
const biennials = spots.filter(s => s.years === "odd" || s.years === "even");
for (const s of biennials) {
  const happens = s.years === "odd" ? CURRENT_YEAR % 2 !== 0 : CURRENT_YEAR % 2 === 0;
  const status = happens ? "✓ HAPPENING this year" : "✗ NOT happening this year";
  console.log(`  ${s.id} (${s.years} years): ${status}`);
  if (!happens) warn(s.id, `Biennial event will NOT occur in ${CURRENT_YEAR} — should be hidden from UI`);
}
if (biennials.length === 0) console.log("  None found");

// ── 3. URL checks (HTTP HEAD) ──────────────────────────────────────────────
console.log(`\n── URL checks (${spots.length} URLs) ──`);
const urlResults = await Promise.allSettled(
  spots.map(async (s) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(s.url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "seasons.kooexperience.com/verify-bot" },
        redirect: "follow",
      });
      clearTimeout(timer);
      return { id: s.id, url: s.url, status: res.status, ok: res.ok };
    } catch (e) {
      clearTimeout(timer);
      return { id: s.id, url: s.url, status: 0, ok: false, error: e.message };
    }
  })
);

for (const result of urlResults) {
  const { id, url, status, ok: isOk, error } = result.value || {};
  if (!isOk) {
    fail(id, `URL returned ${status || "network error"}: ${url}${error ? ` (${error})` : ""}`);
  } else {
    ok(`${id} → ${status}`);
  }
}

// ── 4. Consistency checks ──────────────────────────────────────────────────
console.log(`\n── Consistency ──`);
// Check GPS coords are within Japan bounds (~24–46 N, 123–146 E)
for (const s of spots) {
  if (s.prefecture === "Nationwide") continue; // skip generic entries
  if (s.lat < 24 || s.lat > 46) fail(s.id, `Latitude ${s.lat} looks off for Japan`);
  if (s.lon < 123 || s.lon > 146) fail(s.id, `Longitude ${s.lon} looks off for Japan`);
}
ok("GPS bounds checked");

// Check winter festivals are in winter months
const winterFestivals = spots.filter(s => s.type === "winter");
for (const s of winterFestivals) {
  const hasWinterMonth = s.months.some(m => [11,12,1,2,3].includes(m));
  if (!hasWinterMonth) warn(s.id, `Type is 'winter' but months ${s.months} don't include winter months`);
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`festivals.json — verified ${CURRENT_YEAR}-${String(new Date().getMonth()+1).padStart(2,"0")}`);
console.log(`Data age: ${data.verified || data.updated || "unknown"}`);
console.log("─".repeat(60));

for (const issue of issues) {
  const icon = issue.level === "FAIL" ? "❌" : "⚠️ ";
  console.log(`${icon} [${issue.id}] ${issue.msg}`);
}

console.log("─".repeat(60));
console.log(`${passed} checks passed · ${warnings} warnings · ${failed} failures\n`);

if (failed > 0) process.exit(1);
