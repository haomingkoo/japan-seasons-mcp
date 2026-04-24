// Generate public/og-image.png at 1200x630 from inline HTML via Playwright.
// Re-run after editing the HTML below to regenerate.
// Usage: node scripts/generate-og-image.mjs

import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "public", "og-image.png");

const HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 35%, #f9a8d4 70%, #f472b6 100%);
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 64px 72px;
    position: relative; overflow: hidden;
  }
  body::before {
    content: '🌸'; position: absolute; font-size: 520px;
    right: -80px; top: 80px; opacity: 0.15; transform: rotate(12deg);
  }
  body::after {
    content: '🍁 🌸 🌷'; position: absolute; font-size: 120px;
    bottom: -30px; left: -20px; opacity: 0.12; letter-spacing: 40px;
  }
  .top { display: flex; align-items: center; gap: 12px; z-index: 1; }
  .badge {
    background: rgba(255,255,255,0.85); backdrop-filter: blur(8px);
    border-radius: 999px; padding: 8px 18px;
    font-size: 18px; font-weight: 600; color: #9d174d;
    display: inline-flex; align-items: center; gap: 8px;
  }
  .middle { z-index: 1; }
  h1 {
    font-size: 92px; line-height: 1.02; font-weight: 900;
    color: #831843; letter-spacing: -2.5px; margin-bottom: 20px;
  }
  .subtitle {
    font-size: 32px; color: #9d174d; font-weight: 500; line-height: 1.25;
    max-width: 800px;
  }
  .bottom {
    display: flex; justify-content: space-between; align-items: flex-end;
    z-index: 1;
  }
  .stats {
    display: flex; gap: 32px;
  }
  .stat .n {
    font-size: 42px; font-weight: 800; color: #831843; letter-spacing: -1px;
  }
  .stat .l {
    font-size: 15px; color: #9d174d; font-weight: 500;
    text-transform: uppercase; letter-spacing: 1.5px; margin-top: -4px;
  }
  .author {
    text-align: right; font-size: 18px; color: #9d174d; font-weight: 500;
  }
  .author .url {
    font-size: 22px; color: #831843; font-weight: 700; margin-top: 2px;
  }
</style>
</head>
<body>
  <div class="top">
    <span class="badge">🤖 MCP server for AI assistants</span>
    <span class="badge">JMA live data</span>
  </div>

  <div class="middle">
    <h1>Japan in Seasons</h1>
    <p class="subtitle">Live cherry blossom, autumn leaves, festivals, flowers, and fruit picking across all 47 prefectures.</p>
  </div>

  <div class="bottom">
    <div class="stats">
      <div class="stat"><div class="n">1,700+</div><div class="l">GPS-tagged spots</div></div>
      <div class="stat"><div class="n">47</div><div class="l">Prefectures</div></div>
      <div class="stat"><div class="n">12</div><div class="l">MCP tools</div></div>
    </div>
    <div class="author">
      by Haoming Koo
      <div class="url">seasons.kooexperience.com</div>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 630 } });
const page = await context.newPage();
await page.setContent(HTML, { waitUntil: "networkidle" });
// Wait for fonts to settle
await page.waitForTimeout(800);
await page.screenshot({ path: outPath, type: "png", fullPage: false, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`Wrote ${outPath}`);
