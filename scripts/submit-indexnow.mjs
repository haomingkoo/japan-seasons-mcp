#!/usr/bin/env node

const SITE_URL = "https://seasons.kooexperience.com";

const URLS = [
  `${SITE_URL}/`,
  `${SITE_URL}/japan-autumn-leaves-trip-planner`,
  `${SITE_URL}/autumn-leaves-forecast`,
  `${SITE_URL}/autumn-leaves-forecast.txt`,
  `${SITE_URL}/kyoto-autumn-leaves-forecast`,
  `${SITE_URL}/nikko-autumn-leaves-forecast`,
  `${SITE_URL}/cherry-blossom-forecast`,
  `${SITE_URL}/sakura-forecast.txt`,
  `${SITE_URL}/japan-seasonal-travel-mcp`,
  `${SITE_URL}/llms.txt`,
];

const key = process.env.INDEXNOW_KEY;
if (!key) {
  console.error("INDEXNOW_KEY is required. Create an IndexNow key and host it at the site root before submitting.");
  process.exit(1);
}

const keyLocation = process.env.INDEXNOW_KEY_LOCATION || `${SITE_URL}/${key}.txt`;
const endpoint = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(SITE_URL).host,
    key,
    keyLocation,
    urlList: URLS,
  }),
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  console.error(`IndexNow submission failed: HTTP ${response.status} ${response.statusText}`);
  if (body) console.error(body);
  process.exit(1);
}

console.log(`Submitted ${URLS.length} URLs to IndexNow via ${endpoint}`);
