#!/usr/bin/env node
// Regression check for the /explore date slider: a mouse drag and a touch drag must land
// within one day of the target, and clicking the track must jump there.
// Usage: node scripts/test-explore-slider.mjs [base-url]   (default http://localhost:3000)
// Needs a Playwright browser: npx playwright install chromium
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000";
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const failures = [];
const day = (d) => new Date(d * 864e5).toISOString().slice(0, 10);

for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/explore?season=sakura`);
  await page.waitForFunction(() => document.getElementById("tl-date").textContent !== "Loading", null, { timeout: 90000 });
  const input = page.locator("#tl-range-input");
  await input.scrollIntoViewIfNeeded();
  const m = await page.evaluate(() => {
    const i = document.getElementById("tl-range-input");
    const r = i.getBoundingClientRect();
    return { min: +i.min, max: +i.max, x: r.left, w: r.width, y: r.top + r.height / 2 };
  });
  const thumb = 22;
  const xOf = (d) => m.x + thumb / 2 + ((d - m.min) / (m.max - m.min)) * (m.w - thumb);
  const check = async (label, target) => {
    const v = Number(await input.inputValue());
    const shown = await page.textContent("#tl-date");
    if (Math.abs(v - target) > 1) failures.push(`${width}px ${label}: wanted ${day(target)}, got ${day(v)} (${shown})`);
    else console.log(`ok ${width}px ${label}: ${day(target)} -> ${shown}`);
  };
  for (const target of [m.min + 20, m.min + 85, m.max - 10, m.min + 3]) {
    const from = xOf(Number(await input.inputValue()));
    await page.mouse.move(from, m.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(from + ((xOf(target) - from) * i) / 20, m.y);
    await page.mouse.up();
    await check("drag", target);
  }
  const target = m.min + 60;
  await page.mouse.click(xOf(target), m.y);
  await check("track click", target);
  if (touch) {
    const t2 = m.min + 110;
    await page.touchscreen.tap(xOf(t2), m.y);
    await check("tap", t2);
  }
  // Playing, then dragging, must stop playback and keep the dragged date.
  await page.click("#btn-play");
  await page.waitForTimeout(500);
  const t3 = m.min + 40;
  const from = xOf(Number(await input.inputValue()));
  await page.mouse.move(from, m.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(from + ((xOf(t3) - from) * i) / 20, m.y);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await check("drag while playing", t3);
  await ctx.close();
}
await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("slider check passed");
