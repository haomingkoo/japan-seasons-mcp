// Generate public/og-image.png at 1200x630 from inline HTML via Playwright.
// Usage: node scripts/generate-og-image.mjs
// Uses the site's tokens (DESIGN.md) and the self-hosted Shippori Mincho.

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "og-image.png");
const font = readFileSync(join(root, "public", "fonts", "shippori-mincho-latin-700.woff2")).toString("base64");
const petal = "M0-1.6C-3.6-4.2-4.6-8.4-2.6-11.4L0-9.6 2.6-11.4C4.6-8.4 3.6-4.2 0-1.6Z";
const mark = (color, size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><g transform="translate(16 16.6)" fill="${color}">${[0, 72, 144, 216, 288].map((r) => `<path d="${petal}" transform="rotate(${r})"/>`).join("")}</g></svg>`;

const seasons = [
  ["Cherry blossom", "#b4325a"],
  ["Autumn leaves", "#ad3b0c"],
  ["Flowers", "#65489a"],
  ["Fruit picking", "#2e6534"],
  ["Festivals", "#5a534b"],
];

const HTML = `<!DOCTYPE html>
<html><head><style>
  @font-face { font-family: 'Shippori Mincho'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 700; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #f6f1e8; color: #1f1c18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between;
    border-bottom: 10px solid #b4325a;
  }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand span { font-family: 'Shippori Mincho', serif; font-weight: 700; font-size: 34px; letter-spacing: -0.01em; }
  h1 { font-family: 'Shippori Mincho', serif; font-weight: 700; font-size: 66px; line-height: 1.08; letter-spacing: -0.02em; max-width: 1040px; }
  .sub { font-size: 26px; color: #5a534b; margin-top: 20px; max-width: 860px; line-height: 1.4; }
  .row { display: flex; justify-content: space-between; align-items: flex-end; }
  .seasons { display: flex; gap: 26px; font-size: 21px; color: #1f1c18; }
  .seasons i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 9px; vertical-align: 1px; }
  .url { font-size: 22px; color: #5a534b; }
</style></head>
<body>
  <div class="brand">${mark("#b4325a", 44)}<span>Japan in Seasons</span></div>
  <div>
    <h1>What is in season across Japan</h1>
    <p class="sub">Daily cherry blossom and autumn leaf forecasts from Japan Meteorological Corporation, on one map.</p>
  </div>
  <div class="row">
    <div class="seasons">${seasons.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>
    <div class="url">seasons.kooexperience.com</div>
  </div>
</body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(HTML, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: outPath, type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`Wrote ${outPath}`);
