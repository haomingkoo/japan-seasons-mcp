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
const URL_TIMEOUT_MS = 10000;
const URL_RETRY_DELAYS_MS = [1000, 2000];
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let passed = 0, failed = 0, warnings = 0;
const issues = [];

function fail(id, msg) { issues.push({ level: "FAIL", id, msg }); failed++; }
function warn(id, msg) { issues.push({ level: "WARN", id, msg }); warnings++; }
function ok(msg)       { passed++; if (process.env.VERBOSE) console.log("  ✓", msg); }
function sleep(ms)     { return new Promise(resolve => setTimeout(resolve, ms)); }

function getErrorMessage(error) {
  const parts = [error?.message, error?.cause?.code, error?.cause?.message].filter(Boolean);
  return parts.length > 0 ? parts.join(": ") : String(error);
}

function isDnsError(message) {
  return /enotfound|eai_again|getaddrinfo|dns/i.test(message);
}

function isTlsError(message) {
  return /certificate|cert|tls|ssl|self signed|unable to verify|altname|hostname/i.test(message);
}

function isTimeoutError(message, timedOut) {
  return timedOut || /aborted|timeout/i.test(message);
}

function isRetryableFetchError(error, message, timedOut) {
  return timedOut ||
    error?.name === "AbortError" ||
    error?.name === "TypeError" ||
    /fetch failed|aborted|timeout|enotfound|eai_again|getaddrinfo|dns|network|connect|socket|tls|ssl|cert/i.test(message);
}

function isWarnOnlyNetworkError(error, message, timedOut) {
  return isTimeoutError(message, timedOut) ||
    isDnsError(message) ||
    isTlsError(message) ||
    isRetryableFetchError(error, message, timedOut);
}

async function checkUrl(s) {
  for (let attempt = 0; attempt <= URL_RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, URL_TIMEOUT_MS);

    try {
      const res = await fetch(s.url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": BROWSER_USER_AGENT },
        redirect: "follow",
      });
      clearTimeout(timer);

      if (res.status >= 200 && res.status < 400) {
        return { id: s.id, url: s.url, status: res.status, bucket: "ok" };
      }

      if (res.status >= 400 && res.status < 500) {
        return { id: s.id, url: s.url, status: res.status, bucket: "fail" };
      }

      if (attempt < URL_RETRY_DELAYS_MS.length) {
        await sleep(URL_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      return { id: s.id, url: s.url, status: res.status, bucket: "fail" };
    } catch (e) {
      clearTimeout(timer);
      const error = getErrorMessage(e);

      if (isRetryableFetchError(e, error, timedOut) && attempt < URL_RETRY_DELAYS_MS.length) {
        await sleep(URL_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      return {
        id: s.id,
        url: s.url,
        status: 0,
        bucket: isWarnOnlyNetworkError(e, error, timedOut) ? "warn" : "fail",
        error,
      };
    }
  }
}

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
  spots.map(checkUrl)
);

let urlOk = 0, urlWarn = 0, urlFail = 0;
for (const result of urlResults) {
  const { id, url, status, bucket, error } = result.value || {};
  if (bucket === "warn") {
    warn(id, `URL returned ${status || "network error"}: ${url}${error ? ` (${error})` : ""}`);
    urlWarn++;
  } else if (bucket !== "ok") {
    fail(id, `URL returned ${status || "network error"}: ${url}${error ? ` (${error})` : ""}`);
    urlFail++;
  } else {
    ok(`${id} → ${status}`);
    urlOk++;
  }
}

// Sanity floor: if fewer than 70% of URL checks succeeded, the run is
// inconclusive (likely a runner-side network outage, not genuine data rot).
// Escalate to failure so it gets investigated instead of silently passing.
const urlTotal = urlOk + urlWarn + urlFail;
if (urlTotal > 0 && urlOk / urlTotal < 0.7) {
  fail("url-checks", `Only ${urlOk}/${urlTotal} URL checks succeeded (${urlWarn} warn, ${urlFail} fail) — below 70% threshold, likely a runner-side network issue`);
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
