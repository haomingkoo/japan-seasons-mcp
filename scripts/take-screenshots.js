#!/usr/bin/env node
// Takes screenshots of seasons.kooexperience.com for the README
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const BASE = 'https://seasons.kooexperience.com';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// 1. Cherry blossom — zoom into Honshu for denser dot view
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
// Zoom into central Japan (Honshu) to show density of spots
await page.evaluate(() => {
  if (window.mapInstance) {
    window.mapInstance.setView([36.5, 137.5], 6);
  }
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'screenshots/01-sakura-map.png' });
console.log('✓ 01-sakura-map.png');

// 2. Click a sakura marker and capture popup
await page.evaluate(() => {
  const markers = document.querySelectorAll('.leaflet-marker-icon');
  if (markers.length > 0) markers[3]?.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/02-sakura-popup.png' });
console.log('✓ 02-sakura-popup.png');

// 3. Fruit picking
await page.click('#btn-fruit');
await page.waitForTimeout(3000);
await page.screenshot({ path: 'screenshots/03-fruit-picking.png' });
console.log('✓ 03-fruit-picking.png');

// 4. Flowers
await page.click('#btn-flowers');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'screenshots/04-flowers.png' });
console.log('✓ 04-flowers.png');

// 5. What's On
await page.click('#btn-whatson');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'screenshots/05-whatson.png' });
console.log('✓ 05-whatson.png');

// 6. Autumn leaves — use koyo spots tab (works year-round unlike forecast)
await page.click('#btn-koyo');
await page.waitForTimeout(3000);
// Click the Spots sub-tab if available
const spotsTab = page.locator('button:has-text("Spots"), [data-tab="spots"], .tab:has-text("Spots")').first();
if (await spotsTab.count() > 0) {
  await spotsTab.click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: 'screenshots/06-koyo-map.png' });
console.log('✓ 06-koyo-map.png');

// 7. Mobile view — cherry blossom
await ctx.close();
const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobile = await mobileCtx.newPage();
await mobile.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await mobile.waitForTimeout(3000);
await mobile.screenshot({ path: 'screenshots/07-mobile.png' });
console.log('✓ 07-mobile.png');

await browser.close();
console.log('\nAll screenshots saved to screenshots/');
